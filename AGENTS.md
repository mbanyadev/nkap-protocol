# Nkap

> Built with Arc Studio — money-powered apps in minutes

Mass-payout infrastructure on Arc. Platforms fund a USDC pool and pay many recipients in a single transaction. Default network: Arc Mainnet (chainId 5042). Arc Testnet (5042002) remains selectable. Mainnet readiness review: `docs/mainnet-review.md`.

---

## What This App Does

Nkap lets platforms (freelance marketplaces, creator platforms, gig apps, AI data-labelling companies) dispatch bulk USDC payouts to contributors in a single onchain call. Two modes: exact amounts per recipient, or pro-rata split by share weights. A configurable protocol fee (default 30 bps) is charged per batch.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS (Arc Dark theme)
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Source: `contracts/NkapPayout.sol`. Build: `bun run contracts:build`. Test: `bun run contracts:test`.
- Chain: Arc Testnet (Chain ID: 5042002) — native USDC (18 decimals)
- Token: native USDC (msg.value, 18 decimals). Note: this contract does NOT use the 6-decimal ERC-20 view.

## Deployed Contracts

### NkapPayouts (multi-platform, current — feeBps=40)
- **Address**: `0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f`
- **Chain**: Arc Testnet (chainId 5042002)
- **Constructor**: `treasury=0x5B12Ce46C7194aD57d143bC22847224047b1Ef42, feeBps=40`
- **Explorer**: https://explorer.testnet.arc.io/address/0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f
- **Artifact**: `contracts/out/NkapPayouts.sol/NkapPayouts.json`
- **Source**: `contracts/NkapPayouts.sol`
- **Tests**: `contracts/test/NkapPayouts.*.t.sol` (101 tests, all pass)

### Live Transactions (testnet run — Vexlio Labs)
- **Signing wallet**: `0x486983fCC79725d2184ca89bdbCbEabf12f3bF75` (developer-controlled, faucet-funded with 20 USDC)
- **createPlatform("Vexlio Labs")**: https://explorer.testnet.arc.io/tx/0x0962690c7f50f47d52831a576b15e0c0c7db23823823da1a5e8ab08a9c5c5ba4
  - Platform ID: 0
- **payout batch-1 (exact, ref="payout-run-001")**: https://explorer.testnet.arc.io/tx/0xe20473950c5fdf0b2a7a0dd576833e2fc043d02ee49a0d0772975fd24e1d30d8
  - Pool top-up (msg.value): 0.03512 USDC
  - Total paid: 0.03 USDC (3 × 0.01 USDC)
  - Fee (40 bps): 0.00012 USDC
  - Pool remaining: 0.005 USDC
- **payoutSplit batch-2 (50/30/20, ref="payout-run-002")**: https://explorer.testnet.arc.io/tx/0xa1675f0666d903a347f74d6568ece0d0e2e9942a66bab5211030c476ccad667f
  - msg.value (shortfall+buffer): 0.0462 USDC
  - Total paid: 0.05 USDC
  - Fee (40 bps): 0.0002 USDC
  - Recipient allocations: Alice (50%): 0.025 USDC, Bob (30%): 0.015 USDC, Carol (20%): 0.01 USDC
  - Pool remaining: 0.001 USDC
  - Platform totalPaid after: 0.08 USDC, batchCount: 2, feesAccrued: 0.00032 USDC
- **Recipients (all batches)**: 0x70997970C51812dc3A010C7d01b50e0d17dc79C8, 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC, 0x90F79bf6EB2c4f870365E785982E1f101E93b906

### Circle API note (amount field)
The `createContractExecutionTransaction` `amount` field on ARC-TESTNET must be a SHORT decimal USDC string
(e.g. `"0.0462"` — trailing zeros stripped). Raw wei bigint strings (e.g. `"46200000000000000"`) get
accepted (HTTP 201) but the tx stays at INITIATED and never broadcasts. The SDK wrapper crashes on 4xx
responses (`s.config` undefined in axios interceptor). Use raw `fetch` with manual RSA-OAEP encryption.

### NkapPayouts (previous — feeBps=30, superseded)
- **Address**: `0xd55abc5bb4a672791c9599a8e9d866614f5e0f93`
- **Chain**: Arc Testnet
- **Constructor**: `treasury=0x5B12Ce46C7194aD57d143bC22847224047b1Ef42, feeBps=30`

---


| Contract    | Network      | Address                                    | Explorer |
|-------------|--------------|------------------------------------------- |----------|
| NkapPayout  | Arc Testnet  | 0x675a156156ab04a69ca96cd6357dc7401d402b34 | https://explorer.testnet.arc.io/address/0x675a156156ab04a69ca96cd6357dc7401d402b34 |

- Owner / fee recipient: `0x5B12Ce46C7194aD57d143bC22847224047b1Ef42` (platform deployer wallet)
- Fee: 30 bps (0.30%)
- Max fee: 500 bps (5%)
- Contract metadata: `contracts/contract-metadata/NkapPayout.json`

## Key Design Decisions

- Native USDC (msg.value, 18 decimals) only — no ERC-20 calls
- Push-transfer failure does NOT revert the whole batch; failed amounts credited to `unclaimed[recipient]` for pull-withdrawal via `claim()`
- Replay protection: `(sender, batchRef)` pair is tracked in `referenceUsed`
- Pro-rata dust (integer division remainder) goes to the last recipient

## Key Files

- `src/App.tsx` — main application, contract reads, stats
- `src/components/BatchDispatch.tsx` — dispatch form (exact + pro-rata modes)
- `src/components/BatchHistory.tsx` — recent batch list
- `contracts/NkapPayout.sol` — the payout contract

## Environment Variables

- `VITE_NKAP_ADDRESS` — deployed NkapPayout contract address (Arc Testnet)

## To Run

```bash
bun install
bun run dev
```
