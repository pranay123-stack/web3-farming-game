// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FarmToken
 * @dev ERC20 token for the GameFi farming game - "Farm Gold" (FGOLD)
 * Used as the primary in-game currency for rewards, crafting, and trading
 */
contract FarmToken is ERC20, ERC20Burnable, Ownable {
    // Mapping of addresses authorized to mint tokens (game contracts)
    mapping(address => bool) public minters;

    // Events
    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);

    /**
     * @dev Constructor initializes the token with name "Farm Gold" and symbol "FGOLD"
     * @param initialOwner The address that will own the contract
     */
    constructor(address initialOwner) ERC20("Farm Gold", "FGOLD") Ownable(initialOwner) {
        // Mint initial supply to the owner (1 million tokens for initial distribution)
        _mint(initialOwner, 1_000_000 * 10 ** decimals());
    }

    /**
     * @dev Modifier to check if the caller is a minter
     */
    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "FarmToken: caller is not a minter");
        _;
    }

    /**
     * @dev Adds an address as an authorized minter
     * @param account The address to add as a minter
     */
    function addMinter(address account) external onlyOwner {
        require(account != address(0), "FarmToken: minter is zero address");
        require(!minters[account], "FarmToken: account is already a minter");
        minters[account] = true;
        emit MinterAdded(account);
    }

    /**
     * @dev Removes an address from authorized minters
     * @param account The address to remove as a minter
     */
    function removeMinter(address account) external onlyOwner {
        require(minters[account], "FarmToken: account is not a minter");
        minters[account] = false;
        emit MinterRemoved(account);
    }

    /**
     * @dev Mints new tokens to a specified address
     * Can only be called by authorized minters or the owner
     * @param to The address to receive the minted tokens
     * @param amount The amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyMinter {
        require(to != address(0), "FarmToken: mint to zero address");
        _mint(to, amount);
    }

    /**
     * @dev Burns tokens from the caller's account for crafting
     * Inherited from ERC20Burnable
     * @param amount The amount of tokens to burn
     */
    function burnForCrafting(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @dev Burns tokens from a specified account (with allowance)
     * Used by game contracts for crafting mechanics
     * @param account The account to burn tokens from
     * @param amount The amount of tokens to burn
     */
    function burnFrom(address account, uint256 amount) public override {
        _spendAllowance(account, msg.sender, amount);
        _burn(account, amount);
    }

    /**
     * @dev Checks if an address is an authorized minter
     * @param account The address to check
     * @return bool True if the address is a minter
     */
    function isMinter(address account) external view returns (bool) {
        return minters[account] || account == owner();
    }
}
