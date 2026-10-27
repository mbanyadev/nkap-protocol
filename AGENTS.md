# Nkap — notes for coding agents

> Built with Arc Studio — https://studio.arc.io

Mass-payout infrastructure on Arc. Platforms fund a native-USDC pool and pay many
recipients in one transaction (exact amounts or pro-rata split). Default network:
Arc Mainnet (chainId 5042). Arc Testnet (5042002) is selectable, and read-only
visitors can open it with `?network=testnet`. Mainnet readiness review:
`docs/mainnet-review.md`.

## Tech stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS, wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Source: `contracts/NkapPayouts.sol`
- Token: native USDC (`msg.value`, 18 decimals). No ERC-20 calls.

## Commands

```bash
bun install
bun run dev              # local dev server
bun run build            # production build (set BASE_PATH for sub-path hosting)
forge build && forge test
```

## Contract design

- Platforms: `createPlatform(name)` → ids start at 0. Two-step platform and protocol ownership.
- Operators: `setOperator(platformId, operator, allowance)` gives an operator a total
  USDC spending allowance (wei). Each `payout` / `payoutSplit` deducts the batch total;
  reverts with `OverOperatorAllowance` above it; `0` revokes. The platform owner is exempt.
- Payout pushes use a bounded assembly `call` (50,000 gas, no return-data copy), so a
  hostile recipient cannot gas-bomb a batch. Failed pushes are credited to `owed[recipient]`
  for pull withdrawal via `withdraw()`.
- Replay guard per `(platformId, ref)`. Pro-rata rounding dust goes to the last recipient.
- Protocol fee `feeBps` ≤ 100 (1%), accrued and claimed by the protocol owner to `treasury`.

## Deployments

### Arc Testnet (demo, deployed before the two security fixes above)
- NkapPayouts: `0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f` (deploy tx block 69050884), feeBps 40
- Platform 0 "Vexlio Labs" with two batches:
  - createPlatform: https://explorer.testnet.arc.io/tx/0x0962690c7f50f47d52208f00a7b1b42f3a86171f3f5f71ae0a5fb92e809d1b3a
  - batch 1 (exact, `payout-run-001`; one leg credited for pull withdrawal): https://explorer.testnet.arc.io/tx/0xe20473950c5fdf0b2a7a0dd576833e2fc043d02ee49a0d0772975fd24e1d30d8
  - batch 2 (50/30/20 split, `payout-run-002`): https://explorer.testnet.arc.io/tx/0xa1675f0666d903a347f74d6568ece0d0e2e9942a66bab5211030c476ccad667f

### Arc Mainnet
- Deployed from the current source; address is set at build time via `VITE_NKAP_ADDRESS`.

## Environment variables

- `VITE_NKAP_ADDRESS` — default mainnet contract shown in the UI
- `VITE_NKAP_TESTNET_ADDRESS` — optional override of the testnet demo contract
- `VITE_NKAP_DEPLOY_BLOCK` — mainnet deploy block (batch-history scan start; `?from=<block>` overrides)
- `BASE_PATH` — build base path (e.g. `/nkap-protocol/` on GitHub Pages)
- Scripts only (never bundled): `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CIRCLE_WALLET_ID`

## Key files

- `contracts/NkapPayouts.sol` — the payout contract; tests in `contracts/test/`
- `src/components/PlatformPanel.tsx` — wallet-free platform loader
- `src/components/BatchHistory.tsx` — `BatchPaid` / `PayoutSent` / `PayoutCredited` history
- `src/components/BatchEditor.tsx` — CSV batch editor and dispatch
- `src/components/AdminPanel.tsx` — platform, operator allowance, withdrawals, deploy
