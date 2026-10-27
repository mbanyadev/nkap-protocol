# Nkap

USDC mass-payout infrastructure on Arc. Platforms fund a pool and dispatch bulk payouts to many recipients in a single transaction, with pro-rata split mode, operator spending allowances, two-step ownership, gas-bounded pushes, and pull-withdrawal for failed pushes.

**Live app:** https://mbanyadev.github.io/nkap-protocol/ (Arc Mainnet by default) · [testnet demo with batch history](https://mbanyadev.github.io/nkap-protocol/?network=testnet&contract=0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f&platform=0)

Built with [Arc Studio](https://studio.arc.io)

---

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS (indigo fintech palette)
- **Web3**: wagmi v2, viem, ConnectKit (MetaMask / Rabby)
- **Contracts**: Solidity 0.8.28, Foundry — `contracts/NkapPayouts.sol`
- **Chain**: Arc Mainnet (5042, default) / Arc Testnet (5042002) — native USDC (18 dec, `msg.value`)

## Features

- **Network switcher** — Arc Mainnet (default) / Arc Testnet; works read-only without a wallet (`?network=testnet`); maxFeePerGas ≥ 20 gwei enforced
- **Wallet connection** — MetaMask / Rabby via ConnectKit, live USDC balance in the header
- **Platform loader** — load by contract address + platform ID (or `?contract=&platform=` URL params); shows name, owner, pool, total paid, batch count, fee
- **Fund pool** — top up a platform pool directly from the panel
- **Batch editor** — paste CSV (`wallet,amount,label` or `wallet,shares,label`), reference (stored as bytes32), live quote of total + fee + pool shortfall, "fund shortfall in same tx" checkbox, Send batch button with explorer link
- **Batch history** — `BatchPaid` events with expandable `PayoutSent` / `PayoutCredited` legs, last 5 000 blocks
- **Admin panel** — register platform, set operator spending allowance, withdraw pool, withdraw owed USDC, deploy new NkapPayouts from browser, claim protocol fees (protocol owner only)
- **URL deep-linking** — `?network=testnet&contract=0x…&platform=0` pre-loads a platform on open

## Security fixes after the mainnet review

1. **Bounded payout call** — each push is an assembly `call` capped at 50,000 gas that copies no return data, so a hostile recipient contract cannot gas-bomb a batch; failed pushes are credited to `owed[recipient]` for pull withdrawal.
2. **Operator spending allowance** — `setOperator(platformId, operator, allowance)` grants a total USDC allowance; every batch deducts its total and reverts with `OverOperatorAllowance` past it (previously a simple batch counter limited the number of batches, not the amount). The platform owner is exempt; `0` revokes.

Both are covered by `contracts/test/NkapPayouts.Security.t.sol`. `forge test`: 49 tests, all passing.

## Development

### Prerequisites

- [Bun](https://bun.sh) v1+
- [Foundry](https://book.getfoundry.sh) (for contract builds/tests)

### Install

```bash
bun install
```

### Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_NKAP_ADDRESS` | Default Arc Mainnet NkapPayouts address (pre-filled in the UI) |
| `VITE_NKAP_TESTNET_ADDRESS` | Optional testnet contract override (defaults to the demo deployment) |
| `BASE_PATH` | Build base path, e.g. `/nkap-protocol/` for GitHub Pages |
| `CIRCLE_WALLET_ID` | Circle developer-controlled wallet used by the demo scripts |
| `CIRCLE_API_KEY` | Circle Standard Developer API Key (server-side scripts only, not exposed to browser) |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret (server-side scripts only) |

`CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` are used by deployment scripts only and are never sent to the browser.
`RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` — optional, provided by Arc Studio; app falls back to public Arc RPC.

### Run

```bash
bun run dev
```

### Build

```bash
bun run build
```

### Contract build / test

```bash
bun run contracts:build
bun run contracts:test
```

## Deployment

The web app is served by GitHub Pages from the `gh-pages` branch (a `BASE_PATH=/nkap-protocol/ bun run build` of `main`).

## Deployed Contracts

See `AGENTS.md` for deployed addresses and live transaction hashes.

---

Built by Mbanya Dev with [Arc Studio](https://studio.arc.io).
