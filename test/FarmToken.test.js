const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const hre = require("hardhat");
const { deployGameFixture, fundPlayer } = require("./helpers/fixtures");

const { parseEther, ZeroAddress } = hre.ethers;

describe("FarmToken (FGOLD)", function () {
  describe("deployment", function () {
    it("uses the expected name, symbol and decimals", async function () {
      const { farmToken } = await loadFixture(deployGameFixture);
      expect(await farmToken.name()).to.equal("Farm Gold");
      expect(await farmToken.symbol()).to.equal("FGOLD");
      expect(await farmToken.decimals()).to.equal(18);
    });

    it("mints no initial supply when configured with zero", async function () {
      const { farmToken } = await loadFixture(deployGameFixture);
      expect(await farmToken.totalSupply()).to.equal(0n);
    });

    it("mints the initial supply to the owner when requested", async function () {
      const [owner] = await hre.ethers.getSigners();
      const FarmToken = await hre.ethers.getContractFactory("FarmToken");
      const token = await FarmToken.deploy(owner.address, parseEther("1000"));
      expect(await token.balanceOf(owner.address)).to.equal(parseEther("1000"));
    });

    it("rejects a zero owner", async function () {
      const FarmToken = await hre.ethers.getContractFactory("FarmToken");
      await expect(FarmToken.deploy(ZeroAddress, 0)).to.be.reverted;
    });
  });

  describe("minter access control", function () {
    it("registers GameManager as the only minter after deployment", async function () {
      const { farmToken, gameManager, owner } = await loadFixture(deployGameFixture);
      expect(await farmToken.isMinter(await gameManager.getAddress())).to.equal(true);
      expect(await farmToken.isMinter(owner.address)).to.equal(false);
    });

    it("does NOT let the owner mint just by being the owner", async function () {
      const { farmToken, owner, alice } = await loadFixture(deployGameFixture);
      await expect(farmToken.connect(owner).mint(alice.address, parseEther("1")))
        .to.be.revertedWithCustomError(farmToken, "NotMinter");
    });

    it("blocks an arbitrary caller from minting", async function () {
      const { farmToken, alice } = await loadFixture(deployGameFixture);
      await expect(farmToken.connect(alice).mint(alice.address, parseEther("1")))
        .to.be.revertedWithCustomError(farmToken, "NotMinter");
    });

    it("blocks a non-owner from granting minter rights", async function () {
      const { farmToken, alice, bob } = await loadFixture(deployGameFixture);
      await expect(farmToken.connect(alice).addMinter(bob.address))
        .to.be.revertedWithCustomError(farmToken, "OwnableUnauthorizedAccount");
    });

    it("emits on add and remove, and revokes effectively", async function () {
      const { farmToken, owner, alice } = await loadFixture(deployGameFixture);
      await expect(farmToken.addMinter(alice.address))
        .to.emit(farmToken, "MinterAdded").withArgs(alice.address);
      await farmToken.connect(alice).mint(alice.address, parseEther("5"));

      await expect(farmToken.removeMinter(alice.address))
        .to.emit(farmToken, "MinterRemoved").withArgs(alice.address);
      await expect(farmToken.connect(alice).mint(alice.address, parseEther("5")))
        .to.be.revertedWithCustomError(farmToken, "NotMinter");
    });

    it("rejects duplicate and unknown minter administration", async function () {
      const { farmToken, alice } = await loadFixture(deployGameFixture);
      await farmToken.addMinter(alice.address);
      await expect(farmToken.addMinter(alice.address))
        .to.be.revertedWithCustomError(farmToken, "AlreadyMinter");
      await farmToken.removeMinter(alice.address);
      await expect(farmToken.removeMinter(alice.address))
        .to.be.revertedWithCustomError(farmToken, "NotAMinter");
    });

    it("rejects a zero-address minter", async function () {
      const { farmToken } = await loadFixture(deployGameFixture);
      await expect(farmToken.addMinter(ZeroAddress))
        .to.be.revertedWithCustomError(farmToken, "ZeroAddress");
    });
  });

  describe("minting bounds", function () {
    it("rejects a mint to the zero address", async function () {
      const { farmToken, alice } = await loadFixture(deployGameFixture);
      await farmToken.addMinter(alice.address);
      await expect(farmToken.connect(alice).mint(ZeroAddress, 1n))
        .to.be.revertedWithCustomError(farmToken, "ZeroAddress");
    });

    it("caps a single mint at MAX_MINT_PER_TX", async function () {
      const { farmToken, alice } = await loadFixture(deployGameFixture);
      await farmToken.addMinter(alice.address);
      const cap = await farmToken.MAX_MINT_PER_TX();
      await expect(farmToken.connect(alice).mint(alice.address, cap + 1n))
        .to.be.revertedWithCustomError(farmToken, "MintAmountTooLarge");
      await expect(farmToken.connect(alice).mint(alice.address, cap)).to.not.be.reverted;
    });
  });

  describe("burning and allowances", function () {
    it("lets a holder burn their own balance", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { farmToken, alice } = ctx;
      await fundPlayer(ctx, alice, parseEther("100"));
      await farmToken.connect(alice).burn(parseEther("40"));
      expect(await farmToken.balanceOf(alice.address)).to.equal(parseEther("60"));
      expect(await farmToken.totalSupply()).to.equal(parseEther("60"));
    });

    it("requires an allowance for burnFrom and spends it", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { farmToken, alice, bob } = ctx;
      await fundPlayer(ctx, alice, parseEther("100"));

      await expect(farmToken.connect(bob).burnFrom(alice.address, parseEther("10")))
        .to.be.revertedWithCustomError(farmToken, "ERC20InsufficientAllowance");

      await farmToken.connect(alice).approve(bob.address, parseEther("30"));
      await farmToken.connect(bob).burnFrom(alice.address, parseEther("10"));
      expect(await farmToken.allowance(alice.address, bob.address)).to.equal(parseEther("20"));
      expect(await farmToken.balanceOf(alice.address)).to.equal(parseEther("90"));
    });

    it("cannot burn more than the balance", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { farmToken, alice } = ctx;
      await fundPlayer(ctx, alice, parseEther("10"));
      await expect(farmToken.connect(alice).burn(parseEther("11")))
        .to.be.revertedWithCustomError(farmToken, "ERC20InsufficientBalance");
    });

    it("supports EIP-2612 permit for gasless approval", async function () {
      const ctx = await loadFixture(deployGameFixture);
      const { farmToken, alice, gameManager } = ctx;
      const spender = await gameManager.getAddress();
      const value = parseEther("123");
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const nonce = await farmToken.nonces(alice.address);

      const domain = {
        name: "Farm Gold",
        version: "1",
        chainId: (await hre.ethers.provider.getNetwork()).chainId,
        verifyingContract: await farmToken.getAddress(),
      };
      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };
      const signature = await alice.signTypedData(domain, types, {
        owner: alice.address, spender, value, nonce, deadline,
      });
      const { v, r, s } = hre.ethers.Signature.from(signature);

      await farmToken.permit(alice.address, spender, value, deadline, v, r, s);
      expect(await farmToken.allowance(alice.address, spender)).to.equal(value);
    });
  });

  describe("two-step ownership", function () {
    it("requires the new owner to accept", async function () {
      const { farmToken, owner, alice } = await loadFixture(deployGameFixture);
      await farmToken.connect(owner).transferOwnership(alice.address);
      expect(await farmToken.owner()).to.equal(owner.address);
      await farmToken.connect(alice).acceptOwnership();
      expect(await farmToken.owner()).to.equal(alice.address);
    });
  });
});
