/**
 * Nkap batch-2: payoutSplit — 50/30/20 of 0.05 USDC, ref payout-run-002
 * Uses the Circle developer-controlled wallet in CIRCLE_WALLET_ID
 * amount= field uses DECIMAL USDC string (e.g. "0.045200"), not wei bigint.
 */
import {
  initiateDeveloperControlledWalletsClient,
  FeeLevel,
} from "@circle-fin/developer-controlled-wallets";
import { createPublicClient, http, encodeFunctionData, parseAbi, toHex } from "viem";
import { randomUUID } from "node:crypto";

// ── env ──────────────────────────────────────────────────────────────────────
const API_KEY    = process.env.CIRCLE_API_KEY!;
const ENT_SECRET = process.env.CIRCLE_ENTITY_SECRET!;
if (!API_KEY || !ENT_SECRET) {
  console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET"); process.exit(1);
}
const CONTRACT = (process.env.VITE_NKAP_ADDRESS ?? "0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f") as `0x${string}`;

// ── constants ─────────────────────────────────────────────────────────────────
const ARC_BLOCKCHAIN = "ARC-TESTNET";
const RPC_URL        = "https://rpc.testnet.arc.io";
const WALLET_ID      = process.env.CIRCLE_WALLET_ID ?? "";
const WALLET_ADDRESS = "0x486983fcc79725d2184ca89bdbcbeabf12f3bf75" as `0x${string}`;
const PLATFORM_ID    = 0n;

const RECIPIENTS: `0x${string}`[] = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
];
const SHARES         = [50n, 30n, 20n];
const TOTAL_PAYOUT   = 50000000000000000n;   // 0.05 USDC × 10^18
const FEE_BPS        = 40n;
const FEE            = (TOTAL_PAYOUT * FEE_BPS) / 10000n;  // 20000000000000 wei = 0.00002 USDC
const DEBIT          = TOTAL_PAYOUT + FEE;

// ref: "payout-run-002" as bytes32 (UTF-8, left-aligned, zero-padded to 32 bytes)
const REF_STRING = "payout-run-002";
const refBytes   = new Uint8Array(32);
for (let i = 0; i < REF_STRING.length; i++) refBytes[i] = REF_STRING.charCodeAt(i);
const REF_BYTES32 = toHex(refBytes);

// ── ABI ───────────────────────────────────────────────────────────────────────
const NKAP_ABI = parseAbi([
  "function payoutSplit(uint256 platformId, address[] recipients, uint256[] shares, uint256 total, bytes32 ref) external payable",
  "function getPlatform(uint256 platformId) external view returns (address owner, string name, uint256 pool, uint256 totalPaid, uint256 batchCount)",
  "function feesAccrued() external view returns (uint256)",
  "function batchCount() external view returns (uint256)",
  "function quote(uint256 total) external view returns (uint256 fee, uint256 debit)",
]);

// ── clients ───────────────────────────────────────────────────────────────────
const publicClient  = createPublicClient({ transport: http(RPC_URL) });
const walletsClient = initiateDeveloperControlledWalletsClient({
  apiKey: API_KEY, entitySecret: ENT_SECRET,
});

// ── helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitForTx(txId: string, label: string, maxMs = 120_000): Promise<string> {
  console.log(`  polling [${label}] id=${txId}`);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res   = await walletsClient.getTransaction({ id: txId });
    const state = res.data?.transaction?.state;
    const hash  = res.data?.transaction?.txHash;
    console.log(`    state=${state}  hash=${hash ?? '—'}`);
    if (state === "CONFIRMED" || state === "COMPLETE") return hash!;
    if (state === "FAILED" || state === "CANCELLED" || state === "DENIED") {
      console.error("  tx detail:", JSON.stringify(res.data?.transaction, null, 2));
      throw new Error(`Transaction ${txId} [${label}] ended in state ${state}`);
    }
    await sleep(4000);
  }
  throw new Error(`Transaction [${label}] timed out after ${maxMs}ms`);
}

/** Format a native-18-dec wei amount to a decimal USDC string (e.g. "0.045200000000000000") */
function weiToDecimalUsdc(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac  = wei % 10n ** 18n;
  return `${whole}.${frac.toString().padStart(18, "0")}`;
}

// ── main ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  Nkap batch-2 — payoutSplit — Arc Testnet");
console.log("  Contract:      ", CONTRACT);
console.log("  Signing wallet:", WALLET_ADDRESS);
console.log("═══════════════════════════════════════════════════════════════\n");

// 1. Read current pool to determine exact shortfall
const platformData = await publicClient.readContract({
  address: CONTRACT, abi: NKAP_ABI, functionName: "getPlatform", args: [PLATFORM_ID],
}) as [string, string, bigint, bigint, bigint];
const currentPool = platformData[2];
console.log(`Platform: "${platformData[1]}"  owner=${platformData[0]}`);
console.log(`Current pool:   ${Number(currentPool) / 1e18} USDC`);
console.log(`Debit required: ${Number(DEBIT) / 1e18} USDC  (total=${Number(TOTAL_PAYOUT)/1e18} + fee=${Number(FEE)/1e18})`);

const shortfall = DEBIT > currentPool ? DEBIT - currentPool : 0n;
// Add a 0.001 USDC buffer so the pool has something left after the batch
const BUFFER = 1000000000000000n; // 0.001 USDC
const msgValue = shortfall + BUFFER;
console.log(`Shortfall:      ${Number(shortfall) / 1e18} USDC`);
console.log(`msg.value:      ${Number(msgValue) / 1e18} USDC  (shortfall + 0.001 buffer)`);

// Double-check wallet has enough
const walletBal = await publicClient.getBalance({ address: WALLET_ADDRESS });
console.log(`Wallet balance: ${Number(walletBal) / 1e18} USDC`);
if (walletBal < msgValue) {
  console.error(`Insufficient wallet balance: need ${Number(msgValue)/1e18}, have ${Number(walletBal)/1e18}`);
  process.exit(1);
}

// 2. Encode payoutSplit calldata
const callData = encodeFunctionData({
  abi: NKAP_ABI,
  functionName: "payoutSplit",
  args: [PLATFORM_ID, RECIPIENTS, SHARES, TOTAL_PAYOUT, REF_BYTES32],
});

console.log(`\nRef: "${REF_STRING}"  →  ${REF_BYTES32}`);
console.log(`Shares: [50, 30, 20] of 0.05 USDC`);
console.log(`  Alice (50%): ~0.025 USDC`);
console.log(`  Bob   (30%): ~0.015 USDC`);
console.log(`  Carol (20%):  0.010 USDC`);

// 3. Submit via Circle API
// amount= takes DECIMAL USDC string (e.g. "0.045200000000000000"), NOT raw wei
const amountDecimal = weiToDecimalUsdc(msgValue);
console.log(`\namount field (decimal USDC): "${amountDecimal}"`);

const txRes = await walletsClient.createContractExecutionTransaction({
  idempotencyKey:  randomUUID(),
  walletId:        WALLET_ID,
  contractAddress: CONTRACT,
  callData,
  amount:          amountDecimal,
  feeLevel:        FeeLevel.Medium,
  blockchain:      ARC_BLOCKCHAIN as Parameters<typeof walletsClient.createContractExecutionTransaction>[0]["blockchain"],
});

if (!txRes.data?.id) {
  console.error("tx not queued:", JSON.stringify(txRes, null, 2));
  process.exit(1);
}
console.log(`\nCircle tx id: ${txRes.data.id}`);
const txHash = await waitForTx(txRes.data.id, "payoutSplit");

// 4. Read back results
await sleep(3000);
const finalPlatform = await publicClient.readContract({
  address: CONTRACT, abi: NKAP_ABI, functionName: "getPlatform", args: [PLATFORM_ID],
}) as [string, string, bigint, bigint, bigint];
const feesAccrued   = await publicClient.readContract({
  address: CONTRACT, abi: NKAP_ABI, functionName: "feesAccrued",
});
const globalBatches = await publicClient.readContract({
  address: CONTRACT, abi: NKAP_ABI, functionName: "batchCount",
});

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  RESULTS — Batch 2");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  Contract:              ${CONTRACT}`);
console.log(`  Signing wallet:        ${WALLET_ADDRESS}`);
console.log(`  Tx hash:               https://explorer.testnet.arc.io/tx/${txHash}`);
console.log("");
console.log(`  Total payout:          ${Number(TOTAL_PAYOUT)/1e18} USDC`);
console.log(`  Fee (40bps):           ${Number(FEE)/1e18} USDC`);
console.log(`  Debit from pool:       ${Number(DEBIT)/1e18} USDC`);
console.log(`  msg.value sent:        ${Number(msgValue)/1e18} USDC`);
console.log("");
console.log(`  Platform pool (after): ${Number(finalPlatform[2])/1e18} USDC`);
console.log(`  Platform totalPaid:    ${Number(finalPlatform[3])/1e18} USDC`);
console.log(`  Platform batchCount:   ${finalPlatform[4]}`);
console.log(`  feesAccrued (global):  ${Number(feesAccrued)/1e18} USDC`);
console.log(`  Global batchCount:     ${globalBatches}`);
console.log("");
console.log("  Recipient allocations (50/30/20 of 0.05 USDC):");
const totalShares = 100n;
for (let i = 0; i < RECIPIENTS.length; i++) {
  const share  = SHARES[i];
  // last recipient gets dust
  const amount = i < RECIPIENTS.length - 1
    ? (TOTAL_PAYOUT * share) / totalShares
    : TOTAL_PAYOUT - (TOTAL_PAYOUT * SHARES[0]) / totalShares - (TOTAL_PAYOUT * SHARES[1]) / totalShares;
  console.log(`    ${RECIPIENTS[i]}  →  ${Number(amount)/1e18} USDC  (share=${share})`);
}
console.log(`  Ref: "${REF_STRING}"`);
console.log("══════════════════════════════════════════════════════════════════\n");
