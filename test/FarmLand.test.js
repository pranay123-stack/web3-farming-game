const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const { deployGameFixture } = require("./helpers/fixtures");
const { LAND } = require("../config/gameContent");

const { parseEther, ZeroAddress } = hre.ethers;

describe("FarmLand (FLAND)", function () {
  async function withOperator() {
    const ctx = await loadFixture(deployGameFixture);
    await ctx.farmLand.addOperator(ctx.owner.address);
    return ctx;
  }

  describe("minting", function () {
    it("mints at explicit coordinates for the mint price", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      await expect(farmLand.connect(alice).mintLand(alice.address, 5, 3, { value: LAND.mintPrice }))
        .to.emit(farmLand, "LandMinted");
      const tokenId = await farmLand.getTokenIdByCoordinates(5, 3);
      expect(tokenId).to.equal(1n);
      expect(await farmLand.ownerOf(tokenId)).to.equal(alice.address);
    });

    it("rejects underpayment", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      await expect(
        farmLand.connect(alice).mintLand(alice.address, 1, 1, { value: LAND.mintPrice - 1n })
      ).to.be.revertedWithCustomError(farmLand, "InsufficientPayment");
    });

    it("refunds overpayment instead of keeping it", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      const overpay = LAND.mintPrice + parseEther("1");
      const before = await hre.ethers.provider.getBalance(alice.address);
      const tx = await farmLand.connect(alice).mintLand(alice.address, 2, 2, { value: overpay });
      const receipt = await tx.wait();
      const gas = receipt.gasUsed * receipt.gasPrice;
      const after = await hre.ethers.provider.getBalance(alice.address);
      // Only the mint price plus gas should have left the account.
      expect(before - after - gas).to.equal(LAND.mintPrice);
      expect(await hre.ethers.provider.getBalance(await farmLand.getAddress())).to.equal(LAND.mintPrice);
    });

    it("enforces coordinate uniqueness", async function () {
      const { farmLand, alice, bob } = await loadFixture(deployGameFixture);
      await farmLand.connect(alice).mintLand(alice.address, 7, 7, { value: LAND.mintPrice });
      await expect(farmLand.connect(bob).mintLand(bob.address, 7, 7, { value: LAND.mintPrice }))
        .to.be.revertedWithCustomError(farmLand, "CoordinateTaken");
    });

    it("enforces grid bounds", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      await expect(farmLand.connect(alice).mintLand(alice.address, 100, 0, { value: LAND.mintPrice }))
        .to.be.revertedWithCustomError(farmLand, "CoordinateOutOfBounds");
      await expect(farmLand.connect(alice).mintLand(alice.address, 0, 10, { value: LAND.mintPrice }))
        .to.be.revertedWithCustomError(farmLand, "CoordinateOutOfBounds");
    });

    it("auto-mint advances to distinct free coordinates", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      const seen = new Set();
      for (let i = 0; i < 5; i++) {
        await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
        const plot = await farmLand.getLandPlot(BigInt(i + 1));
        seen.add(`${plot.x},${plot.y}`);
      }
      expect(seen.size).to.equal(5);
    });

    /**
     * mintLandAuto previously rescanned the whole 100x10 grid on every call,
     * so gas grew without bound as the map filled. The cursor keeps it flat.
     */
    it("auto-mint gas does not grow as the grid fills", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      const gasUsed = [];
      for (let i = 0; i < 30; i++) {
        const tx = await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
        gasUsed.push((await tx.wait()).gasUsed);
      }
      const first = gasUsed[1]; // skip #0, which pays first-write warmup
      const last = gasUsed[gasUsed.length - 1];
      expect(last).to.be.lessThan(first + 20000n);
    });

    it("operators mint free via the dedicated entry point", async function () {
      const { farmLand, owner, alice } = await withOperator();
      await expect(farmLand.connect(owner).mintLandFor(alice.address, 9, 9)).to.emit(farmLand, "LandMinted");
      expect(await farmLand.ownerOf(1n)).to.equal(alice.address);
    });

    it("blocks a non-operator from the free mint path", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      await expect(farmLand.connect(alice).mintLandFor(alice.address, 1, 1))
        .to.be.revertedWithCustomError(farmLand, "NotOperator");
      await expect(farmLand.connect(alice).mintLandAutoFor(alice.address))
        .to.be.revertedWithCustomError(farmLand, "NotOperator");
    });

    it("assigns fertility inside the documented band", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      for (let i = 0; i < 8; i++) {
        await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
        const plot = await farmLand.getLandPlot(BigInt(i + 1));
        expect(plot.fertility).to.be.gte(50n);
        expect(plot.fertility).to.be.lte(100n);
      }
    });

    it("returns 0 rather than reverting for an unminted coordinate", async function () {
      const { farmLand } = await loadFixture(deployGameFixture);
      expect(await farmLand.getTokenIdByCoordinates(42, 4)).to.equal(0n);
    });
  });

  describe("locking", function () {
    it("locks and unlocks via an operator", async function () {
      const { farmLand, owner, alice } = await withOperator();
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      await expect(farmLand.connect(owner).lockLand(1n, 3600, 77n)).to.emit(farmLand, "LandLocked");
      let plot = await farmLand.getLandPlot(1n);
      expect(plot.isLocked).to.equal(true);
      expect(plot.plantedSeedId).to.equal(77n);

      await expect(farmLand.connect(owner).unlockLand(1n)).to.emit(farmLand, "LandUnlocked");
      plot = await farmLand.getLandPlot(1n);
      expect(plot.isLocked).to.equal(false);
      expect(plot.plantedSeedId).to.equal(0n);
    });

    it("blocks a non-operator from locking", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      await expect(farmLand.connect(alice).lockLand(1n, 10, 1n))
        .to.be.revertedWithCustomError(farmLand, "NotOperator");
    });

    it("refuses to double-lock or unlock an idle plot", async function () {
      const { farmLand, owner, alice } = await withOperator();
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      await expect(farmLand.connect(owner).unlockLand(1n))
        .to.be.revertedWithCustomError(farmLand, "PlotNotLocked");
      await farmLand.connect(owner).lockLand(1n, 10, 1n);
      await expect(farmLand.connect(owner).lockLand(1n, 10, 1n))
        .to.be.revertedWithCustomError(farmLand, "PlotAlreadyLocked");
    });

    it("prevents transferring a locked plot", async function () {
      const { farmLand, owner, alice, bob } = await withOperator();
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      await farmLand.connect(owner).lockLand(1n, 3600, 1n);
      await expect(
        farmLand.connect(alice).transferFrom(alice.address, bob.address, 1n)
      ).to.be.revertedWithCustomError(farmLand, "PlotIsLocked");

      await farmLand.connect(owner).unlockLand(1n);
      await expect(farmLand.connect(alice).transferFrom(alice.address, bob.address, 1n)).to.not.be.reverted;
      expect(await farmLand.ownerOf(1n)).to.equal(bob.address);
    });

    it("reports harvest readiness from the lock timestamp", async function () {
      const { farmLand, owner, alice } = await withOperator();
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      expect(await farmLand.isReadyToHarvest(1n)).to.equal(false);
      await farmLand.connect(owner).lockLand(1n, 100, 1n);
      expect(await farmLand.isReadyToHarvest(1n)).to.equal(false);
      await hre.network.provider.send("evm_increaseTime", [101]);
      await hre.network.provider.send("evm_mine");
      expect(await farmLand.isReadyToHarvest(1n)).to.equal(true);
    });
  });

  describe("upgrades", function () {
    it("raises level and fertility, capping at MAX_LEVEL", async function () {
      const { farmLand, owner, alice } = await withOperator();
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      const base = (await farmLand.getLandPlot(1n)).fertility;

      for (let i = 0; i < 10; i++) {
        await farmLand.connect(owner).upgradeLand(1n);
      }
      const plot = await farmLand.getLandPlot(1n);
      expect(plot.level).to.equal(10n);
      expect(plot.fertility).to.equal(base + 50n);

      await expect(farmLand.connect(owner).upgradeLand(1n))
        .to.be.revertedWithCustomError(farmLand, "MaxLevelReached");
    });

    it("refuses to upgrade a locked plot", async function () {
      const { farmLand, owner, alice } = await withOperator();
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      await farmLand.connect(owner).lockLand(1n, 3600, 1n);
      await expect(farmLand.connect(owner).upgradeLand(1n))
        .to.be.revertedWithCustomError(farmLand, "PlotIsLocked");
    });
  });

  describe("treasury", function () {
    it("withdraws proceeds using call, to an arbitrary recipient", async function () {
      const { farmLand, owner, alice, bob } = await loadFixture(deployGameFixture);
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      const before = await hre.ethers.provider.getBalance(bob.address);
      await expect(farmLand.connect(owner).withdraw(bob.address)).to.emit(farmLand, "Withdrawn");
      expect(await hre.ethers.provider.getBalance(bob.address)).to.equal(before + LAND.mintPrice);
    });

    it("reverts on an empty treasury and a zero recipient", async function () {
      const { farmLand, owner, bob } = await loadFixture(deployGameFixture);
      await expect(farmLand.connect(owner).withdraw(bob.address))
        .to.be.revertedWithCustomError(farmLand, "NothingToWithdraw");
      await expect(farmLand.connect(owner).withdraw(ZeroAddress))
        .to.be.revertedWithCustomError(farmLand, "ZeroAddress");
    });

    it("blocks a non-owner from withdrawing", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      await expect(farmLand.connect(alice).withdraw(alice.address))
        .to.be.revertedWithCustomError(farmLand, "OwnableUnauthorizedAccount");
    });
  });

  describe("views", function () {
    it("paginates plots with their data", async function () {
      const { farmLand, alice } = await loadFixture(deployGameFixture);
      for (let i = 0; i < 4; i++) {
        await farmLand.connect(alice).mintLandAuto(alice.address, { value: LAND.mintPrice });
      }
      const [ids, plots] = await farmLand.getPlotsByOwner(alice.address, 1, 2);
      expect(ids.length).to.equal(2);
      expect(plots[0].exists).to.equal(true);
      expect(await farmLand.getCurrentSupply()).to.equal(4n);
    });
  });
});
