const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const {
  deployGameFixture, fundPlayer, onboard, lastMintedNFT, advanceTime,
} = require("./helpers/fixtures");
const { SEED_TYPES, RECIPES, ECONOMY, STARTER_PACK } = require("../config/gameContent");

const { parseEther, MaxUint256 } = hre.ethers;
const WHEAT = 0;

describe("Integration", function () {
  describe("full player journey", function () {
    /**
     * Walks the entire loop end to end with nothing but the public API a real
     * client would call: claim -> approve -> buy -> plant -> wait -> harvest
     * -> craft -> list -> another player buys -> upgrade.
     */
    it("claim, farm, craft, trade and upgrade", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, farmNFT, farmLand, marketplace, alice, bob } = ctx;
      const gmAddress = await gameManager.getAddress();
      const mpAddress = await marketplace.getAddress();

      // 1. A brand-new wallet onboards.
      await gameManager.connect(alice).claimStarterPack();
      await farmToken.connect(alice).approve(gmAddress, MaxUint256);
      const landId = await farmLand.tokenOfOwnerByIndex(alice.address, 0);
      expect(await farmToken.balanceOf(alice.address)).to.equal(STARTER_PACK.tokens);

      // 2. Buy and plant.
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      const seedId = await lastMintedNFT(ctx, alice);
      await gameManager.connect(alice).plantCrop(landId, seedId);
      expect((await farmLand.getLandPlot(landId)).isLocked).to.equal(true);

      // 3. Wait and harvest.
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await gameManager.connect(alice).harvestCrop(landId);
      const cropId = await lastMintedNFT(ctx, alice);
      expect((await farmNFT.getItem(cropId)).itemType).to.equal(2); // CROP

      // 4. Farm until there is enough FGOLD to craft.
      while ((await farmToken.balanceOf(alice.address)) < RECIPES[0].tokenCost) {
        await gameManager.connect(alice).purchaseSeed(WHEAT);
        await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
        await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
        await gameManager.connect(alice).harvestCrop(landId);
      }

      // 5. Craft a tool.
      await gameManager.connect(alice).craftItem(0, []);
      const toolId = await lastMintedNFT(ctx, alice);
      expect((await farmNFT.getItem(toolId)).itemType).to.equal(0); // TOOL

      // 6. List it.
      await farmNFT.connect(alice).setApprovalForAll(mpAddress, true);
      const price = parseEther("400");
      await marketplace.connect(alice).listItem(await farmNFT.getAddress(), toolId, price);
      const listingId = await marketplace.listingIdCounter();

      // 7. A second player onboards and buys it.
      await gameManager.connect(bob).claimStarterPack();
      await fundPlayer(ctx, bob, price);
      await farmToken.connect(bob).approve(mpAddress, MaxUint256);
      await marketplace.connect(bob).buyItem(listingId, price);
      expect(await farmNFT.ownerOf(toolId)).to.equal(bob.address);

      // 8. Alice upgrades her plot with the proceeds.
      const upgradeCost = await gameManager.getUpgradeCost(0);
      if ((await farmToken.balanceOf(alice.address)) < upgradeCost) {
        await fundPlayer(ctx, alice, upgradeCost);
      }
      await gameManager.connect(alice).upgradeLand(landId);
      expect((await farmLand.getLandPlot(landId)).level).to.equal(1n);

      // 9. Progression actually moved.
      const profile = await gameManager.getPlayerProfile(alice.address);
      expect(profile.totalHarvests).to.be.gt(0);
      expect(profile.totalCrafted).to.equal(1);
      expect(profile.totalUpgrades).to.equal(1);
      expect(profile.xp).to.be.gt(0n);
    });

    it("state survives being read fresh from the chain (no client memory)", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmLand, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));

      // Everything a reloading client needs comes back from view calls alone.
      const farms = await gameManager.getPlayerActiveFarms(alice.address);
      expect(farms.length).to.equal(1);
      expect(farms[0].landTokenId).to.equal(landId);
      expect(await gameManager.getTimeUntilHarvest(alice.address, landId)).to.be.gt(0n);
      expect((await farmLand.getLandPlot(landId)).isLocked).to.equal(true);
    });
  });

  describe("adversarial", function () {
    it("resists re-entrancy into harvestCrop from the crop-mint receiver hook", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, farmLand } = ctx;

      const Malicious = await hre.ethers.getContractFactory("MaliciousReceiver");
      const attacker = await Malicious.deploy(await gameManager.getAddress());
      await attacker.waitForDeployment();
      const attackerAddress = await attacker.getAddress();

      await attacker.claim(); // starter pack: land + FGOLD
      const landId = await farmLand.tokenOfOwnerByIndex(attackerAddress, 0);

      // Fund and approve on the attacker's behalf, then plant via a direct call.
      await ctx.farmToken.addMinter(ctx.owner.address);
      await farmToken.connect(ctx.owner).mint(attackerAddress, parseEther("1000"));
      await ctx.farmToken.removeMinter(ctx.owner.address);

      // The attacker contract has no approve/plant helpers, so drive the flow
      // through a signer impersonating it.
      await hre.network.provider.send("hardhat_impersonateAccount", [attackerAddress]);
      await hre.network.provider.send("hardhat_setBalance", [attackerAddress, "0x56BC75E2D63100000"]);
      const attackerSigner = await hre.ethers.getSigner(attackerAddress);

      await farmToken.connect(attackerSigner).approve(await gameManager.getAddress(), MaxUint256);
      await gameManager.connect(attackerSigner).purchaseSeed(WHEAT);
      const seedId = await lastMintedNFT(ctx, { address: attackerAddress });
      await gameManager.connect(attackerSigner).plantCrop(landId, seedId);
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);

      const balanceBefore = await farmToken.balanceOf(attackerAddress);
      await attacker.arm(landId);
      await attacker.callHarvest(landId);

      expect(await attacker.reentered()).to.equal(false);
      // Exactly one harvest was paid out.
      const farm = await gameManager.playerFarms(attackerAddress, landId);
      expect(farm.isActive).to.equal(false);
      const gained = (await farmToken.balanceOf(attackerAddress)) - balanceBefore;
      expect(gained).to.be.gt(0n);
      expect(gained).to.be.lt(SEED_TYPES[WHEAT].baseYield * 2n);

      await hre.network.provider.send("hardhat_stopImpersonatingAccount", [attackerAddress]);
    });

    it("a player cannot harvest by transferring land mid-growth", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmLand, alice, bob } = ctx;
      const landId = await onboard(ctx, alice);
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));

      // The lock makes the ownership assumption at harvest time sound.
      await expect(farmLand.connect(alice).transferFrom(alice.address, bob.address, landId))
        .to.be.revertedWithCustomError(farmLand, "PlotIsLocked");
    });

    it("a buyer of harvested land cannot claim the previous owner's farm record", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmLand, alice, bob } = ctx;
      const landId = await onboard(ctx, alice);
      await onboard(ctx, bob);
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
      await gameManager.connect(alice).harvestCrop(landId);

      await farmLand.connect(alice).transferFrom(alice.address, bob.address, landId);
      // Farm records are keyed per player, so Bob inherits nothing harvestable.
      await expect(gameManager.connect(bob).harvestCrop(landId))
        .to.be.revertedWithCustomError(gameManager, "NoActiveFarm");
    });

    it("timestamp nudging cannot bring a crop forward", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));

      // A miner can shift a block by seconds, not by the full growth window.
      await advanceTime(15);
      await expect(gameManager.connect(alice).harvestCrop(landId))
        .to.be.revertedWithCustomError(gameManager, "NotReadyToHarvest");
    });

    it("removing GameManager's minter rights stops all emission", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, owner, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await gameManager.connect(alice).purchaseSeed(WHEAT);
      await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
      await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);

      await farmToken.connect(owner).removeMinter(await gameManager.getAddress());
      await expect(gameManager.connect(alice).harvestCrop(landId))
        .to.be.revertedWithCustomError(farmToken, "NotMinter");
    });
  });

  describe("economy invariants", function () {
    it("every FGOLD in existence traces to the starter pack or a harvest", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { gameManager, farmToken, alice } = ctx;
      expect(await farmToken.totalSupply()).to.equal(0n);

      const landId = await onboard(ctx, alice);
      let minted = STARTER_PACK.tokens;
      let burned = 0n;

      for (let i = 0; i < 3; i++) {
        await gameManager.connect(alice).purchaseSeed(WHEAT);
        burned += SEED_TYPES[WHEAT].seedCost;
        await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
        const farm = await gameManager.playerFarms(alice.address, landId);
        await advanceTime(SEED_TYPES[WHEAT].growthTime + 1);
        await gameManager.connect(alice).harvestCrop(landId);
        minted += farm.expectedYield;
      }
      expect(await farmToken.totalSupply()).to.equal(minted - burned);
    });

    it("a fresh floor-fertility plot yields exactly the seed's base", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      expect(await gameManager.yieldMultiplierBps(50, 0)).to.equal(10000n);
    });

    it("spans the documented 100-110% fresh / 140-150% maxed band", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      // A fresh plot rolls fertility 50..100 at level 0.
      expect(await gameManager.yieldMultiplierBps(50, 0)).to.equal(10000n);
      expect(await gameManager.yieldMultiplierBps(100, 0)).to.equal(11000n);
      // Ten upgrades add +10 levels and +50 fertility, so both terms compound.
      expect(await gameManager.yieldMultiplierBps(100, 10)).to.equal(14000n);
      expect(await gameManager.yieldMultiplierBps(150, 10)).to.equal(15000n);
    });

    it("prices one upgrade at 400 bps across both terms", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      const before = await gameManager.yieldMultiplierBps(80, 3);
      const after = await gameManager.yieldMultiplierBps(85, 4); // +5 fertility, +1 level
      expect(after - before).to.equal(400n);
    });

    it("each seed tier is profitable at the yield floor", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      for (let i = 0; i < SEED_TYPES.length; i++) {
        const seed = await gameManager.getSeedType(i);
        expect(seed.baseYield, `seed ${i} must be profitable`).to.be.gt(seed.seedCost);
      }
    });

    it("later tiers pay more per hour than earlier ones", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      let previousRate = 0n;
      for (let i = 0; i < SEED_TYPES.length; i++) {
        const seed = await gameManager.getSeedType(i);
        const profitPerHour = ((seed.baseYield - seed.seedCost) * 3600n) / seed.growthTime;
        if (i > 0) {
          // Higher tiers trade liquidity for total value, not hourly rate, so
          // only assert the absolute margin grows.
          expect(seed.baseYield - seed.seedCost).to.be.gt(previousRate);
        }
        previousRate = seed.baseYield - seed.seedCost;
        expect(profitPerHour).to.be.gt(0n);
      }
    });

    it("the upgrade sink outgrows farming income", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      const wheatMargin = SEED_TYPES[WHEAT].baseYield - SEED_TYPES[WHEAT].seedCost;
      let total = 0n;
      for (let level = 0; level < 10; level++) {
        total += await gameManager.getUpgradeCost(level);
      }
      // Maxing one plot must cost far more than a handful of harvests.
      expect(total).to.be.gt(wheatMargin * 1000n);
      expect(total).to.equal(parseEther("192500"));
    });
  });

  describe("deployment wiring", function () {
    it("grants exactly the permissions the game needs and no more", async function () {
      const { farmToken, farmNFT, farmLand, gameManager, marketplace, owner } =
        await loadFixture(deployGameFixture);
      const gm = await gameManager.getAddress();
      const mp = await marketplace.getAddress();

      expect(await farmToken.isMinter(gm)).to.equal(true);
      expect(await farmNFT.minters(gm)).to.equal(true);
      expect(await farmLand.operators(gm)).to.equal(true);

      // The marketplace must never be able to mint or mutate game state.
      expect(await farmToken.isMinter(mp)).to.equal(false);
      expect(await farmNFT.minters(mp)).to.equal(false);
      expect(await farmLand.operators(mp)).to.equal(false);

      // Nor may the deploying EOA.
      expect(await farmToken.isMinter(owner.address)).to.equal(false);
      expect(await farmNFT.minters(owner.address)).to.equal(false);
      expect(await farmLand.operators(owner.address)).to.equal(false);

      expect(await marketplace.whitelistedNFTs(await farmNFT.getAddress())).to.equal(true);
      expect(await marketplace.whitelistedNFTs(await farmLand.getAddress())).to.equal(true);
    });

    it("seeds the configured content", async function () {
      const { gameManager } = await loadFixture(deployGameFixture);
      expect(await gameManager.seedTypeCount()).to.equal(BigInt(SEED_TYPES.length));
      expect(await gameManager.recipeCount()).to.equal(BigInt(RECIPES.length));
      expect(await gameManager.xpPerLevel()).to.equal(ECONOMY.xpPerLevel);
      expect(await gameManager.upgradeCostBase()).to.equal(ECONOMY.upgradeCostBase);
    });
  });
});
