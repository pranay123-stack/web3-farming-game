// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface IGameManager {
    function harvestCrop(uint256 landTokenId) external returns (uint256);
    function claimStarterPack() external returns (uint256);
}

/**
 * @dev Test-only. Re-enters GameManager.harvestCrop from the ERC-721 receiver
 *      hook fired when the harvested crop NFT is minted, attempting to claim
 *      the same harvest twice.
 */
contract MaliciousReceiver is IERC721Receiver {
    IGameManager public immutable game;
    uint256 public targetLand;
    bool public armed;
    bool public reentered;

    constructor(address _game) {
        game = IGameManager(_game);
    }

    function claim() external returns (uint256) {
        return game.claimStarterPack();
    }

    function arm(uint256 landTokenId) external {
        targetLand = landTokenId;
        armed = true;
    }

    function callHarvest(uint256 landTokenId) external {
        game.harvestCrop(landTokenId);
    }

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external override returns (bytes4) {
        if (armed) {
            armed = false;
            try game.harvestCrop(targetLand) {
                reentered = true;
            } catch {
                reentered = false;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}
