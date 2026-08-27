const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const { deployGameFixture, fundPlayer, onboard, lastMintedNFT } = require("./helpers/fixtures");
const { MARKETPLACE } = require("../config/gameContent");

const { parseEther, ZeroAddress, MaxUint256 } = hre.ethers;

describe("Marketplace", function () {
  /** Gives `player` a tool NFT and approves the marketplace to escrow it. */
  async function withListableItem(ctx, player) {
    const { gameManager, farmNFT, marketplace } = ctx;
    await onboard(ctx, player);
    await fundPlayer(ctx, player, parseEther("5000"));
    await gameManager.connect(player).craftItem(0, []); // Basic Hoe
    const tokenId = await lastMintedNFT(ctx, player);
    await farmNFT.connect(player).setApprovalForAll(await marketplace.getAddress(), true);
    return tokenId;
  }

  async function listed(price = parseEther("1000")) {
    const ctx = await loadFixture(deployGameFixture);
    const tokenId = await withListableItem(ctx, ctx.alice);
    const nftAddress = await ctx.farmNFT.getAddress();
    await ctx.marketplace.connect(ctx.alice).listItem(nftAddress, tokenId, price);
    const listingId = await ctx.marketplace.listingIdCounter();
    return { ...ctx, tokenId, listingId, nftAddress, price };
  }

  describe("listing", function () {
    it("escrows the NFT and records the listing", async function () {
      const { marketplace, farmNFT, alice, tokenId, listingId } = await listed();
      expect(await farmNFT.ownerOf(tokenId)).to.equal(await marketplace.getAddress());
      const listing = await marketplace.getListing(listingId);
      expect(listing.seller).to.equal(alice.address);
      expect(listing.isActive).to.equal(true);
      expect(await marketplace.activeListingCount()).to.equal(1n);
    });

    it("requires whitelisting, ownership, approval and a non-zero price", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { marketplace, farmNFT, owner, alice, bob } = ctx;
      const tokenId = await withListableItem(ctx, alice);
      const nftAddress = await farmNFT.getAddress();

      await marketplace.connect(owner).setNFTWhitelist(nftAddress, false);
      await expect(marketplace.connect(alice).listItem(nftAddress, tokenId, parseEther("1")))
        .to.be.revertedWithCustomError(marketplace, "NotWhitelisted");
      await marketplace.connect(owner).setNFTWhitelist(nftAddress, true);

      await expect(marketplace.connect(alice).listItem(nftAddress, tokenId, 0))
        .to.be.revertedWithCustomError(marketplace, "PriceMustBePositive");

      await expect(marketplace.connect(bob).listItem(nftAddress, tokenId, parseEther("1")))
        .to.be.revertedWithCustomError(marketplace, "NotTokenOwner");

      await farmNFT.connect(alice).setApprovalForAll(await marketplace.getAddress(), false);
      await expect(marketplace.connect(alice).listItem(nftAddress, tokenId, parseEther("1")))
        .to.be.revertedWithCustomError(marketplace, "NotApproved");
    });

    it("refuses to list the same token twice", async function () {
      const { marketplace, alice, tokenId, nftAddress } = await listed();
      await expect(marketplace.connect(alice).listItem(nftAddress, tokenId, parseEther("5")))
        .to.be.revertedWithCustomError(marketplace, "NotTokenOwner"); // escrowed, so no longer owned
    });

    it("starts listing ids at 1 so 0 stays the not-listed sentinel", async function () {
      const { marketplace, listingId, nftAddress, tokenId } = await listed();
      expect(listingId).to.equal(1n);
      expect(await marketplace.getListingIdForNFT(nftAddress, 999n)).to.equal(0n);
      expect(await marketplace.getListingIdForNFT(nftAddress, tokenId)).to.equal(1n);
    });
  });

  describe("buying", function () {
    async function readyBuyer(ctx, price) {
      await fundPlayer(ctx, ctx.bob, price * 2n);
      await ctx.farmToken.connect(ctx.bob).approve(await ctx.marketplace.getAddress(), MaxUint256);
    }

    it("settles payment, fee and delivery atomically", async function () {
      const ctx = await listed();
      const { marketplace, farmToken, farmNFT, alice, bob, tokenId, listingId, price } = ctx;
      await readyBuyer(ctx, price);

      const sellerBefore = await farmToken.balanceOf(alice.address);
      const buyerBefore = await farmToken.balanceOf(bob.address);

      await expect(marketplace.connect(bob).buyItem(listingId, price))
        .to.emit(marketplace, "ItemSold");

      const fee = (price * BigInt(MARKETPLACE.feeBps)) / 10000n;
      expect(await farmToken.balanceOf(alice.address)).to.equal(sellerBefore + price - fee);
      expect(await farmToken.balanceOf(bob.address)).to.equal(buyerBefore - price);
      expect(await marketplace.accumulatedFees()).to.equal(fee);
      expect(await farmNFT.ownerOf(tokenId)).to.equal(bob.address);
      expect((await marketplace.getListing(listingId)).isActive).to.equal(false);
      expect(await marketplace.activeListingCount()).to.equal(0n);
    });

    /**
     * Regression: buyItem previously took no price bound, so a seller could
     * watch the mempool and raise the price before the buy landed.
     */
    it("reverts when the price exceeds the buyer's stated maximum", async function () {
      const ctx = await listed();
      const { marketplace, alice, bob, listingId, price } = ctx;
      await readyBuyer(ctx, price * 4n);

      await marketplace.connect(alice).updateListingPrice(listingId, price * 3n);
      await expect(marketplace.connect(bob).buyItem(listingId, price))
        .to.be.revertedWithCustomError(marketplace, "PriceExceedsMaximum");
    });

    it("blocks a same-block reprice-then-fill", async function () {
      const ctx = await listed();
      const { marketplace, alice, bob, listingId, price } = ctx;
      await readyBuyer(ctx, price * 10n);

      // Mine both transactions into one block, reprice first.
      await hre.network.provider.send("evm_setAutomine", [false]);
      await marketplace.connect(alice).updateListingPrice(listingId, price * 2n);
      const buyTx = await marketplace.connect(bob).buyItem(listingId, price * 5n);
      await hre.network.provider.send("evm_mine");
      await hre.network.provider.send("evm_setAutomine", [true]);

      await expect(buyTx.wait()).to.be.rejected;
      expect((await marketplace.getListing(listingId)).isActive).to.equal(true);
    });

    it("lets a price cut take effect immediately", async function () {
      const ctx = await listed();
      const { marketplace, alice, bob, listingId, price } = ctx;
      await readyBuyer(ctx, price);
      await marketplace.connect(alice).updateListingPrice(listingId, price / 2n);
      await expect(marketplace.connect(bob).buyItem(listingId, price)).to.not.be.reverted;
    });

    it("refuses to buy your own listing, an inactive listing, or without funds", async function () {
      const ctx = await listed();
      const { marketplace, farmToken, alice, bob, carol, listingId, price } = ctx;
      await readyBuyer(ctx, price);

      await expect(marketplace.connect(alice).buyItem(listingId, price))
        .to.be.revertedWithCustomError(marketplace, "CannotBuyOwnItem");

      await farmToken.connect(carol).approve(await marketplace.getAddress(), MaxUint256);
      await expect(marketplace.connect(carol).buyItem(listingId, price)).to.be.reverted; // no balance

      await marketplace.connect(bob).buyItem(listingId, price);
      await expect(marketplace.connect(carol).buyItem(listingId, price))
        .to.be.revertedWithCustomError(marketplace, "ListingNotActive");
    });

    it("requires an FGOLD allowance from the buyer", async function () {
      const ctx = await listed();
      const { marketplace, bob, listingId, price } = ctx;
      await fundPlayer(ctx, bob, price * 2n);
      await expect(marketplace.connect(bob).buyItem(listingId, price)).to.be.reverted;
    });

    it("handles a zero fee without paying the marketplace", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { marketplace, farmToken, owner, alice, bob, farmNFT } = ctx;
      await marketplace.connect(owner).setMarketplaceFee(0);
      const tokenId = await withListableItem(ctx, alice);
      await marketplace.connect(alice).listItem(await farmNFT.getAddress(), tokenId, parseEther("100"));
      const listingId = await marketplace.listingIdCounter();

      await fundPlayer(ctx, bob, parseEther("500"));
      await farmToken.connect(bob).approve(await marketplace.getAddress(), MaxUint256);
      const sellerBefore = await farmToken.balanceOf(alice.address);
      await marketplace.connect(bob).buyItem(listingId, parseEther("100"));
      expect(await farmToken.balanceOf(alice.address)).to.equal(sellerBefore + parseEther("100"));
      expect(await marketplace.accumulatedFees()).to.equal(0n);
    });

    it("resists re-entrancy from the buyer's ERC-721 receiver hook", async function () {
      const ctx = await listed();
      const { marketplace, farmToken, listingId, price } = ctx;

      const Malicious = await hre.ethers.getContractFactory("MaliciousBuyer");
      const attacker = await Malicious.deploy(await marketplace.getAddress(), await farmToken.getAddress());
      await attacker.waitForDeployment();

      const attackerAddress = await attacker.getAddress();
      await ctx.farmToken.addMinter(ctx.owner.address);
      await farmToken.connect(ctx.owner).mint(attackerAddress, price * 10n);
      await ctx.farmToken.removeMinter(ctx.owner.address);
      await attacker.approveToken(MaxUint256);

      await attacker.attack(listingId, price);
      expect(await attacker.reentered()).to.equal(false);
      expect(await marketplace.activeListingCount()).to.equal(0n);
    });
  });

  describe("cancelling and repricing", function () {
    it("returns the escrowed NFT to the seller", async function () {
      const { marketplace, farmNFT, alice, tokenId, listingId } = await listed();
      await expect(marketplace.connect(alice).cancelListing(listingId))
        .to.emit(marketplace, "ListingCanceled");
      expect(await farmNFT.ownerOf(tokenId)).to.equal(alice.address);
      expect(await marketplace.activeListingCount()).to.equal(0n);
    });

    it("only the seller may cancel - not even the owner", async function () {
      const { marketplace, owner, bob, listingId } = await listed();
      await expect(marketplace.connect(bob).cancelListing(listingId))
        .to.be.revertedWithCustomError(marketplace, "NotSeller");
      await expect(marketplace.connect(owner).cancelListing(listingId))
        .to.be.revertedWithCustomError(marketplace, "NotSeller");
    });

    it("refuses to cancel twice", async function () {
      const { marketplace, alice, listingId } = await listed();
      await marketplace.connect(alice).cancelListing(listingId);
      await expect(marketplace.connect(alice).cancelListing(listingId))
        .to.be.revertedWithCustomError(marketplace, "ListingNotActive");
    });

    it("only the seller may reprice, and never to zero", async function () {
      const { marketplace, alice, bob, listingId } = await listed();
      await expect(marketplace.connect(bob).updateListingPrice(listingId, parseEther("1")))
        .to.be.revertedWithCustomError(marketplace, "NotSeller");
      await expect(marketplace.connect(alice).updateListingPrice(listingId, 0))
        .to.be.revertedWithCustomError(marketplace, "PriceMustBePositive");
    });

    it("relists a cancelled item cleanly", async function () {
      const { marketplace, alice, tokenId, listingId, nftAddress } = await listed();
      await marketplace.connect(alice).cancelListing(listingId);
      await expect(marketplace.connect(alice).listItem(nftAddress, tokenId, parseEther("50")))
        .to.emit(marketplace, "ItemListed");
      expect(await marketplace.activeListingCount()).to.equal(1n);
    });
  });

  describe("enumeration", function () {
    it("pages active listings and keeps the index dense after removals", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { marketplace, farmNFT, alice } = ctx;
      await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("50000"));
      await farmNFT.connect(alice).setApprovalForAll(await marketplace.getAddress(), true);
      const nftAddress = await farmNFT.getAddress();

      const ids = [];
      for (let i = 0; i < 5; i++) {
        await ctx.gameManager.connect(alice).craftItem(1, []); // Watering Can
        const tokenId = await lastMintedNFT(ctx, alice);
        await marketplace.connect(alice).listItem(nftAddress, tokenId, parseEther(String(10 * (i + 1))));
        ids.push(await marketplace.listingIdCounter());
      }
      expect(await marketplace.activeListingCount()).to.equal(5n);

      // Cancel one in the middle; enumeration must stay consistent.
      await marketplace.connect(alice).cancelListing(ids[2]);
      expect(await marketplace.activeListingCount()).to.equal(4n);

      const [page, pageIds] = await marketplace.getActiveListings(0, 10);
      expect(page.length).to.equal(4);
      expect(pageIds.map(Number)).to.not.include(Number(ids[2]));
      for (const listing of page) expect(listing.isActive).to.equal(true);

      const [page2] = await marketplace.getActiveListings(2, 2);
      expect(page2.length).to.equal(2);
      const [empty] = await marketplace.getActiveListings(99, 10);
      expect(empty.length).to.equal(0);
    });

    it("lists a seller's active listings only", async function () {
      const ctx = await listed();
      const { marketplace, alice, listingId } = ctx;
      let [listings] = await marketplace.getListingsBySeller(alice.address);
      expect(listings.length).to.equal(1);
      await marketplace.connect(alice).cancelListing(listingId);
      [listings] = await marketplace.getListingsBySeller(alice.address);
      expect(listings.length).to.equal(0);
    });
  });

  describe("fees and recovery", function () {
    it("withdraws accumulated fees once", async function () {
      const ctx = await listed();
      const { marketplace, farmToken, owner, bob, carol, listingId, price } = ctx;
      await fundPlayer(ctx, bob, price * 2n);
      await farmToken.connect(bob).approve(await marketplace.getAddress(), MaxUint256);
      await marketplace.connect(bob).buyItem(listingId, price);

      const fee = (price * BigInt(MARKETPLACE.feeBps)) / 10000n;
      await expect(marketplace.connect(owner).withdrawFees(carol.address))
        .to.emit(marketplace, "FeesWithdrawn").withArgs(carol.address, fee);
      expect(await farmToken.balanceOf(carol.address)).to.equal(fee);
      await expect(marketplace.connect(owner).withdrawFees(carol.address))
        .to.be.revertedWithCustomError(marketplace, "NoFeesToWithdraw");
    });

    it("rejects a fee above the hard cap", async function () {
      const { marketplace, owner } = await loadFixture(deployGameFixture);
      const max = await marketplace.MAX_FEE();
      await expect(marketplace.connect(owner).setMarketplaceFee(max + 1n))
        .to.be.revertedWithCustomError(marketplace, "FeeTooHigh");
    });

    /**
     * Regression: rescueNFT used to cancel any active listing and forward the
     * escrowed token anywhere the owner chose - an operator seizure lever.
     */
    it("refuses to rescue an actively listed NFT", async function () {
      const { marketplace, owner, carol, nftAddress, tokenId } = await listed();
      await expect(marketplace.connect(owner).rescueNFT(nftAddress, tokenId, carol.address))
        .to.be.revertedWithCustomError(marketplace, "TokenIsListed");
    });

    it("still rescues a token that was never listed", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { marketplace, farmNFT, owner, alice, carol } = ctx;
      const tokenId = await withListableItem(ctx, alice);
      // Sent directly to the marketplace, bypassing listItem.
      await farmNFT.connect(alice).transferFrom(alice.address, await marketplace.getAddress(), tokenId);
      await expect(marketplace.connect(owner).rescueNFT(await farmNFT.getAddress(), tokenId, carol.address))
        .to.emit(marketplace, "NFTRescued");
      expect(await farmNFT.ownerOf(tokenId)).to.equal(carol.address);
    });

    it("blocks non-owners from treasury and admin functions", async function () {
      const { marketplace, alice, nftAddress } = await listed();
      await expect(marketplace.connect(alice).withdrawFees(alice.address)).to.be.reverted;
      await expect(marketplace.connect(alice).setMarketplaceFee(0)).to.be.reverted;
      await expect(marketplace.connect(alice).setNFTWhitelist(nftAddress, false)).to.be.reverted;
      await expect(marketplace.connect(alice).rescueNFT(nftAddress, 1n, alice.address)).to.be.reverted;
      await expect(marketplace.connect(alice).pause()).to.be.reverted;
    });

    it("rejects a zero recipient for withdrawals and rescues", async function () {
      const { marketplace, owner, nftAddress } = await listed();
      await expect(marketplace.connect(owner).withdrawFees(ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "ZeroAddress");
      await expect(marketplace.connect(owner).rescueNFT(nftAddress, 999n, ZeroAddress))
        .to.be.revertedWithCustomError(marketplace, "ZeroAddress");
    });
  });

  describe("pausing", function () {
    it("halts listing and buying but still allows cancelling", async function () {
      const ctx = await listed();
      const { marketplace, farmToken, owner, bob, listingId, price, alice, nftAddress } = ctx;
      await fundPlayer(ctx, bob, price * 2n);
      await farmToken.connect(bob).approve(await marketplace.getAddress(), MaxUint256);

      await marketplace.connect(owner).pause();
      await expect(marketplace.connect(bob).buyItem(listingId, price))
        .to.be.revertedWithCustomError(marketplace, "EnforcedPause");
      await expect(marketplace.connect(alice).listItem(nftAddress, 1n, price))
        .to.be.revertedWithCustomError(marketplace, "EnforcedPause");

      // Sellers must always be able to recover escrowed goods.
      await expect(marketplace.connect(alice).cancelListing(listingId)).to.not.be.reverted;
    });
  });

  describe("land trading", function () {
    it("trades an unlocked plot but refuses a locked one", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { marketplace, farmLand, gameManager, alice } = ctx;
      const landId = await onboard(ctx, alice);
      await fundPlayer(ctx, alice, parseEther("5000"));
      await farmLand.connect(alice).setApprovalForAll(await marketplace.getAddress(), true);
      const landAddress = await farmLand.getAddress();

      await gameManager.connect(alice).purchaseSeed(0);
      await gameManager.connect(alice).plantCrop(landId, await lastMintedNFT(ctx, alice));
      await expect(marketplace.connect(alice).listItem(landAddress, landId, parseEther("100")))
        .to.be.revertedWithCustomError(farmLand, "PlotIsLocked");
    });
  });
});
