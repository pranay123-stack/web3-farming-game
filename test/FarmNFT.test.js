const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const { deployGameFixture, BASE_URI } = require("./helpers/fixtures");

const { ZeroAddress } = hre.ethers;
const TOOL = 0, SEED = 1, CROP = 2;
const COMMON = 0, RARE = 2;

describe("FarmNFT (FITEM)", function () {
  async function withMinter() {
    const ctx = await loadFixture(deployGameFixture);
    // Grant the owner EOA minter rights so these unit tests can mint directly.
    await ctx.farmNFT.addMinter(ctx.owner.address);
    return ctx;
  }

  describe("regression: convenience minters must not self-call", function () {
    /**
     * mintSeed/mintTool/mintCrop used to dispatch via `this.mintItem(...)`.
     * That external self-call arrived with msg.sender == the FarmNFT contract,
     * which was never its own minter, so every one of them reverted - taking
     * GameManager.purchaseSeed and the whole game loop down with them.
     */
    it("mintSeed succeeds for an authorised minter", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await expect(farmNFT.connect(owner).mintSeed(alice.address, COMMON, 3600, 100n, 7n, "seed.json"))
        .to.emit(farmNFT, "ItemMinted");
      expect(await farmNFT.balanceOf(alice.address)).to.equal(1n);
    });

    it("mintTool succeeds for an authorised minter", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await expect(farmNFT.connect(owner).mintTool(alice.address, RARE, 25n, 250n, "tool.json"))
        .to.emit(farmNFT, "ItemMinted");
    });

    it("mintCrop succeeds for an authorised minter", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await expect(farmNFT.connect(owner).mintCrop(alice.address, COMMON, 500n, 1n, "crop.json"))
        .to.emit(farmNFT, "ItemMinted");
    });

    it("still rejects an unauthorised caller on every entry point", async function () {
      const { farmNFT, alice } = await withMinter();
      await expect(farmNFT.connect(alice).mintSeed(alice.address, COMMON, 1, 1n, 0n, "x"))
        .to.be.revertedWithCustomError(farmNFT, "NotMinter");
      await expect(farmNFT.connect(alice).mintTool(alice.address, COMMON, 1n, 1n, "x"))
        .to.be.revertedWithCustomError(farmNFT, "NotMinter");
      await expect(farmNFT.connect(alice).mintCrop(alice.address, COMMON, 1n, 0n, "x"))
        .to.be.revertedWithCustomError(farmNFT, "NotMinter");
      await expect(farmNFT.connect(alice).mintItem(alice.address, TOOL, COMMON, 1n, 1n, 0, 0, 0, "x"))
        .to.be.revertedWithCustomError(farmNFT, "NotMinter");
    });
  });

  describe("token ids and stats", function () {
    it("starts ids at 1 so 0 stays a usable sentinel", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      expect(await farmNFT.nextTokenId()).to.equal(1n);
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 300, 10n, 0n, "s");
      expect(await farmNFT.ownerOf(1n)).to.equal(alice.address);
      expect(await farmNFT.itemExists(0n)).to.equal(false);
    });

    it("stores the full stat block", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await farmNFT.connect(owner).mintItem(alice.address, TOOL, RARE, 42n, 99n, 111, 222, 3n, "u.json");
      const item = await farmNFT.getItem(1n);
      expect(item.itemType).to.equal(TOOL);
      expect(item.rarity).to.equal(RARE);
      expect(item.power).to.equal(42n);
      expect(item.durability).to.equal(99n);
      expect(item.growthTime).to.equal(111n);
      expect(item.yieldAmount).to.equal(222n);
      expect(item.seedTypeId).to.equal(3n);
    });

    it("reverts getItem on an unknown token but tryGetItem does not", async function () {
      const { farmNFT } = await withMinter();
      await expect(farmNFT.getItem(999n)).to.be.revertedWithCustomError(farmNFT, "ItemDoesNotExist");
      const [found] = await farmNFT.tryGetItem(999n);
      expect(found).to.equal(false);
    });

    it("composes tokenURI from the base URI", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 300, 10n, 0n, "seeds/wheat.json");
      expect(await farmNFT.tokenURI(1n)).to.equal(`${BASE_URI}seeds/wheat.json`);
    });

    it("rejects minting to the zero address", async function () {
      const { farmNFT, owner } = await withMinter();
      await expect(farmNFT.connect(owner).mintSeed(ZeroAddress, COMMON, 1, 1n, 0n, "x"))
        .to.be.revertedWithCustomError(farmNFT, "ZeroAddress");
    });
  });

  describe("burning authorisation", function () {
    it("lets the owner burn their own token", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "x");
      await expect(farmNFT.connect(alice).burn(1n))
        .to.emit(farmNFT, "ItemBurned").withArgs(1n, alice.address);
      expect(await farmNFT.itemExists(1n)).to.equal(false);
    });

    it("lets an ERC-721 approved operator burn", async function () {
      const { farmNFT, owner, alice, bob } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "x");
      await farmNFT.connect(alice).approve(bob.address, 1n);
      await expect(farmNFT.connect(bob).burn(1n)).to.not.be.reverted;
    });

    it("blocks an unrelated account from burning", async function () {
      const { farmNFT, owner, alice, bob } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "x");
      await expect(farmNFT.connect(bob).burn(1n))
        .to.be.revertedWithCustomError(farmNFT, "NotOwnerNorApproved");
    });

    /**
     * The old contract let ANY minter burn ANY token with no owner check, so a
     * single ordering bug in GameManager could destroy a bystander's item.
     */
    it("gameBurn requires the caller to name the correct owner", async function () {
      const { farmNFT, owner, alice, bob } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "x");
      await expect(farmNFT.connect(owner).gameBurn(1n, bob.address))
        .to.be.revertedWithCustomError(farmNFT, "UnexpectedOwner")
        .withArgs(1n, bob.address, alice.address);
      await expect(farmNFT.connect(owner).gameBurn(1n, alice.address)).to.not.be.reverted;
    });

    it("gameBurn is minter-only", async function () {
      const { farmNFT, owner, alice, bob } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "x");
      await expect(farmNFT.connect(bob).gameBurn(1n, alice.address))
        .to.be.revertedWithCustomError(farmNFT, "NotMinter");
    });

    it("burning a non-existent token reverts", async function () {
      const { farmNFT, alice } = await withMinter();
      await expect(farmNFT.connect(alice).burn(42n))
        .to.be.revertedWithCustomError(farmNFT, "ItemDoesNotExist");
    });
  });

  describe("durability", function () {
    it("updates a tool's durability", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await farmNFT.connect(owner).mintTool(alice.address, COMMON, 10n, 100n, "t");
      await expect(farmNFT.connect(owner).updateDurability(1n, 50n))
        .to.emit(farmNFT, "DurabilityUpdated").withArgs(1n, 50n);
      expect((await farmNFT.getItem(1n)).durability).to.equal(50n);
    });

    it("refuses to set durability on a non-tool", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "s");
      await expect(farmNFT.connect(owner).updateDurability(1n, 5n))
        .to.be.revertedWithCustomError(farmNFT, "NotATool");
    });
  });

  describe("enumeration", function () {
    it("paginates inventory with stats attached", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      for (let i = 0; i < 5; i++) {
        await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 100 * (i + 1), BigInt(i), BigInt(i), "s");
      }
      const [ids, items] = await farmNFT.getInventory(alice.address, 1, 2);
      expect(ids.length).to.equal(2);
      expect(items.length).to.equal(2);
      expect(items[0].growthTime).to.equal(200n);
      expect(items[1].growthTime).to.equal(300n);

      const [emptyIds] = await farmNFT.getInventory(alice.address, 99, 10);
      expect(emptyIds.length).to.equal(0);
    });

    it("clamps the page to the remaining balance", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "s");
      const [ids] = await farmNFT.getInventory(alice.address, 0, 100);
      expect(ids.length).to.equal(1);
    });

    it("lists all token ids for an owner", async function () {
      const { farmNFT, owner, alice } = await withMinter();
      await farmNFT.connect(owner).mintSeed(alice.address, COMMON, 1, 1n, 0n, "s");
      await farmNFT.connect(owner).mintTool(alice.address, COMMON, 1n, 1n, "t");
      expect((await farmNFT.getTokensByOwner(alice.address)).map(Number)).to.deep.equal([1, 2]);
    });
  });
});
