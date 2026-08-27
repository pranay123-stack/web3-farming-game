# Contributing

Issues and pull requests are welcome.

## Getting set up

See [Local development](README.md#local-development) in the README. The short
version:

```bash
npm install
npx hardhat node --port 8546                       # terminal 1

LOCALHOST_RPC_URL=http://127.0.0.1:8546 \
  npm run deploy:local && npm run export:abi       # terminal 2
npm run check:local                                # confirm it is playable

cd server && npm install && npm run dev            # terminal 3
cd frontend && npm install && npm run dev          # terminal 4
```

## Before opening a pull request

Everything CI runs, you can run locally:

```bash
npm test                                    # contracts
npm run coverage                            # contract coverage
cd frontend && npm run typecheck && npm run lint && npm test && npm run build
cd server && npm run typecheck && npm test && npm run build
```

And the one that matters most — the full player journey against a live chain:

```bash
npx hardhat run scripts/e2e-playthrough.js --network localhost
```

If that fails, the game is broken regardless of what the unit tests say.

## Conventions

**Test both directions.** Every game mechanic needs a success case *and* an
expected-revert case. A contract test that only proves the happy path proves
very little.

**Never widen the trust boundary.** The multiplayer server carries presence and
chat. If a change would let it influence ownership, balances or trades, it is
the wrong change — that separation is the security model.

**No fabricated state in the client.** If a chain read fails, show that it
failed. Never substitute a plausible-looking number for a real one, and never
render a transaction as successful before a receipt confirms it.

**Contract bindings are generated.** `frontend/lib/generated/` comes from
`npm run export:abi`, which reads the compiled artifacts. Do not hand-edit it,
and do not hand-write ABIs — generating them is what stops the client calling
functions that do not exist.

**Game content is data, not code.** Seeds, recipes and economy coefficients
live in `config/gameContent.js` and on-chain registries. Adding a crop should
not require touching a contract.

**Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`).

## Changing the economy

Economy parameters are storage, not constants, so they can be retuned without a
redeploy. If you change `config/gameContent.js`, update:

- the economy tables in the README
- the invariant tests in `test/Integration.test.js`

Those tests assert properties the design depends on — that every seed tier is
profitable at the yield floor, and that the upgrade sink outgrows farming
income. If a change breaks them, the change needs justifying, not the test.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
