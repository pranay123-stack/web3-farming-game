// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMarketplace {
    function buyItem(uint256 listingId, uint256 maxPrice) external;
    function cancelListing(uint256 listingId) external;
}

/**
 * @dev Test-only. Attempts to re-enter Marketplace from the ERC-721 receiver
 *      hook fired while the purchased token is being delivered.
 */
contract MaliciousBuyer is IERC721Receiver {
    IMarketplace public immutable marketplace;
    IERC20 public immutable token;
    uint256 public targetListing;
    bool public reentered;
    bool public attackArmed;

    constructor(address _marketplace, address _token) {
        marketplace = IMarketplace(_marketplace);
        token = IERC20(_token);
    }

    function approveToken(uint256 amount) external {
        token.approve(address(marketplace), amount);
    }

    function attack(uint256 listingId, uint256 maxPrice) external {
        targetListing = listingId;
        attackArmed = true;
        marketplace.buyItem(listingId, maxPrice);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        if (attackArmed) {
            attackArmed = false;
            // Re-entry attempt. ReentrancyGuard must make this revert; we
            // record whether it unexpectedly succeeded.
            try marketplace.buyItem(targetListing, type(uint256).max) {
                reentered = true;
            } catch {
                reentered = false;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
