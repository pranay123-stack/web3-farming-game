// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title FarmToken
 * @notice "Farm Gold" (FGOLD) - the fungible in-game currency.
 *
 * @dev Supply model
 * ----------------
 * FGOLD is minted by authorised game contracts (the faucet in `GameManager`
 * and crop harvests) and burned when players spend it (seeds, crafting, land
 * upgrades). It is intentionally *uncapped* at the token layer because the
 * emission schedule is a game-design parameter enforced by `GameManager`,
 * not a monetary one. Two guards keep that honest:
 *
 *   1. Only addresses explicitly added via {addMinter} can mint. The
 *      deployment scripts register exactly one: `GameManager`.
 *   2. `MAX_MINT_PER_TX` bounds any single mint, so a compromised or buggy
 *      minter cannot inflate supply to overflow in one transaction.
 *
 * The contract owner deliberately CANNOT mint. Ownership only administers the
 * minter set, which makes the privileged surface auditable on-chain: watch
 * {MinterAdded} / {MinterRemoved} and you have seen every possible inflation
 * source.
 *
 * `Ownable2Step` is used so a mistyped ownership transfer cannot brick the
 * game's admin functions.
 *
 * ERC20Permit is included so the frontend can offer gasless approvals for the
 * spend allowance that `GameManager` requires (see {burnFrom}).
 */
contract FarmToken is ERC20, ERC20Burnable, ERC20Permit, Ownable2Step {
    /// @notice Upper bound on a single mint call. Sanity guard, not a supply cap.
    uint256 public constant MAX_MINT_PER_TX = 1_000_000 ether;

    /// @notice Addresses authorised to mint (game contracts only).
    mapping(address => bool) public minters;

    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);

    error NotMinter(address caller);
    error ZeroAddress();
    error AlreadyMinter(address account);
    error NotAMinter(address account);
    error MintAmountTooLarge(uint256 amount, uint256 maximum);

    /**
     * @param initialOwner Address that will administer the minter set.
     * @param initialSupply Tokens minted to `initialOwner` at deploy time. Used
     *        to seed the treasury that backs the starter-pack faucet; pass 0
     *        for a pure-emission deployment.
     */
    constructor(
        address initialOwner,
        uint256 initialSupply
    ) ERC20("Farm Gold", "FGOLD") ERC20Permit("Farm Gold") Ownable(initialOwner) {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (initialSupply > 0) {
            _mint(initialOwner, initialSupply);
        }
    }

    modifier onlyMinter() {
        if (!minters[msg.sender]) revert NotMinter(msg.sender);
        _;
    }

    /// @notice Authorises `account` to mint FGOLD.
    function addMinter(address account) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        if (minters[account]) revert AlreadyMinter(account);
        minters[account] = true;
        emit MinterAdded(account);
    }

    /// @notice Revokes minting rights from `account`.
    function removeMinter(address account) external onlyOwner {
        if (!minters[account]) revert NotAMinter(account);
        minters[account] = false;
        emit MinterRemoved(account);
    }

    /**
     * @notice Mints `amount` FGOLD to `to`. Restricted to registered minters.
     * @dev The owner is deliberately excluded - see the contract-level notes.
     */
    function mint(address to, uint256 amount) external onlyMinter {
        if (to == address(0)) revert ZeroAddress();
        if (amount > MAX_MINT_PER_TX) revert MintAmountTooLarge(amount, MAX_MINT_PER_TX);
        _mint(to, amount);
    }

    /// @notice True if `account` may mint FGOLD.
    function isMinter(address account) external view returns (bool) {
        return minters[account];
    }
}
