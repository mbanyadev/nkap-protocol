# NkapPayouts — Mainnet Readiness Review

**Contract:** `contracts/NkapPayouts.sol` · Solidity 0.8.28 · OpenZeppelin 5.6.1
**Testnet deployment:** `0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f` (Arc Testnet, chainId 5042002)
**Reviewer:** Arc Studio automated review — not a substitute for a professional audit.
**Date:** 2026-10-27

---

## 1. Reentrancy

**Status: CLEAN**

All state-mutating external paths carry `nonReentrant`:

| Function | Guard |
|---|---|
| `fund` | `nonReentrant` |
| `withdrawPool` | `nonReentrant` |
| `payout` | `nonReentrant` |
| `payoutSplit` | `nonReentrant` |
| `withdraw` | `nonReentrant` |
| `claimFees` | `nonReentrant` |

The checks-effects-interactions pattern is also followed correctly in every function:
- Pool balance is debited (`platform.pool -= debit`) and state is finalized (`_usedRef`, counters) **before** any `.call{value:…}()` is executed in the payout loops.
- `owed[msg.sender] = 0` is set **before** the `.call` in `withdraw`.
- `feesAccrued = 0` is set **before** the `.call` in `claimFees`.

No cross-function reentrancy path exists because state is committed before any external call. The `nonReentrant` mutex provides a second layer of protection.

**No action required.**

---

## 2. Fee and Rounding Maths

**Status: ONE NOTE — benign, by design**

### Fee calculation

```solidity
uint256 fee = (total * feeBps) / 10_000;
```

At `feeBps = 40` (0.40%), the minimum chargeable payout where `fee > 0` is:

```
total ≥ ⌈10_000 / 40⌉ = 250 wei (18-decimal USDC)
```

For any `total < 250 wei`, `fee` rounds to 0. This is economically irrelevant (250 wei of 18-dec USDC ≈ 2.5 × 10⁻¹⁶ USDC) but is a documented behaviour. The fee cap is enforced at construction (`feeBps_ > 100` reverts) and on update (`newFeeBps > 100` reverts), so the maximum fee is 1%.

### Split rounding

```solidity
// All but last recipient:
uint256 amount = (total * shares[i]) / totalShares;
// Last recipient gets the remainder:
uint256 lastAmount = total - distributed;
```

Integer division truncates each intermediate recipient's share. The remainder — which can be up to `(len - 1)` wei — accumulates into `lastAmount`. For practical share counts (≤ 200) and amounts (≥ 0.01 USDC = 10¹⁶ wei), the rounding error is at most 199 wei ≈ 1.99 × 10⁻¹⁴ USDC. This is:
- Documented behaviour (stated in AGENTS.md).
- By design: last recipient gets dust rather than dust being locked.
- The invariant `sum(amounts) == total` holds exactly, so no funds are stranded.

**Recommendation:** If your recipients are highly sensitive to exact amounts, prefer `payout` (explicit amounts) over `payoutSplit`. No code change needed.

### Overflow

All arithmetic is in Solidity 0.8.28 with built-in checked arithmetic. No unchecked blocks exist. No overflow risk.

---

## 3. Blocklisted Recipients

**Status: POTENTIAL OPERATIONAL RISK — mitigated by pull model**

Arc's native USDC is the gas token, not an ERC-20 token. There is no USDC blocklist contract on Arc (blocklisting is an ERC-20 `transfer` mechanism). Native `call{value:…}()` transfers cannot be blocked at the token level.

However, a recipient **smart contract** could:
- Have a `receive()` that reverts (consuming the 50,000 gas stipend).
- Be a self-destructed contract with no `receive()`.

In both cases, the call fails and `owed[recipient] += amount` — the pull-withdrawal credits the recipient rather than reverting the whole batch. This is the correct mitigation.

**Operational note for mainnet:** Validate recipient addresses off-chain before dispatching (confirm they are EOAs, or that the contract can receive native tokens). The app's batch editor could add a basic checksum validation — addresses that are known contracts could be flagged.

**No contract change required.**

---

## 4. Gas per Recipient and the 200-Recipient Limit

**Status: VERIFY BEFORE LARGE BATCHES**

### Per-recipient gas budget

```solidity
(bool ok, ) = recipient.call{value: amount, gas: 50_000}("");
```

50,000 gas per push-transfer is sufficient for:
- EOA receives: ~21,000 gas.
- Simple `receive()` contracts: typically 21,000–30,000 gas.
- Complex `receive()` hooks (e.g. DEX re-entry, ERC-777 hooks): **may fail** — which is the intended fallback path (credit `owed`).

The concern is the opposite: 50,000 gas is generous enough that a malicious recipient could run meaningful code on each transfer within the budget. Since `nonReentrant` guards the outer call, re-entry into NkapPayouts is blocked. Code running in the 50,000-gas stipend cannot re-enter. This is safe.

### Block gas limit and 200-recipient batches

A 200-recipient batch requires approximately:

| Component | Gas estimate |
|---|---|
| Base tx overhead | ~21,000 |
| Calldata (200 × 40 bytes address + 32 bytes amount) | ~200 × 1,600 = 320,000 |
| Loop overhead + state writes per recipient | ~200 × 8,000 = 1,600,000 |
| 200 × push-transfer (50,000 stipend cap, actual ~25,000 avg) | ~200 × 25,000 = 5,000,000 |
| **Total estimate** | **~7 million gas** |

Arc Testnet block gas limit is 30 million gas, so a 200-recipient batch fits comfortably. Confirm the Arc Mainnet block gas limit is ≥ 10 million before dispatching maximum-size batches. If mainnet has a lower limit, reduce batch size accordingly (100 recipients ≈ 3.5 million gas).

**Recommendation before going live:** Run one 200-recipient batch on testnet and inspect the `gasUsed` field in the receipt to calibrate the real per-recipient cost on Arc.

---

## 5. Operator Permissions

**Status: CLEAN — one edge case to document**

### Correct access control

- Only `platform.owner` can call `setOperator`, `withdrawPool`, and `transferPlatformOwner`.
- `_authorizePayout` allows `platform.owner` (no cap deduction) or an address with `operators[msg.sender][platformId] > 0` (decrements cap by 1 per batch).
- Setting `batchCap = 0` via `setOperator` effectively revokes the operator.
- Two-step ownership (transfer + accept) prevents accidental ownership loss for both protocol and platform.

### Edge case: operator cap decrement at exactly 1

When an operator's cap reaches 1 and they execute a batch, the cap becomes 0. On the next attempt, `currentCap == 0` reverts with `Unauthorized`. This is correct and intended.

### Edge case: platform owner as operator

`bool isOperator = msg.sender != platform.owner` — if the owner calls payout, the operator path is skipped entirely (no cap check, no cap decrement). An operator cannot set themselves to have unlimited batches via `setOperator` because only the platform owner can call `setOperator`.

**No action required.**

---

## 6. Arc-Specific Considerations

### Native USDC as `msg.value`

On Arc, `msg.value` and `balance` are in 18-decimal native USDC. The contract handles this correctly: all arithmetic uses raw wei, all transfers use `.call{value:…}`, and there are no `decimals()` calls on any token address. The `receive()` function reverts to prevent accidental direct sends.

### `maxFeePerGas` floor

The app frontend enforces `maxFeePerGas ≥ 20 gwei` on every write call via `MIN_MAX_FEE_PER_GAS`. This must also be set when interacting from scripts or other tooling on mainnet — Arc requires a minimum gas price.

### No CCTP / no ERC-20 dependency

The contract has zero dependencies on USDC's ERC-20 contract, CCTP, or any external protocol. Deployment on Arc Mainnet requires no additional setup beyond the constructor arguments (`treasury`, `feeBps`).

---

## 7. Items Requiring Human Judgment Before Mainnet Deploy

| # | Item | Action |
|---|---|---|
| 1 | **Treasury address** | Set to your own wallet or a multisig — NOT the Arc Studio deployer wallet (`0x5B12…`), which cannot be accessed by you. |
| 2 | **Protocol owner** | `msg.sender` at deploy time becomes `protocolOwner`. Deploy from the wallet you intend to use as protocol owner, or immediately call `transferProtocolOwner` and `acceptProtocolOwnership`. |
| 3 | **`feeBps`** | Confirm the fee rate. 40 bps (0.40%) is the current testnet value. The cap is 100 bps (1%). |
| 4 | **Block gas limit** | Confirm Arc Mainnet block gas limit supports your intended max batch size (see §4). |
| 5 | **Independent audit** | This review is not a professional security audit. Engage a qualified auditor before handling significant funds. |
| 6 | **`VITE_NKAP_ADDRESS`** | After mainnet deploy, update `.env` with the mainnet contract address. The app will pre-load it from the URL param or the env var. |

---

## Summary

The contract is structurally sound for its purpose. Reentrancy is guarded at every value path. Fee maths are correct with benign integer-division dust that goes to the last recipient. The pull-withdrawal model correctly handles failed push transfers. Operator caps are enforced and revocable. There are no Arc-specific incompatibilities.

The principal pre-mainnet action items are operational (treasury address, protocol owner wallet, gas limit verification) rather than code defects.
