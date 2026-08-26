# Web3 Farming Game - GameFi Project

A browser-based Web3 farming game inspired by Pixels.xyz, featuring real-time multiplayer interactions, on-chain economy, and NFT integration.

![Game Screenshot](https://img.shields.io/badge/Status-Live%20on%20Sepolia-green)
![Solidity](https://img.shields.io/badge/Solidity-0.8.20-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Smart Contracts](#smart-contracts)
- [Getting Started](#getting-started)
- [Deployment](#deployment)
- [Game Controls](#game-controls)
- [API Reference](#api-reference)
- [Contributing](#contributing)

## Overview

This is a full-stack GameFi (Game + DeFi) project that combines:
- **Play-to-Earn mechanics** - Farm crops, earn tokens
- **NFT ownership** - Land, items, and crops as tradeable NFTs
- **Real-time multiplayer** - See and chat with other players
- **On-chain economy** - All transactions on Ethereum (Sepolia testnet)

## Features

### Core Gameplay
- Plant and harvest crops (wheat, corn, tomato, golden apple)
- Craft tools and items
- Buy/sell land plots as NFTs
- Trade on the marketplace

### Web3 Integration
- MetaMask wallet connection
- ERC20 token (FGOLD) for in-game currency
- ERC721 NFTs for land and items
- Gasless guest mode for new players

### Multiplayer
- Real-time player positions via WebSocket
- Global and nearby chat
- Zone-based player management

## Tech Stack

### Frontend
| Technology | Purpose |
|------------|---------|
| Next.js 14 | React framework |
| Phaser 3 | Game engine |
| Tailwind CSS | Styling |
| ethers.js v6 | Blockchain interaction |
| Zustand | State management |

### Backend
| Technology | Purpose |
|------------|---------|
| Node.js | Runtime |
| Express | HTTP server |
| Socket.io | Real-time communication |
| TypeScript | Type safety |

### Smart Contracts
| Technology | Purpose |
|------------|---------|
| Solidity 0.8.20 | Contract language |
| Hardhat | Development framework |
| OpenZeppelin | Security standards |

## Project Structure

```
web3-farming-game/
├── contracts/                 # Solidity smart contracts
│   ├── FarmToken.sol         # ERC20 game token (FGOLD)
│   ├── FarmNFT.sol           # ERC721 items/avatars
│   ├── FarmLand.sol          # ERC721 land plots
│   ├── GameManager.sol       # Core game logic
│   └── Marketplace.sol       # NFT trading
│
├── frontend/                  # Next.js application
│   ├── app/                  # App router pages
│   │   ├── page.tsx          # Landing page
│   │   └── game/page.tsx     # Game page
│   ├── components/           # React components
│   │   ├── GameCanvas.tsx    # Phaser wrapper
│   │   ├── WalletConnect.tsx # MetaMask connection
│   │   ├── Inventory.tsx     # Player inventory
│   │   └── Chat.tsx          # Multiplayer chat
│   ├── game/                 # Phaser game code
│   │   ├── scenes/           # Game scenes
│   │   └── sprites/          # Player sprites
│   ├── hooks/                # React hooks
│   │   ├── useWallet.ts      # Wallet connection
│   │   └── useGameContract.ts# Contract interactions
│   └── lib/                  # Utilities
│       └── contracts.ts      # ABIs & addresses
│
├── server/                    # Multiplayer backend
│   └── src/
│       ├── index.ts          # Express + Socket.io
│       ├── socket/           # Socket handlers
│       └── game/             # Player/Zone managers
│
├── scripts/                   # Deployment scripts
│   └── deploy.js             # Main deployment
│
└── hardhat.config.js         # Hardhat configuration
```

## Smart Contracts

### Deployed on Sepolia Testnet

| Contract | Address | Etherscan |
|----------|---------|-----------|
| FarmToken (FGOLD) | `0x45bCa7f82B0D15Bd927c6cc92B9478E25a2fDdc1` | [View](https://sepolia.etherscan.io/address/0x45bCa7f82B0D15Bd927c6cc92B9478E25a2fDdc1) |
| FarmNFT (FITEM) | `0xdF980a7074fdEe748e803ecA46d896e55486004f` | [View](https://sepolia.etherscan.io/address/0xdF980a7074fdEe748e803ecA46d896e55486004f) |
| FarmLand (FLAND) | `0x9e9f9407832dD5bcCe8e52f42d4b4D8f123cF642` | [View](https://sepolia.etherscan.io/address/0x9e9f9407832dD5bcCe8e52f42d4b4D8f123cF642) |
| GameManager | `0xaA85d4c08296c6C80f0AEbd0044A0aD5C1C7c5c5` | [View](https://sepolia.etherscan.io/address/0xaA85d4c08296c6C80f0AEbd0044A0aD5C1C7c5c5) |
| Marketplace | `0x72FE19AF0A651a1dffaFf569BC0f2c9be031B8F2` | [View](https://sepolia.etherscan.io/address/0x72FE19AF0A651a1dffaFf569BC0f2c9be031B8F2) |

### Contract Features

**FarmToken.sol (ERC20)**
- Mintable by GameManager
- Burnable for crafting
- Used for all in-game transactions

**FarmNFT.sol (ERC721)**
- Items, tools, and crop NFTs
- Metadata URI support
- Rarity system (Common, Uncommon, Rare, Epic, Legendary)

**FarmLand.sol (ERC721)**
- Limited supply (1000 plots)
- Coordinate-based (x, y)
- Mintable with ETH

**GameManager.sol**
- Plant crops (burns seeds, locks land)
- Harvest crops (mints tokens based on growth time)
- Craft items (burns tokens, mints NFTs)
- Player stats tracking

**Marketplace.sol**
- List NFTs for sale
- Buy with FGOLD tokens
- 2.5% marketplace fee

## Getting Started

### Prerequisites

- Node.js 18+
- MetaMask browser extension
- Sepolia testnet ETH (get from [faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia))

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/pranay123-stack/web3-projects.git
cd "web3-projects/Gamefi web3/web3-farming-game"
```

2. **Install dependencies**
```bash
# Root dependencies (Hardhat)
npm install

# Frontend dependencies
cd frontend && npm install

# Backend dependencies
cd ../server && npm install
```

3. **Set up environment variables**
```bash
# In root directory
cp .env.example .env
# Edit .env with your values
```

4. **Start the development servers**

Terminal 1 - Frontend:
```bash
cd frontend
npm run dev
```

Terminal 2 - Backend:
```bash
cd server
npm start
```

5. **Open the game**
```
http://localhost:3000
```

### Environment Variables

```env
# .env (root - for contract deployment)
SEPOLIA_RPC_URL=https://rpc.sepolia.org
PRIVATE_KEY=your_private_key_here

# frontend/.env.local (optional)
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001
```

## Deployment

### Deploy to Sepolia Testnet

1. **Get Sepolia ETH** from a [faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)

2. **Configure .env** with your private key

3. **Deploy contracts**
```bash
npx hardhat run scripts/deploy.js --network sepolia
```

4. **Update frontend** with new contract addresses in `frontend/lib/contracts.ts`

### Deploy Frontend to Vercel

```bash
cd frontend
vercel
```

### Deploy Backend

The Socket.io server can be deployed to:
- Railway
- Render
- Fly.io
- Any Node.js hosting

## Game Controls

| Key | Action |
|-----|--------|
| W / ↑ | Move Up |
| A / ← | Move Left |
| S / ↓ | Move Down |
| D / → | Move Right |
| Mouse Wheel | Zoom In/Out |
| Left Click | Interact with tile |

### Gameplay Actions

1. **Connect Wallet** - Click "Connect Wallet" to link MetaMask
2. **Plant Crops** - Select "Plant" → Click empty dirt tile
3. **Harvest** - Select "Harvest" → Click ready crop (with sparkles)
4. **Craft** - Open Inventory → Craft tab → Select recipe

## API Reference

### Socket.io Events

**Client → Server**
```typescript
// Join game
socket.emit('player:join', { address: '0x...', x: 10, y: 10 })

// Move player
socket.emit('player:move', { x: 11, y: 10 })

// Send chat message
socket.emit('chat:message', { text: 'Hello!' })

// Game action
socket.emit('game:action', { type: 'plant', plotId: 5, seedType: 1 })
```

**Server → Client**
```typescript
// Player joined
socket.on('player:joined', { id, address, x, y })

// Player moved
socket.on('player:moved', { id, x, y })

// Chat message received
socket.on('chat:receive', { from, text, timestamp })

// Sync all players
socket.on('sync:players', [{ id, address, x, y }, ...])
```

### Smart Contract Functions

**GameManager**
```solidity
// Plant a crop
function plantCrop(uint256 plotId, uint256 seedType) external

// Harvest a crop
function harvestCrop(uint256 plotId) external

// Craft an item
function craftItem(uint256 recipeId) external

// Get player stats
function getPlayerStats(address player) view returns (uint256 level, uint256 exp, uint256 harvests)
```

## Free RPC Endpoints

No API key needed:

| Provider | URL |
|----------|-----|
| Sepolia.org | `https://rpc.sepolia.org` |
| PublicNode | `https://ethereum-sepolia.publicnode.com` |
| DRPC | `https://sepolia.drpc.org` |

## Screenshots

### Landing Page
- Hero section with animated logo
- Feature cards
- Play Now / Connect Wallet buttons

### Game View
- Tile-based farm map
- Player characters with wallet addresses
- Inventory sidebar
- Chat panel
- Mini-map

## Roadmap

- [ ] Mobile responsive design
- [ ] More crop types
- [ ] Seasonal events
- [ ] Guild system
- [ ] PvP farming competitions
- [ ] Mainnet deployment

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Acknowledgments

- Inspired by [Pixels.xyz](https://pixels.xyz)
- Built with [OpenZeppelin](https://openzeppelin.com) contracts
- Game engine by [Phaser](https://phaser.io)

---

**Made with love for the Web3 gaming community**
