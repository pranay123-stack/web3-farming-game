# Web3 Farming Game

A browser-playable Web3 farming game where land, crops, items and currency are
real tokens on an EVM chain — not rows in a database the operator controls.

[![CI](https://github.com/pranay123-stack/web3-farming-game/actions/workflows/ci.yml/badge.svg)](https://github.com/pranay123-stack/web3-farming-game/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-315%20passing-brightgreen)](#testing)
[![Contract coverage](https://img.shields.io/badge/contract%20coverage-93%25-brightgreen)](#testing)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.20-363636)](contracts/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black)](frontend/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## Web3 Farming Game Overview

Plant a seed, wait out a real growth window, harvest game currency and a crop
NFT, craft it into a tool, sell it to another player, upgrade your land, repeat.

**What makes it a Web3 game rather than a game with a wallet button:** every
economically meaningful action is a transaction settled by a smart contract.
Your plot is an ERC-721 you own. Your harvest mints an ERC-20 the game cannot
confiscate. A trade is an escrowed on-chain settlement, not a database update.
The game server carries player positions and chat, and has no authority over
anything you own — a full compromise of it could not take a single token.

**What is actually implemented:** five Solidity contracts (fungible currency,
land NFTs, item NFTs, a rules engine, a peer-to-peer marketplace), a Next.js +
Phaser 3 game client with full transaction lifecycle handling, and an
Express + Socket.IO presence service with signature-verified wallet identity.
The core loop — claim, buy, plant, wait, harvest, craft, trade, upgrade — is
complete and covered by an automated 42-step playthrough that drives the real
contracts.

**Technology:** Solidity 0.8.20, Hardhat, OpenZeppelin 5, Next.js 14, React 18,
TypeScript, Phaser 3, ethers v6, Zustand, Tailwind, Node.js, Express,
Socket.IO. EVM / Ethereum-compatible, targeting Sepolia.

**Can you play it?** Locally, yes — `npx hardhat node` and four commands, all
documented below. There is no hosted deployment; see
[Deployment status](#deployment-status).

**Can you inspect the contracts?** [`contracts/`](contracts/) — five files,
heavily commented, 151 tests against them.

> **Status: testnet / local development.** Not audited. Not deployed to a
> public network. Not for real funds. See [Security](#security).

---

## Gameplay

### Core loop

```
  CLAIM ──► BUY SEED ──► PLANT ──► WAIT ──► HARVEST ──┐
    │                                                  │
    │                            ┌── FGOLD ────────────┤
    │                            └── crop NFT ─────────┤
    │                                                  ▼
    └──────────── UPGRADE ◄──── CRAFT / TRADE ◄────────┘
```

| Step | What happens on-chain |
|---|---|
| **Claim** | One free land NFT and 500 FGOLD, once per address |
| **Approve** | A single ERC-20 allowance covers every later spend |
| **Buy a seed** | FGOLD burned, seed NFT minted with its stats |
| **Plant** | Plot locks, seed burns, reward is fixed at plant time |
| **Wait** | A real interval measured by block timestamps |
| **Harvest** | FGOLD minted, crop NFT minted, XP granted, plot unlocks |
| **Craft** | FGOLD and crop NFTs burned, tool NFT minted |
| **Trade** | NFT escrowed, settled in FGOLD, fee taken |
| **Upgrade** | FGOLD burned, plot's yield multiplier permanently raised |

### Implemented systems

- **Land** — 1000 ERC-721 plots on a 100×10 grid, each with unique coordinates,
  a fertility roll (50–100) and an upgrade level (0–10). A plot with a crop
  growing on it is locked and cannot be transferred.
- **Crops** — four tiers gated by player level, with real growth windows from
  5 minutes to 4 hours. Harvesting mints both currency and a tradeable crop NFT.
- **Items** — tools and consumables crafted from FGOLD plus harvested crops.
  Stats (power, durability, rarity) are stored on-chain.
- **Progression** — XP from harvesting and crafting; level is *derived* from XP
  by a pure function, so it cannot drift. Levels gate seeds and recipes.
- **Marketplace** — escrowed peer-to-peer trading of items and land, settled in
  FGOLD with a 2.5% fee.
- **Multiplayer** — see other players move in real time, global and nearby chat.

### Controls

`WASD` / arrows to move · click a plot to select or harvest · scroll to zoom.

---

## Web3 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  ON-CHAIN — authoritative for everything you own                │
│                                                                 │
│  FarmToken (FGOLD)   ERC-20 currency, minted only by the game   │
│  FarmLand  (FLAND)   ERC-721 plots, capped at 1000              │
│  FarmNFT   (FITEM)   ERC-721 seeds, crops, tools, consumables   │
│  GameManager         rules: plant, harvest, craft, upgrade      │
│  Marketplace         escrowed P2P trading settled in FGOLD      │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                   contract reads · events ·
                   transaction receipts
                              │
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT — Next.js 14 · Phaser 3 · ethers v6                     │
│                                                                 │
│  GameStateProvider   single owner of all chain-derived state    │
│  useGameActions      every write: preflight → sign → confirm    │
│  MainScene           plots, movement, growth stages, players    │
└─────────────────────────────────────────────────────────────────┘
                              │
                   presence + chat only
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  SERVER — Express · Socket.IO                                   │
│                                                                 │
│  Signature-verified identity, zone presence, chat.              │
│  No keys. No game state. Cannot mint, move or spend anything.   │
└─────────────────────────────────────────────────────────────────┘
```

### On-chain vs off-chain, and why

The split is drawn on one question: **would a dishonest operator be able to
steal or fabricate this?** If yes, it goes on-chain.

| On-chain (authoritative) | Off-chain (no authority over assets) |
|---|---|
| Land, item and crop ownership | Sprite rendering and animation |
| FGOLD balances and total supply | Camera, zoom, input handling |
| Crop planting time and maturity | Player positions and movement |
| Harvest rewards | Global and nearby chat |
| Crafting inputs and outputs | Presence and online counts |
| Marketplace listings and settlement | Growth-bar interpolation between reads |
| Player XP and level | Display metadata (names, emoji, colours) |

Putting positions on-chain would cost a transaction per step and buy nothing —
a griefer lying about where they stand costs no one anything. Putting balances
off-chain would mean asking players to trust a server, which is the thing
blockchain is for here.

**No optimistic economic updates.** A balance on screen is a balance the chain
returned. When a read fails the UI says so rather than substituting a
plausible-looking number.

### State synchronisation

One `GameStateProvider` owns every chain-derived value, so no component keeps
its own copy of a balance. It refreshes on four triggers:

| Trigger | Covers |
|---|---|
| Wallet connect / account change | Keyed on the wallet store's `epoch` |
| Transaction confirmation | Refetch happens *before* success is reported |
| Contract events | Marketplace listings, which other players change |
| Visibility-gated poll (60s) | Backstop; stops in a background tab |

---

## Smart Contracts

Solidity 0.8.20, OpenZeppelin 5. All five compile well inside the 24KB limit.

### `FarmToken` — FGOLD (ERC-20)

The fungible in-game currency. `ERC20Burnable` + `ERC20Permit` + `Ownable2Step`.

Supply is uncapped at the token layer because emission is a game parameter, not
a monetary one — but the inflation surface is deliberately tiny:

- Only registered minters can mint. Deployment registers exactly one:
  `GameManager`.
- **The owner cannot mint.** Ownership administers the minter set and nothing
  else, so watching `MinterAdded` / `MinterRemoved` reveals every possible
  source of new supply.
- `MAX_MINT_PER_TX` bounds any single mint.

Key functions: `mint`, `burn`, `burnFrom`, `permit`, `addMinter`, `removeMinter`.
Events: `MinterAdded`, `MinterRemoved`, plus standard ERC-20.

### `FarmLand` — FLAND (ERC-721)

1000 land plots. `ERC721URIStorage` + `ERC721Enumerable` + `Ownable2Step` +
`ReentrancyGuard`.

Each plot stores `(x, y)` coordinates, fertility, upgrade level, lock state and
what is planted. Token ids start at 1 so `0` is an unambiguous "no plot here"
sentinel for coordinate lookups.

**Locking is the security-relevant part.** While a crop grows, the plot cannot
be transferred — enforced in `_update`. That is what makes `GameManager`'s
"the owner at harvest is the player who planted" assumption sound.

Key functions: `mintLand`, `mintLandAuto`, `mintLandFor` (operator, free),
`lockLand`, `unlockLand`, `upgradeLand`, `getPlotsByOwner`, `withdraw`.
Events: `LandMinted`, `LandLocked`, `LandUnlocked`, `LandUpgraded`.

### `FarmNFT` — FITEM (ERC-721)

Every non-land game object: seeds, harvested crops, tools, consumables and
avatars, with gameplay stats stored on-chain.

Burning is split deliberately. `burn` is for the token's owner or an approved
operator. `gameBurn` is minter-only **and requires the caller to name the
token's expected owner**, so a mis-ordered or replayed game action cannot
destroy a bystander's inventory.

Key functions: `mintItem`, `mintSeed`, `mintCrop`, `mintTool`, `burn`,
`gameBurn`, `getInventory` (paginated, stats included).
Events: `ItemMinted`, `ItemBurned`, `DurabilityUpdated`.

### `GameManager` — rules engine

Where every economically meaningful action is settled. `Ownable2Step` +
`ReentrancyGuard` + `Pausable`. Contract references are **`immutable`** —
the token, NFT and land addresses cannot be swapped under live balances.

Key functions: `claimStarterPack`, `purchaseSeed`, `plantCrop`, `harvestCrop`,
`craftItem`, `upgradeLand`, `getPlayerProfile`, `getAllSeedTypes`,
`getAllRecipes`, `setEconomyParams`, `pause`.
Events: `StarterPackClaimed`, `SeedPurchased`, `CropPlanted`, `CropHarvested`,
`ItemCrafted`, `LandUpgraded`, `PlayerLeveledUp`.

Seeds and recipes live in on-chain registries, so adding a crop is an owner
transaction rather than a redeploy.

### `Marketplace` — peer-to-peer trading

Escrowed trading settled in FGOLD. `Ownable2Step` + `ReentrancyGuard` +
`Pausable` + `ERC721Holder`. The settlement token is `immutable`.

Key functions: `listItem`, `buyItem(listingId, maxPrice)`, `cancelListing`,
`updateListingPrice`, `getActiveListings`, `withdrawFees`, `rescueNFT`.
Events: `ItemListed`, `ItemSold`, `ListingCanceled`, `ListingPriceUpdated`.

### Access control at a glance

| Contract | Privileged role | Who holds it |
|---|---|---|
| FarmToken | minter | `GameManager` only |
| FarmNFT | minter | `GameManager` only |
| FarmLand | operator | `GameManager` only |
| Marketplace | owner | deployer — cannot touch escrowed NFTs |

A deployment health check (`npm run check:local`) asserts exactly this, and
that the Marketplace holds no minting rights.

---

## Blockchain Marketplace

Listing escrows the NFT in the contract; buying settles payment, fee and
delivery atomically in one transaction.

**Front-running is handled explicitly.** `buyItem` takes a `maxPrice`, so a
seller cannot watch the mempool and raise the price into a pending purchase.
A price *increase* additionally only takes effect from the following block; a
price *cut* applies immediately, since that can only help the buyer.

Escrow is not seizable: `rescueNFT` reverts on any token backing an active
listing, so it can recover a token sent in by mistake but not one someone is
selling. Only the seller can cancel a listing — not the contract owner.

Fees are 2.5% by default, hard-capped at 10%, accrued in-contract and withdrawn
explicitly.

---

## Onchain Assets

| Asset | Standard | Tokenised because |
|---|---|---|
| **Land** | ERC-721 | Scarce (1000 total), tradeable, and improvements should survive the operator |
| **Seeds** | ERC-721 | Bought and consumed; burning on plant is what prevents double-planting |
| **Crops** | ERC-721 | The harvest itself — sellable, and a crafting input |
| **Tools / consumables** | ERC-721 | Player-owned inventory with on-chain stats |
| **FGOLD** | ERC-20 | The unit of account for every trade and cost |

Stats are stored on-chain rather than only in metadata, so a plot's fertility
or a tool's power is readable by any contract, not just the game's UI.
`tokenURI` composes a URL under a configurable base URI for wallet display.

---

## Game Economy

A closed in-game economy. FGOLD is a game currency with no external market and
no monetary value.

### Faucets — where FGOLD enters

| Source | Amount | Frequency |
|---|---|---|
| Starter pack | 500 FGOLD + 1 plot | Once per address |
| Harvest | seed yield × plot multiplier | Per crop |

### Sinks — where it leaves

| Sink | Cost | Fate |
|---|---|---|
| Seed purchase | 50 – 800 | **Burned** |
| Crafting | 150 – 6,000 | **Burned** |
| Land upgrade | 500 × (level+1)² | **Burned** |
| Marketplace fee | 2.5% of sale | To treasury |
| Additional plot | 0.005 ETH | To treasury |

### Yield formula

```
yieldBps = 10000
         + (fertility − 50) × 20     // fertility above the floor
         + level × 300               // upgrade level
```

An upgrade raises level by 1 **and** fertility by 5, so each level is worth
300 + (5 × 20) = **400 bps**.

| Plot | Fertility | Level | Yield |
|---|---|---|---|
| Fresh, worst roll | 50 | 0 | 100% |
| Fresh, best roll | 100 | 0 | 110% |
| Maxed, worst roll | 100 | 10 | 140% |
| Maxed, best roll | 150 | 10 | 150% |

### Crops

| Seed | Level | Growth | Cost | Base yield | Margin | XP |
|---|---|---|---|---|---|---|
| Wheat | 1 | 5 min | 50 | 68 | **+18** | 25 |
| Corn | 2 | 15 min | 120 | 168 | **+48** | 60 |
| Tomato | 3 | 1 hour | 300 | 430 | **+130** | 150 |
| Golden Apple | 5 | 4 hours | 800 | 1,180 | **+380** | 400 |

Margins shown are the **floor** — a fully upgraded plot earns up to 50% more.

### Recipes

| Item | Level | FGOLD | Materials | XP |
|---|---|---|---|---|
| Watering Can | 1 | 200 | — | 25 |
| Basic Hoe | 1 | 300 | — | 40 |
| Fertilizer | 2 | 150 | 2 crops | 30 |
| Steel Hoe | 3 | 1,500 | 3 crops | 120 |
| Golden Scythe | 6 | 6,000 | 5 crops | 400 |

Crops are crafting materials, which gives a harvest a use beyond selling and
makes the marketplace part of the loop rather than a side feature.

### Land upgrades — the long-run sink

Cost is `500 × (level+1)²`:

| Level | 0→1 | 1→2 | 2→3 | 3→4 | 4→5 | 5→6 | 6→7 | 7→8 | 8→9 | 9→10 |
|---|---|---|---|---|---|---|---|---|---|---|
| FGOLD | 500 | 2,000 | 4,500 | 8,000 | 12,500 | 18,000 | 24,500 | 32,000 | 40,500 | 50,000 |

**192,500 FGOLD to max one plot.**

### Is it inflationary?

Yes, by construction — harvesting must be profitable or nobody farms. The
quadratic upgrade curve is what absorbs that emission over a player's
progression. Every coefficient above is contract *storage*, not a constant, so
the curve can be retuned without redeploying, and `setEconomyParams` is bounded
so the harvest bonus can never become an unbounded mint.

### Progression

XP comes from harvesting and crafting. Level `n` is reached at `50 × n²` XP:

| Level | 2 | 3 | 4 | 5 | 6 | 8 | 10 |
|---|---|---|---|---|---|---|---|
| Total XP | 200 | 450 | 800 | 1,250 | 1,800 | 3,200 | 5,000 |

Level is derived from XP by a pure function rather than stored, so it can never
fall out of sync.

---

## Multiplayer

Express + Socket.IO. The wire protocol lives in [`shared/protocol.ts`](shared/protocol.ts)
and is vendored into the server tree; CI fails if the copies drift.

### Identity is proved, not asserted

```
client                                server
  │  auth:challenge { address }  ────────►
  │  ◄──────  { nonce, message, expiresAt }
  │  (wallet signs the message)
  │  player:join { address, signature, nonce }  ────►
  │                                    recovers the signer
  │  ◄──────  { self, players }
```

The nonce is single-use and consumed whether or not verification succeeds, so a
captured signature cannot be replayed. Guests may join with no address at all.
A verified address is a display identity and a presence key — it grants no
authority over game state.

### Hardening

| Concern | Measure |
|---|---|
| Movement flood | Token bucket, 20/s per socket |
| Chat spam | Token bucket, 8 per 10s per socket |
| Auth flood | Per-IP bucket on challenge issuance |
| Malformed payloads | Every field validated; non-finite values rejected |
| Teleporting | Moves beyond 6 tiles rejected, client snapped back |
| Oversized messages | 280-char cap, 16KB socket frame limit |
| Ghost sessions | Idle sessions reaped after 90s |
| CORS | Explicit allowlist, **required** in production |
| HTTP flood | 120 req/min per IP, `helmet` headers |

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Contracts** | Solidity 0.8.20, OpenZeppelin 5, Hardhat, solidity-coverage |
| **Game client** | Next.js 14 (App Router), React 18, TypeScript, Phaser 3 |
| **Web3** | ethers v6, EIP-1193 wallet integration, EIP-2612 permit |
| **State** | Zustand, React Context |
| **Styling** | Tailwind CSS |
| **Server** | Node.js 20, Express 4, Socket.IO 4, TypeScript |
| **Testing** | Hardhat + Chai (contracts), Vitest + Testing Library (client/server) |
| **CI** | GitHub Actions |
| **Network** | EVM / Ethereum-compatible — Sepolia, plus a local Hardhat chain |

---

## Project Structure

```
├── contracts/              Solidity sources
│   └── test/               Attacker contracts used by adversarial tests
├── config/gameContent.js   Canonical economy and content — one source of truth
├── scripts/
│   ├── deploy.js           Deploy, wire permissions, seed content, write manifest
│   ├── export-abi.js       Generate the frontend's contract bindings
│   ├── check-deployment.js Health check a live deployment
│   ├── verify.js           Block-explorer verification
│   └── e2e-playthrough.js  42-step automated playability check
├── test/                   Contract test suite
├── deployments/            Address manifests, one per chain
├── shared/protocol.ts      Wire protocol, shared by client and server
├── frontend/
│   ├── app/                Next.js routes
│   ├── components/         Game UI
│   ├── game/               Phaser scene and sprites
│   ├── hooks/              Wallet, actions, transactions, multiplayer
│   ├── lib/                Chains, contracts, errors, formatting, state stores
│   ├── providers/          GameStateProvider
│   └── test/               Client tests
└── server/
    ├── src/lib/            Env validation, logging, auth, rate limiting
    ├── src/game/           Presence registry
    ├── src/socket/         Socket handlers
    └── test/               Server tests
```

---

## Local Development

### Prerequisites

- Node.js 20+
- A browser wallet (MetaMask or similar)

### Run the full stack

```bash
git clone https://github.com/pranay123-stack/web3-farming-game.git
cd web3-farming-game

# 1. Contracts ─────────────────────────────────────────── terminal 1
npm install
npx hardhat node --port 8546

# 2. Deploy ────────────────────────────────────────────── terminal 2
export LOCALHOST_RPC_URL=http://127.0.0.1:8546
npm run deploy:local     # deploys, wires permissions, seeds content
npm run check:local      # asserts the deployment is playable
npm run export:abi       # generates the frontend's contract bindings

# 3. Multiplayer server ────────────────────────────────── terminal 3
cd server && npm install && cp .env.example .env
npm run dev              # http://localhost:3001

# 4. Game client ───────────────────────────────────────── terminal 4
cd frontend && npm install && cp .env.example .env.local
# set NEXT_PUBLIC_CHAIN_ID=31337 and NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8546
npm run dev              # http://localhost:3000
```

Then add the local network to your wallet (RPC `http://127.0.0.1:8546`,
chain ID `31337`), import a Hardhat test account, and claim your starter pack.

> `--port 8546` is used because Anvil and Hardhat both default to 8545 and both
> report chain id 31337 — a collision that silently points deploys at the wrong
> chain. Override with `LOCALHOST_RPC_URL` if 8545 is free for you.

### Generated bindings

`npm run export:abi` writes `frontend/lib/generated/` from the compiled
artifacts and deployment manifests. **Run it after every deploy.** The client
imports nothing hand-written about the contracts, which is what makes it
impossible to ship a call to a function that does not exist.

---

## Environment Variables

Never commit a real `.env`. All three are gitignored, and CI fails the build if
one appears or if a 32-byte hex literal shows up outside tests.

### Root — `.env` (contract deployment)

| Variable | Required | Purpose |
|---|---|---|
| `SEPOLIA_RPC_URL` | No | Deploy/verify RPC. Defaults to a public endpoint. |
| `PRIVATE_KEY` | For deploys | Deployer key — **becomes the contracts' owner** |
| `ETHERSCAN_API_KEY` | For verify | Contract verification |
| `LOCALHOST_RPC_URL` | No | Local chain endpoint. Defaults to `http://127.0.0.1:8545` |
| `METADATA_BASE_URI` | No | Base URI for token metadata |

### `frontend/.env.local`

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | Yes | Target chain; must match a recorded deployment |
| `NEXT_PUBLIC_RPC_URL` | No | Override the read RPC — recommended in production |
| `NEXT_PUBLIC_MULTIPLAYER_URL` | No | Socket server address |
| `NEXT_PUBLIC_MULTIPLAYER_ENABLED` | No | `false` runs the game single-player |

### `server/.env`

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | No | `development` \| `production` \| `test` |
| `PORT` | No | Default 3001 |
| `ALLOWED_ORIGINS` | **In production** | Exact origins; the server refuses to start without it |
| `LOG_LEVEL` | No | `debug` \| `info` \| `warn` \| `error` |
| `TRUST_PROXY` | No | Set true behind a load balancer |

Every value is validated at startup — the process exits on bad input rather
than failing at the first request.

---

## Testing

**315 tests.** All passing.

```bash
npm test                       # 151 contract tests
npm run coverage               # 93% statements / 94.6% lines
cd frontend && npm test        # 99 client tests
cd server && npm test          # 65 server tests
```

| Suite | Tests | Covers |
|---|---|---|
| `test/FarmToken.test.js` | 18 | Minter authorisation, mint bounds, permit, 2-step ownership |
| `test/FarmNFT.test.js` | 20 | Mint dispatch, burn authorisation, enumeration |
| `test/FarmLand.test.js` | 22 | Coordinates, refunds, locking, upgrades, auto-mint gas |
| `test/GameManager.test.js` | 48 | Full loop, progression, crafting, admin, every revert path |
| `test/Marketplace.test.js` | 27 | Listing, buying, front-running guard, re-entrancy, escrow |
| `test/Integration.test.js` | 16 | End-to-end journey, adversarial cases, economy invariants |
| `frontend/test/` | 99 | Error decoding, tx lifecycle, wallet, formatting, components |
| `server/test/` | 65 | Auth, validation, rate limiting, live socket integration |

Every important mechanic is tested for both success **and** expected revert.
Adversarial tests use real attacker contracts in [`contracts/test/`](contracts/test/)
that attempt re-entrancy from ERC-721 receiver hooks and are asserted to fail.
The economy suite asserts design invariants — that every seed tier is
profitable at the yield floor, and that the upgrade sink outgrows farming
income.

### End-to-end playability

Unit tests can all pass while the game is unplayable. This drives the real
contracts through the real journey:

```bash
npx hardhat run scripts/e2e-playthrough.js --network localhost
```

42 steps: claim → approve → buy → plant → wait → harvest → level up → craft →
list → a second player buys → upgrade → rebuild all state from a cold read.
It runs in CI on every push.

---

## Security

**These contracts have not been professionally audited.** This is a testnet
project — do not deploy it to a mainnet or expose it to real funds without an
independent audit.

Full trust model, privileged-role inventory and known risks:
**[SECURITY.md](SECURITY.md)**.

In brief:

- **Re-entrancy** — guards on every state-changing entry point, CEI ordering
  throughout, and attacker contracts in the test suite proving it holds.
- **Marketplace front-running** — buyer-supplied `maxPrice` bound, plus a
  one-block delay on price increases.
- **Minting authority** — one contract can mint FGOLD; the owner cannot.
- **Escrow** — the operator cannot seize an NFT backing an active listing.
- **Off-chain trust** — the multiplayer server has none. It cannot mint, move
  or spend anything, by construction.
- **Timestamp dependence** — intentional and safe: growth windows are minutes
  to hours, and a validator can shift a block by seconds. Covered by a test.
- **No upgradeability** — a proxy would add a trust assumption the game does
  not need. Content and economy are already tunable through on-chain registries.

---

## Deployment Status

**Local / testnet development. There is no live hosted demo.**

Verified locally, on every push, via CI:

| Step | Status |
|---|---|
| Contract compilation | ✅ all five under the 24KB limit |
| Contract tests + coverage | ✅ 151 passing, 93% statements |
| Deployment + permission wiring | ✅ `npm run check:local` |
| 42-step player journey | ✅ against a live chain |
| Client typecheck, lint, tests, build | ✅ |
| Server typecheck, tests, build | ✅ |

**Not deployed to a public network.** That requires a funded deployer key,
which does not belong in a repository. To publish your own instance:

```bash
cp .env.example .env          # add PRIVATE_KEY and SEPOLIA_RPC_URL
npm run deploy:sepolia
npm run check:sepolia
npm run verify:sepolia
npm run export:abi
```

`deploy.js` writes `deployments/<chainId>.json`, the single source of truth for
addresses. Commit it — the frontend build reads it.

> **Superseded addresses.** An earlier iteration of this project was deployed to
> Sepolia at `0x45bCa7f8…`, `0xdF980a70…`, `0x9e9f9407…`, `0xaA85d4c0…` and
> `0x72FE19AF…`. **Do not use them.** Constructor signatures and function
> selectors have since changed, and no meaningful game state was ever created
> on them.

---

## Roadmap

- [ ] Public Sepolia deployment with verified contracts
- [ ] Hosted playable demo
- [ ] Touch controls and a mobile-first layout
- [ ] Make tool power and durability affect yields and growth time
- [ ] Redis adapter so the multiplayer service scales horizontally
- [ ] Hosted token metadata and artwork
- [ ] Independent security audit before any mainnet consideration
- [ ] Seasonal events driven by the existing content registries

---

## Known Limitations

- **Not audited, not deployed publicly.** The two biggest caveats.
- **The starter pack is sybil-farmable** — one free claim per address. Fine for
  a testnet; disable via `setStarterPackConfig` before anything else.
- **Presence is single-instance** — player state lives in server memory, so two
  instances would split the world.
- **Token metadata is not hosted** — `tokenURI` composes a URL, but the JSON and
  artwork are not in this repository, so wallets show tokens without images.
- **Tools have stats but no mechanical effect yet** — power and durability are
  stored and tradeable; nothing consumes them.
- **No touch controls** — the layout is responsive, but movement is
  keyboard-only.
- **Public RPC endpoints rate limit** — set `NEXT_PUBLIC_RPC_URL` to a
  dedicated endpoint for anything beyond local development.

---

## Technical Articles

> Technical write-ups will be published as the project evolves.

### Potential deep dives

Topics that correspond to problems actually solved in this codebase:

- **Why your Web3 game's ABI should be generated, not written** — how a
  hand-maintained ABI silently describes functions that do not exist
- **On-chain vs off-chain state in GameFi** — drawing the boundary on "could a
  dishonest operator steal this?"
- **Front-running a game marketplace** — why `buyItem` needs a price bound
- **Designing a token sink that actually absorbs emission** — quadratic upgrade
  curves versus linear ones
- **Transaction lifecycle UX in Web3 games** — never showing success before a
  receipt
- **Proving wallet identity for a game server without giving it authority**

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests welcome.

## License

MIT — see [LICENSE](LICENSE).
