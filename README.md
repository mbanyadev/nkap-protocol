# Nkap

USDC mass-payout infrastructure on Arc. Platforms fund a pool and dispatch bulk payouts to many recipients in a single transaction, with pro-rata split mode, operator caps, two-step ownership, and pull-withdrawal for failed pushes.

Built with [Arc Studio](https://studio.arc.io)

---

## Tech Stack

- **Frontend**: React 18, Vite, TypeScript, Tailwind CSS (indigo fintech palette)
- **Web3**: wagmi v2, viem, ConnectKit (MetaMask / Rabby)
- **Contracts**: Solidity 0.8.28, Foundry — `contracts/NkapPayouts.sol`
- **Chain**: Arc Testnet (5042002) / Arc Mainnet (5042) — native USDC (18 dec, `msg.value`)

## Features

- **Network switcher** — Arc Mainnet / Arc Testnet with add-network wallet flow; maxFeePerGas ≥ 20 gwei enforced
- **Wallet connection** — MetaMask / Rabby via ConnectKit, live USDC balance in the header
- **Platform loader** — load by contract address + platform ID (or `?contract=&platform=` URL params); shows name, owner, pool, total paid, batch count, fee
- **Fund pool** — top up a platform pool directly from the panel
- **Batch editor** — paste CSV (`wallet,amount,label` or `wallet,shares,label`), reference (stored as bytes32), live quote of total + fee + pool shortfall, "fund shortfall in same tx" checkbox, Send batch button with explorer link
- **Batch history** — `BatchPaid` events with expandable `PayoutSent` / `PayoutCredited` legs, last 5 000 blocks
- **Admin panel** — register platform, set operator with cap, withdraw pool, withdraw owed USDC, deploy new NkapPayouts from browser, claim protocol fees (protocol owner only)
- **URL deep-linking** — `?contract=0x…&platform=0` pre-loads a platform on open

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
| `VITE_NKAP_ADDRESS` | Default NkapPayouts contract address (pre-filled in the UI) |
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

## Deployed Contracts

See `AGENTS.md` for deployed addresses and live transaction hashes.

---

*Footer: "Built by Mbanya Dev with Arc Studio"*
