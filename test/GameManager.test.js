const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const {
  deployGameFixture, fundPlayer, approveSpend, onboard,
  lastMintedNFT, advanceTime, MaxUint256,
} = require("./helpers/fixtures");
const { SEED_TYPES, RECIPES, STARTER_PACK, ECONOMY } = require("../config/gameContent");

const { parseEther } = hre.ethers;
const WHEAT = 0, CORN = 1, TOMATO = 2, GOLDEN = 3;
const CROP = 2;

describe("GameManager", function () {
  describe("starter pack (the on-ramp)", function () {
    /**
     * Without this the game was unplayable: the whole supply was minted to the
     * deployer and a fresh wallet had no route to its first seed.
     */
    it("grants FGOLD and a plot to a brand-new player", async function () {
      const { gameManager, farmToken, farmLand, alice } = await loadFixture(deployGameFixture);
      expect(await farmToken.balanceOf(alice.address)).to.equal(0n);

      await expect(gameManager.connect(alice).claimStarterPack())
        .to.emit(gameManager, "StarterPackClaimed");

      expect(await farmToken.balanceOf(alice.address)).to.equal(STARTER_PACK.tokens);
      expect(await farmLand.balanceOf(alice.address)).to.equal(1n);
    });

    it("can only be claimed once", async function () {
      const { gameManager, alice } = await loadFixture(deployGameFixture);
      await gameManager.connect(alice).claimStarterPack();
      await expect(gameManager.connect(alice).claimStarterPack())
        .to.be.revertedWithCustomError(gameManager, "StarterPackAlreadyClaimed");
    });

    it("respects the disable switch", async function () {
      const { gameManager, owner, alice } = await loadFixture(deployGameFixture);
      await gameManager.connect(owner).setStarterPackConfig(false, 0, false);
      await expect(gameManager.connect(alice).claimStarterPack())
        .to.be.revertedWithCustomError(gameManager, "StarterPackDisabled");
    });

    it("marks the profile as claimed", async function () {
      const { gameManager, alice } = await loadFixture(deployGameFixture);
      await gameManager.connect(alice).claimStarterPack();
      const profile = await gameManager.getPlayerProfile(alice.address);
      expect(profile.hasClaimedStarterPack).to.equal(true);
    });
  });

  describe("purchaseSeed", function () {
    it("burns FGOLD and mints a seed NFT with the right stats", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, farmNFT, alice } = ctx;
      await onboard(ctx, alice);

      const before = await farmToken.balanceOf(alice.address);
      const supplyBefore = await farmToken.totalSupply();
      await expect(gameManager.connect(alice).purchaseSeed(WHEAT))
        .to.emit(gameManager, "SeedPurchased");

      const cost = SEED_TYPES[WHEAT].seedCost;
      expect(await farmToken.balanceOf(alice.address)).to.equal(before - cost);
      // Spend is a burn, not a transfer to a treasury.
      expect(await farmToken.totalSupply()).to.equal(supplyBefore - cost);

      const seedId = await lastMintedNFT(ctx, alice);
      const item = await farmNFT.getItem(seedId);
      expect(item.itemType).to.equal(1); // SEED
      expect(item.growthTime).to.equal(BigInt(SEED_TYPES[WHEAT].growthTime));
      expect(item.yieldAmount).to.equal(SEED_TYPES[WHEAT].baseYield);
      expect(item.seedTypeId).to.equal(BigInt(WHEAT));
    });

    it("requires an ERC-20 allowance", async function () {
      const { gameManager, alice } = await loadFixture(deployGameFixture);
      await gameManager.connect(alice).claimStarterPack(); // no approve
      await expect(gameManager.connect(alice).purchaseSeed(WHEAT)).to.be.reverted;
    });

    it("reverts with insufficient balance", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, alice } = ctx;
      await onboard(ctx, alice);
      await farmToken.connect(alice).burn(await farmToken.balanceOf(alice.address));
      await expect(gameManager.connect(alice).purchaseSeed(WHEAT)).to.be.reverted;
    });

    it("rejects an unknown or inactive seed type", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, owner, alice } = ctx;
      await onboard(ctx, alice);
      await expect(gameManager.connect(alice).purchaseSeed(99))
        .to.be.revertedWithCustomError(gameManager, "InvalidSeedType");

      await gameManager.connect(owner).updateSeedType(
        WHEAT, SEED_TYPES[WHEAT].seedCost, SEED_TYPES[WHEAT].baseYield, 1, false
      );
      await expect(gameManager.connect(alice).purchaseSeed(WHEAT))
        .to.be.revertedWithCustomError(gameManager, "SeedTypeInactive");
    });

    it("enforces the player-level gate", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("5000"));
      // Golden Apple requires level 5; a fresh player is level 1.
      await expect(gameManager.connect(alice).purchaseSeed(GOLDEN))
        .to.be.revertedWithCustomError(gameManager, "LevelTooLow");
    });
  });

  describe("plantCrop", function () {
    async function planted() {
      const ctx = await loadFixture(deployGameFixture);
      const landId = await onboard(ctx, ctx.alice);
      await ctx.gameManager.connect(ctx.alice).purchaseSeed(WHEAT);
      const seedId = await lastMintedNFT(ctx, ctx.alice);
      return { ...ctx, landId, seedId };
    }

    it("locks the land, burns the seed and records the farm", async function () {
      const { gameManager, farmLand, farmNFT, alice, landId, seedId } = await planted();
      await expect(gameManager.connect(alice).plantCrop(landId, seedId))
        .to.emit(gameManager, "CropPlanted");

      const plot = await farmLand.getLandPlot(landId);
      expect(plot.isLocked).to.equal(true);
      expect(plot.plantedSeedId).to.equal(seedId);
      expect(await farmNFT.itemExists(seedId)).to.equal(false);

      const farm = await gameManager.playerFarms(alice.address, landId);
      expect(farm.isActive).to.equal(true);
      expect(farm.seedTypeId).to.equal(BigInt(WHEAT));
    });

    it("locks in the expected yield at plant time using the plot multiplier", async function () {
      const { gameManager, farmLand, alice, landId, seedId } = await planted();
      const plot = await farmLand.getLandPlot(landId);
      const multiplier = await gameManager.yieldMultiplierBps(plot.fertility, plot.level);
      await gameManager.connect(alice).plantCrop(landId, seedId);

      const farm = await gameManager.playerFarms(alice.address, landId);
      expect(farm.expectedYield).to.equal((SEED_TYPES[WHEAT].baseYield * multiplier) / 10000n);
    });

    it("refuses to plant on someone else's land", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const aliceLand = await onboard(ctx, ctx.alice);
      await onboard(ctx, ctx.bob);
      await ctx.gameManager.connect(ctx.bob).purchaseSeed(WHEAT);
      const bobSeed = await lastMintedNFT(ctx, ctx.bob);

      await expect(ctx.gameManager.connect(ctx.bob).plantCrop(aliceLand, bobSeed))
        .to.be.revertedWithCustomError(ctx.gameManager, "NotLandOwner");
    });

    it("refuses to plant someone else's seed", async function () {
      const ctx = await loadFixture(deployGameFixture);
      await onboard(ctx, ctx.alice);
      const bobLand = await onboard(ctx, ctx.bob);
      await ctx.gameManager.connect(ctx.alice).purchaseSeed(WHEAT);
      const aliceSeed = await lastMintedNFT(ctx, ctx.alice);

      await expect(ctx.gameManager.connect(ctx.bob).plantCrop(bobLand, aliceSeed))
        .to.be.revertedWithCustomError(ctx.gameManager, "NotSeedOwner");
    });

    it("refuses to double-plant an occupied plot", async function () {
      const ctx = await planted();
      const { gameManager, alice, landId, seedId } = ctx;
      await gameManager.connect(alice).plantCrop(landId, seedId);
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      const secondSeed = await lastMintedNFT(ctx, alice);
      await expect(gameManager.connect(alice).plantCrop(landId, secondSeed))
        .to.be.revertedWithCustomError(gameManager, "LandInUse");
    });

    it("refuses to plant a non-seed item", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("2000"));
      await gameManager.connect(alice).craftItem(0, []); // Basic Hoe, a TOOL
      const toolId = await lastMintedNFT(ctx, alice);
      await expect(gameManager.connect(alice).plantCrop(landId, toolId))
        .to.be.revertedWithCustomError(gameManager, "NotASeed");
    });

    it("increments totalPlanted", async function () {
      const { gameManager, alice, landId, seedId } = await planted();
      await gameManager.connect(alice).plantCrop(landId, seedId);
      expect((await gameManager.getPlayerProfile(alice.address)).totalPlanted).to.equal(1);
    });
  });

  describe("harvestCrop", function () {
    async function grown(seedTypeId = WHEAT) {
      const ctx = await loadFixture(deployGameFixture);
      const landId = await onboard(ctx, ctx.alice);
      await fundPlayer(ctx, ctx.alice, parseEther("10000"));
      await ctx.gameManager.connect(ctx.alice).purchaseSeed(seedTypeId);
      const seedId = await lastMintedNFT(ctx, ctx.alice);
      await ctx.gameManager.connect(ctx.alice).plantCrop(landId, seedId);
      return { ...ctx, landId, seedId };
    }

    it("refuses to harvest before maturity", async function () {
      const { gameManager, alice, landId } = await grown();
      await expect(gameManager.connect(alice).harvestCrop(landId))
        .to.be.revertedWithCustomError(gameManager, "NotReadyToHarvest");
      await advanceTime(SEED_TYPES[WHEAT].growthTime - 10);
      await expect(gameManager.connect(alice).harvestCrop(landId))
        .to.be.revertedWithCustomError(gameManager, "NotReadyToHarvest");
    });

    it("mints the locked-in yield, a crop NFT and XP, then unlocks the plot", async function () {
      const ctx = await grown();
      const { gameManager, farmToken, farmNFT, farmLand, alice, landId } = ctx;
      const farm = await gameManager.playerFarms(alice.address, landId);
      const balanceBefore = await farmToken.balanceOf(alice.address);

      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await expect(gameManager.connect(alice).harvestCrop(landId))
        .to.emit(gameManager, "CropHarvested");

      expect(await farmToken.balanceOf(alice.address)).to.equal(balanceBefore + farm.expectedYield);
      expect((await farmLand.getLandPlot(landId)).isLocked).to.equal(false);

      const cropId = await lastMintedNFT(ctx, alice);
      const crop = await farmNFT.getItem(cropId);
      expect(crop.itemType).to.equal(CROP);
      expect(crop.seedTypeId).to.equal(BigInt(WHEAT));

      const profile = await gameManager.getPlayerProfile(alice.address);
      expect(profile.totalHarvests).to.equal(1);
      expect(profile.xp).to.equal(SEED_TYPES[WHEAT].xpReward);
    });

    it("cannot be harvested twice", async function () {
      const { gameManager, alice, landId } = await grown();
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await gameManager.connect(alice).harvestCrop(landId);
      await expect(gameManager.connect(alice).harvestCrop(landId))
        .to.be.revertedWithCustomError(gameManager, "NoActiveFarm");
    });

    it("cannot be harvested by another player", async function () {
      const ctx = await grown();
      const { gameManager, bob, landId } = ctx;
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await expect(gameManager.connect(bob).harvestCrop(landId))
        .to.be.revertedWithCustomError(gameManager, "NotLandOwner");
    });

    it("reverts for a plot that was never planted", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const landId = await onboard(ctx, ctx.alice);
      await expect(ctx.gameManager.connect(ctx.alice).harvestCrop(landId))
        .to.be.revertedWithCustomError(ctx.gameManager, "NoActiveFarm");
    });

    it("applies the harvest bonus when configured", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, owner, alice } = ctx;
      await gameManager.connect(owner).setEconomyParams(
        1000, // +10%
        ECONOMY.fertilityBpsPerPoint, ECONOMY.levelBpsPerLevel,
        ECONOMY.upgradeCostBase, ECONOMY.xpPerLevel
      );
      const landId = await onboard(ctx, alice);
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      const seedId = await lastMintedNFT(ctx, alice);
      await gameManager.connect(alice).plantCrop(landId, seedId);
      const farm = await gameManager.playerFarms(alice.address, landId);

      const before = await farmToken.balanceOf(alice.address);
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await gameManager.connect(alice).harvestCrop(landId);
      const expectedBonus = (farm.expectedYield * 1000n) / 10000n;
      expect(await farmToken.balanceOf(alice.address))
        .to.equal(before + farm.expectedYield + expectedBonus);
    });

    it("removes the plot from the active-farm list", async function () {
      const { gameManager, alice, landId } = await grown();
      expect(await gameManager.getActiveFarmCount(alice.address)).to.equal(1n);
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await gameManager.connect(alice).harvestCrop(landId);
      expect(await gameManager.getActiveFarmCount(alice.address)).to.equal(0n);
    });

    it("tracks many concurrent farms and removes the right one", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmLand, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("10000"));

      const lands = [];
      for (let i = 0; i < 4; i++) {
        await farmLand.connect(alice).mintLandAuto(alice.address, { value: parseEther("0.005") });
        lands.push(await farmLand.tokenOfOwnerByIndex(alice.address, BigInt(i + 1)));
      }
      for (const land of lands) {
        await gameManager.connect(alice).purchaseSeed(WHEAT);
        await gameManager.connect(alice).plantCrop(land, await lastMintedNFT(ctx, alice));
      }
      expect(await gameManager.getActiveFarmCount(alice.address)).to.equal(4n);

      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await gameManager.connect(alice).harvestCrop(lands[1]); // middle of the array
      expect(await gameManager.getActiveFarmCount(alice.address)).to.equal(3n);

      const remaining = await gameManager.getPlayerActiveFarms(alice.address);
      expect(remaining.map((f) => f.landTokenId)).to.not.include(lands[1]);
      for (const f of remaining) expect(f.isActive).to.equal(true);
    });

    it("reports time until harvest and zero once ready", async function () {
      const { gameManager, alice, landId } = await grown();
      expect(await gameManager.getTimeUntilHarvest(alice.address, landId)).to.be.gt(0n);
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      expect(await gameManager.getTimeUntilHarvest(alice.address, landId)).to.equal(0n);
    });
  });

  describe("progression", function () {
    it("derives level from XP on the documented curve", async function () {
      const { gameManager, alice } = await loadFixture(deployGameFixture);
      expect(await gameManager.getPlayerLevel(alice.address)).to.equal(1);
      // level n at xpPerLevel * n^2, xpPerLevel = 50 => L2 at 200, L3 at 450
      expect(await gameManager.xpRequiredForLevel(2)).to.equal(200n);
      expect(await gameManager.xpRequiredForLevel(3)).to.equal(450n);
      expect(await gameManager.xpRequiredForLevel(5)).to.equal(1250n);
    });

    it("levels a player up through repeated harvests and emits the event", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("100000"));

      let leveled = false;
      // 25 XP per wheat harvest; level 2 needs 200 XP => 8 harvests.
      for (let i = 0; i < 8; i++) {
        await gameManager.connect(alice).purchaseSeed(WHEAT);
        await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
        await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
        const receipt = await (await gameManager.connect(alice).harvestCrop(landId)).wait();
        if (receipt.logs.some((l) => {
          try { return gameManager.interface.parseLog(l)?.name === "PlayerLeveledUp"; } catch { return false; }
        })) leveled = true;
      }
      expect(await gameManager.getPlayerLevel(alice.address)).to.equal(2);
      expect(leveled).to.equal(true);
    });

    it("unlocks a gated seed once the level is reached", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("100000"));

      await expect(gameManager.connect(alice).purchaseSeed(CORN))
        .to.be.revertedWithCustomError(gameManager, "LevelTooLow");

      for (let i = 0; i < 8; i++) {
        await gameManager.connect(alice).purchaseSeed(WHEAT);
        await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
        await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
        await gameManager.connect(alice).harvestCrop(landId);
      }
      await expect(gameManager.connect(alice).purchaseSeed(CORN)).to.not.be.reverted;
    });
  });

  describe("crafting", function () {
    it("crafts a material-free recipe, burning FGOLD", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, farmNFT, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("1000"));

      const before = await farmToken.balanceOf(alice.address);
      await expect(gameManager.connect(alice).craftItem(0, [])).to.emit(gameManager, "ItemCrafted");
      expect(await farmToken.balanceOf(alice.address)).to.equal(before - RECIPES[0].tokenCost);

      const item = await farmNFT.getItem(await lastMintedNFT(ctx, alice));
      expect(item.itemType).to.equal(RECIPES[0].resultType);
      expect(item.power).to.equal(BigInt(RECIPES[0].resultPower));
    });

    it("consumes the exact material set and burns it", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmNFT, owner, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("5000"));

      // Fertilizer (recipe 2) needs 2 CROP NFTs and level 2.
      await farmNFT.addMinter(owner.address);
      const crops = [];
      for (let i = 0; i < 2; i++) {
        await farmNFT.connect(owner).mintCrop(alice.address, 0, 1n, 0n, "c");
        crops.push(await lastMintedNFT(ctx, alice));
      }
      await gameManager.connect(owner).updateCraftingRecipe(2, RECIPES[2].tokenCost, 1, true);

      await expect(gameManager.connect(alice).craftItem(2, crops)).to.emit(gameManager, "ItemCrafted");
      for (const crop of crops) {
        expect(await farmNFT.itemExists(crop)).to.equal(false);
      }
    });

    it("rejects the wrong material count", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, owner, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("5000"));
      await gameManager.connect(owner).updateCraftingRecipe(2, RECIPES[2].tokenCost, 1, true);
      await expect(gameManager.connect(alice).craftItem(2, []))
        .to.be.revertedWithCustomError(gameManager, "WrongMaterialCount");
    });

    it("rejects the same material twice (no double-spend)", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmNFT, owner, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("5000"));
      await farmNFT.addMinter(owner.address);
      await farmNFT.connect(owner).mintCrop(alice.address, 0, 1n, 0n, "c");
      const crop = await lastMintedNFT(ctx, alice);
      await gameManager.connect(owner).updateCraftingRecipe(2, RECIPES[2].tokenCost, 1, true);

      await expect(gameManager.connect(alice).craftItem(2, [crop, crop]))
        .to.be.revertedWithCustomError(gameManager, "DuplicateMaterial");
    });

    it("rejects materials of the wrong type", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmNFT, owner, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("5000"));
      await farmNFT.addMinter(owner.address);
      await farmNFT.connect(owner).mintTool(alice.address, 0, 1n, 1n, "t");
      const tool1 = await lastMintedNFT(ctx, alice);
      await farmNFT.connect(owner).mintTool(alice.address, 0, 1n, 1n, "t");
      const tool2 = await lastMintedNFT(ctx, alice);
      await gameManager.connect(owner).updateCraftingRecipe(2, RECIPES[2].tokenCost, 1, true);

      await expect(gameManager.connect(alice).craftItem(2, [tool1, tool2]))
        .to.be.revertedWithCustomError(gameManager, "WrongMaterialType");
    });

    it("rejects materials the caller does not own", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmNFT, owner, alice, bob } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("5000"));
      await farmNFT.addMinter(owner.address);
      await farmNFT.connect(owner).mintCrop(bob.address, 0, 1n, 0n, "c");
      await farmNFT.connect(owner).mintCrop(bob.address, 0, 1n, 0n, "c");
      await gameManager.connect(owner).updateCraftingRecipe(2, RECIPES[2].tokenCost, 1, true);

      await expect(gameManager.connect(alice).craftItem(2, [1n, 2n]))
        .to.be.revertedWithCustomError(gameManager, "NotSeedOwner");
    });

    it("enforces the recipe level gate and the active flag", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, owner, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("50000"));

      await expect(gameManager.connect(alice).craftItem(3, [])) // Steel Hoe, level 3
        .to.be.revertedWithCustomError(gameManager, "LevelTooLow");

      await gameManager.connect(owner).updateCraftingRecipe(0, RECIPES[0].tokenCost, 1, false);
      await expect(gameManager.connect(alice).craftItem(0, []))
        .to.be.revertedWithCustomError(gameManager, "RecipeInactive");
    });

    it("rejects an unknown recipe", async function () {
      const ctx = await loadFixture(deployGameFixture);
      await onboard(ctx, ctx.alice);
      await expect(ctx.gameManager.connect(ctx.alice).craftItem(99, []))
        .to.be.revertedWithCustomError(ctx.gameManager, "InvalidRecipe");
    });
  });

  describe("land upgrades", function () {
    it("charges the quadratic cost and raises the level", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, farmLand, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("100000"));

      const cost = await gameManager.getUpgradeCost(0);
      expect(cost).to.equal(ECONOMY.upgradeCostBase); // 500 * 1^2
      expect(await gameManager.getUpgradeCost(1)).to.equal(ECONOMY.upgradeCostBase * 4n);
      expect(await gameManager.getUpgradeCost(2)).to.equal(ECONOMY.upgradeCostBase * 9n);

      const before = await farmToken.balanceOf(alice.address);
      await expect(gameManager.connect(alice).upgradeLand(landId))
        .to.emit(gameManager, "LandUpgraded");
      expect(await farmToken.balanceOf(alice.address)).to.equal(before - cost);
      expect((await farmLand.getLandPlot(landId)).level).to.equal(1n);
    });

    it("raises subsequent harvest yields", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmLand, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("100000"));

      const plotBefore = await farmLand.getLandPlot(landId);
      const mBefore = await gameManager.yieldMultiplierBps(plotBefore.fertility, plotBefore.level);
      await gameManager.connect(alice).upgradeLand(landId);
      const plotAfter = await farmLand.getLandPlot(landId);
      const mAfter = await gameManager.yieldMultiplierBps(plotAfter.fertility, plotAfter.level);

      // +300 bps for the level, +5 fertility * 20 bps = +100 bps
      expect(mAfter - mBefore).to.equal(400n);
    });

    it("refuses to upgrade land in use or beyond max level", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("500000"));

      await gameManager.connect(alice).purchaseSeed(WHEAT);
      await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
      await expect(gameManager.connect(alice).upgradeLand(landId))
        .to.be.revertedWithCustomError(gameManager, "LandInUse");

      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await gameManager.connect(alice).harvestCrop(landId);
      for (let i = 0; i < 10; i++) await gameManager.connect(alice).upgradeLand(landId);
      await expect(gameManager.connect(alice).upgradeLand(landId))
        .to.be.revertedWithCustomError(gameManager, "MaxLevelReached");
    });

    it("refuses to upgrade land the caller does not own", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const landId = await onboard(ctx, ctx.alice);
      await onboard(ctx, ctx.bob);
      await fundPlayer(ctx, ctx.bob, parseEther("10000"));
      await expect(ctx.gameManager.connect(ctx.bob).upgradeLand(landId))
        .to.be.revertedWithCustomError(ctx.gameManager, "NotLandOwner");
    });
  });

  describe("admin surface", function () {
    it("caps the harvest bonus, closing the unbounded-mint lever", async function () {
      const { gameManager, owner } = await loadFixture(deployGameFixture);
      const cap = await gameManager.MAX_HARVEST_BONUS_BPS();
      await expect(gameManager.connect(owner).setEconomyParams(cap + 1n, 20, 300, parseEther("500"), 50))
        .to.be.revertedWithCustomError(gameManager, "HarvestBonusTooHigh");
      await expect(gameManager.connect(owner).setEconomyParams(cap, 20, 300, parseEther("500"), 50))
        .to.not.be.reverted;
    });

    it("rejects a zero XP curve that would make levels undefined", async function () {
      const { gameManager, owner } = await loadFixture(deployGameFixture);
      await expect(gameManager.connect(owner).setEconomyParams(0, 20, 300, parseEther("500"), 0))
        .to.be.revertedWithCustomError(gameManager, "InvalidParameter");
    });

    it("blocks non-owners from every admin entry point", async function () {
      const { gameManager, alice } = await loadFixture(deployGameFixture);
      await expect(gameManager.connect(alice).setEconomyParams(0, 20, 300, 1n, 50n)).to.be.reverted;
      await expect(gameManager.connect(alice).setStarterPackConfig(false, 0, false)).to.be.reverted;
      await expect(gameManager.connect(alice).pause()).to.be.reverted;
      await expect(gameManager.connect(alice).updateSeedType(0, 1n, 1n, 1, true)).to.be.reverted;
      await expect(gameManager.connect(alice).updateCraftingRecipe(0, 1n, 1, true)).to.be.reverted;
    });

    it("pausing halts every player action and unpausing restores them", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, owner, alice, bob } = ctx;
      await onboard(ctx, alice);
      await gameManager.connect(owner).pause();

      await expect(gameManager.connect(alice).purchaseSeed(WHEAT))
        .to.be.revertedWithCustomError(gameManager, "EnforcedPause");
      await expect(gameManager.connect(bob).claimStarterPack())
        .to.be.revertedWithCustomError(gameManager, "EnforcedPause");

      await gameManager.connect(owner).unpause();
      await expect(gameManager.connect(alice).purchaseSeed(WHEAT)).to.not.be.reverted;
    });

    it("keeps contract references immutable", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      expect(gameManager.interface.getFunction("updateContracts")).to.equal(null);
    });

    it("rejects a zero-growth seed type", async function () {
      const { gameManager, owner } = await loadFixture(deployGameFixture);
      await expect(gameManager.connect(owner).addSeedType(0, 1n, 1n, 1n, 1, 0, "a", "b"))
        .to.be.revertedWithCustomError(gameManager, "InvalidParameter");
    });

    it("bounds recipe material counts", async function () {
      const { gameManager, owner } = await loadFixture(deployGameFixture);
      await expect(gameManager.connect(owner).addCraftingRecipe({
        tokenCost: 0, resultType: 0, resultRarity: 0, resultPower: 0, resultDurability: 0,
        resultGrowthTime: 0, resultYield: 0, xpReward: 0, requiredLevel: 1,
        materialType: 2, materialCount: 11, resultURI: "x",
      })).to.be.revertedWithCustomError(gameManager, "TooManyMaterials");
    });
  });

  describe("registry views", function () {
    it("returns all seed types and recipes for the client", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      const seeds = await gameManager.getAllSeedTypes();
      expect(seeds.length).to.equal(SEED_TYPES.length);
      expect(seeds[GOLDEN].requiredLevel).to.equal(SEED_TYPES[GOLDEN].requiredLevel);

      const recipes = await gameManager.getAllRecipes();
      expect(recipes.length).to.equal(RECIPES.length);
      expect(recipes[2].materialCount).to.equal(RECIPES[2].materialCount);
    });
  });
});
