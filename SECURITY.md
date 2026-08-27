# Security Policy

## Audit status

**These contracts have not been professionally audited.**

This is a testnet project. Do not deploy it to a mainnet, and do not put funds
of real value into it, without an independent audit first.

## Reporting a vulnerability

Open a [security advisory](https://github.com/pranay123-stack/web3-farming-game/security/advisories/new)
rather than a public issue, and give me a reasonable window to respond before
disclosing.

Useful reports include the affected contract or module, the conditions needed
to trigger the issue, and what an attacker gains.

## Trust model

Understanding what the system does and does not guarantee is most of the
security story here.

### On-chain — authoritative

Ownership, balances, crops, land, items and trades are settled by contracts.
Nothing off-chain can create, move or destroy them.

### Off-chain — no authority over assets

The multiplayer service carries player positions and chat. It holds no private
keys, signs nothing, and cannot mint, transfer or spend anything. A full
compromise of that server would let an attacker disrupt presence and chat; it
would not let them take a single token.

### Privileged roles

The contract owner can:

- pause `GameManager` and `Marketplace`
- retune economy parameters **within hard-coded bounds**
- publish or retire seeds and recipes
- grant and revoke minter/operator rights
- withdraw accumulated marketplace fees and land-sale proceeds

The contract owner **cannot**:

- mint FGOLD directly — `FarmToken` restricts minting to registered minter
  contracts, and the owner is deliberately excluded
- seize an NFT held in marketplace escrow — `rescueNFT` reverts on any token
  backing an active listing
- swap the token, NFT, land or settlement contracts — those references are
  `immutable`
- raise the harvest bonus without limit — capped at `MAX_HARVEST_BONUS_BPS`

`Ownable2Step` is used throughout, so ownership can be moved to a multisig
without risk of a mistyped address bricking administration.

## Known risks

| Risk | Status |
|---|---|
| No professional audit | **Open.** The single largest caveat. |
| Starter-pack faucet is sybil-farmable | **Accepted for testnet.** One free claim per address. Disable via `setStarterPackConfig` before any mainnet deployment. |
| Plot fertility uses `blockhash` pseudo-randomness | **Accepted.** Miner-influenceable inside a 50–100 band, worth at most a 10% yield swing — below the cost of manipulating it. Documented in `FarmLand`. |
| Growth windows depend on `block.timestamp` | **Accepted.** Windows are minutes to hours; a validator can shift a block by seconds, which cannot meaningfully accelerate a crop. Covered by a test. |
| Owner key compromise | **Open.** Would allow pausing and economy retuning within bounds. Use a multisig for anything beyond a testnet. |
| Public RPC endpoints | **Operational.** Rate limits can degrade the client. Set `NEXT_PUBLIC_RPC_URL` to a dedicated endpoint. |

## Defences in place

- **Re-entrancy** — `ReentrancyGuard` on every state-changing entry point, and
  checks-effects-interactions ordering throughout. Harvest clears farm state
  *before* minting the crop NFT, so an ERC-721 receiver hook cannot observe a
  still-harvestable plot. Two attacker contracts in `contracts/test/` attempt
  exactly this and are asserted to fail.
- **Marketplace front-running** — `buyItem` takes a `maxPrice` bound, and a
  price *increase* only takes effect from the following block, so a seller
  cannot reprice into a pending purchase.
- **Burn authorisation** — `gameBurn` requires the caller to name the token's
  expected owner, so a mis-ordered game action cannot destroy a bystander's item.
- **Allowance-based spending** — the game burns FGOLD via `burnFrom`, which
  needs the player's approval, rather than holding unilateral burn rights.
- **Wallet identity off-chain** — the multiplayer server verifies a signature
  over a single-use, server-issued nonce before accepting an address. The nonce
  is consumed whether or not verification succeeds, so signatures cannot be
  replayed.
- **Input validation** — every socket payload is validated at runtime;
  non-finite coordinates, malformed addresses and oversized messages are
  rejected rather than propagated.
- **Rate limiting** — token buckets on movement, chat and authentication, plus
  a per-IP HTTP limit.

## Secret handling

No private key, mnemonic or API key belongs in this repository. `.env` files
are gitignored, `.env.example` files carry placeholders only, and CI fails the
build if a `.env` file or a 32-byte hex literal appears outside tests.

The deployer key configured in `.env` becomes the contracts' owner. Use a
throwaway account holding nothing but testnet ETH.
