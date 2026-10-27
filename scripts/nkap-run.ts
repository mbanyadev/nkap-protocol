/**
 * Nkap testnet run:
 *  1. createPlatform("Vexlio Labs") from the dev-controlled wallet
 *  2. payout() — fund pool + 0.01 USDC each to 3 addresses in one tx
 */
import {
  initiateDeveloperControlledWalletsClient,
  FeeLevel,
} from "@circle-fin/developer-controlled-wallets";
import {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  toHex,
} from "viem";
import { randomUUID } from "node:crypto";

// ── env ──────────────────────────────────────────────────────────────────────
const API_KEY    = process.env.CIRCLE_API_KEY!;
const ENT_SECRET = process.env.CIRCLE_ENTITY_SECRET!;
if (!API_KEY || !ENT_SECRET) {
  console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET"); process.exit(1);
}
const CONTRACT = (process.env.VITE_NKAP_ADDRESS ?? "") as `0x${string}`;
if (!CONTRACT || CONTRACT === "0x0000000000000000000000000000000000000000") {
  console.error("Missing VITE_NKAP_ADDRESS in .env"); process.exit(1);
}

// ── constants ─────────────────────────────────────────────────────────────────
const ARC_BLOCKCHAIN = "ARC-TESTNET";
const RPC_URL        = "https://rpc.testnet.arc.io";

// Reuse the wallet created earlier (already funded with 20 USDC via faucet)
const WALLET_ID      = process.env.CIRCLE_WALLET_ID ?? "";
const WALLET_ADDRESS = "0x486983fcc79725d2184ca89bdbcbeabf12f3bf75" as `0x${string}`;

// Three test recipient addresses
const RECIPIENTS: `0x${string}`[] = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
];

// Amounts — 0.01 USDC each in native 18-dec wei
const AMOUNT_EACH  = 10000000000000000n;   // 0.01e18
const TOTAL_PAYOUT = AMOUNT_EACH * 3n;     // 0.03e18
const FEE_BPS      = 40n;
const FEE          = (TOTAL_PAYOUT * FEE_BPS) / 10000n;  // 12000000000000 wei
const DEBIT        = TOTAL_PAYOUT + FEE;
// Top up pool with buffer above the debit
const POOL_TOPUP   = DEBIT + 5000000000000000n;  // debit + 0.005 USDC

// "payout-run-001" right-padded to bytes32
const REF_STRING = "payout-run-001";
const refBytes   = new Uint8Array(32);
for (let i = 0; i < REF_STRING.length; i++) refBytes[i] = REF_STRING.charCodeAt(i);
const REF_BYTES32 = toHex(refBytes);

// ── ABI ───────────────────────────────────────────────────────────────────────
const NKAP_ABI = parseAbi([
  "function createPlatform(string name) external returns (uint256 platformId)",
  "function payout(uint256 platformId, address[] recipients, uint256[] amounts, bytes32 ref) external payable returns (uint256 batchId)",
  "function getPlatform(uint256 platformId) external view returns (address owner, string name, uint256 pool, uint256 totalPaid, uint256 batchCount)",
  "function platformCount() external view returns (uint256)",
  "function feesAccrued() external view returns (uint256)",
  "function batchCount() external view returns (uint256)",
]);

// ── clients ───────────────────────────────────────────────────────────────────
const publicClient  = createPublicClient({ transport: http(RPC_URL) });
const walletsClient = initiateDeveloperControlledWalletsClient({
  apiKey: API_KEY, entitySecret: ENT_SECRET,
});

// ── helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function waitForTx(txId: string, label: string, maxMs = 90_000): Promise<string> {
  console.log(`  polling [${label}] id=${txId}`);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res   = await walletsClient.getTransaction({ id: txId });
    const state = res.data?.transaction?.state;
    const hash  = res.data?.transaction?.txHash;
    if (state === "CONFIRMED" || state === "COMPLETE") {
      console.log(`  ✓ confirmed: ${hash}`);
      return hash!;
    }
    if (state === "FAILED" || state === "CANCELLED" || state === "DENIED") {
      console.error("  tx detail:", JSON.stringify(res.data?.transaction, null, 2));
      throw new Error(`Transaction ${txId} [${label}] ended in state ${state}`);
    }
    await sleep(3000);
  }
  throw new Error(`Transaction [${label}] timed out after ${maxMs}ms`);
}

async function readContract<T>(fn: string, args: unknown[] = []): Promise<T> {
  return publicClient.readContract({
    address: CONTRACT, abi: NKAP_ABI, functionName: fn, args,
  }) as Promise<T>;
}

// ── main ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════");
console.log("  Nkap testnet run — Arc Testnet");
console.log("  Contract:      ", CONTRACT);
console.log("  Signing wallet:", WALLET_ADDRESS);
console.log("═══════════════════════════════════════════════════════\n");

// Confirm wallet balance
const balance = await publicClient.getBalance({ address: WALLET_ADDRESS });
console.log(`Wallet balance: ${Number(balance) / 1e18} USDC`);
if (balance < POOL_TOPUP) {
  console.error(`Insufficient balance: need ${Number(POOL_TOPUP)/1e18} USDC, have ${Number(balance)/1e18} USDC`);
  process.exit(1);
}

// ── Step 1: createPlatform("Vexlio Labs") ─────────────────────────────────────
console.log("\n── Step 1: createPlatform('Vexlio Labs') ──");

const createData = encodeFunctionData({
  abi: NKAP_ABI,
  functionName: "createPlatform",
  args: ["Vexlio Labs"],
});

const createTxRes = await walletsClient.createContractExecutionTransaction({
  idempotencyKey:  randomUUID(),
  walletId:        WALLET_ID,
  contractAddress: CONTRACT,
  callData:        createData,
  feeLevel:        FeeLevel.Medium,
  blockchain:      ARC_BLOCKCHAIN as Parameters<typeof walletsClient.createContractExecutionTransaction>[0]["blockchain"],
});

if (!createTxRes.data?.id) {
  console.error("createPlatform tx not queued:", JSON.stringify(createTxRes));
  process.exit(1);
}
const createHash = await waitForTx(createTxRes.data.id, "createPlatform");

await sleep(3000);
const platformCount = await readContract<bigint>("platformCount");
const platformId    = Number(platformCount) - 1;
console.log(`  platformId: ${platformId}`);

const pInfo = await readContract<[string, string, bigint, bigint, bigint]>(
  "getPlatform", [BigInt(platformId)]
);
console.log(`  name: "${pInfo[1]}"  owner: ${pInfo[0]}`);

// ── Step 2: payout() ─────────────────────────────────────────────────────────
console.log("\n── Step 2: payout() (fund-and-pay, 3 recipients × 0.01 USDC) ──");
console.log(`  msg.value (pool top-up):  ${Number(POOL_TOPUP)/1e18} USDC`);
console.log(`  total payout:             ${Number(TOTAL_PAYOUT)/1e18} USDC`);
console.log(`  fee (40 bps):             ${Number(FEE)/1e18} USDC`);
console.log(`  debit from pool:          ${Number(DEBIT)/1e18} USDC`);
console.log(`  ref:                      "${REF_STRING}"  →  ${REF_BYTES32}`);

const payoutData = encodeFunctionData({
  abi: NKAP_ABI,
  functionName: "payout",
  args: [
    BigInt(platformId),
    RECIPIENTS,
    [AMOUNT_EACH, AMOUNT_EACH, AMOUNT_EACH],
    REF_BYTES32,
  ],
});

const payoutTxRes = await walletsClient.createContractExecutionTransaction({
  idempotencyKey:  randomUUID(),
  walletId:        WALLET_ID,
  contractAddress: CONTRACT,
  callData:        payoutData,
  amount:          POOL_TOPUP.toString(),   // native USDC msg.value
  feeLevel:        FeeLevel.Medium,
  blockchain:      ARC_BLOCKCHAIN as Parameters<typeof walletsClient.createContractExecutionTransaction>[0]["blockchain"],
});

if (!payoutTxRes.data?.id) {
  console.error("payout tx not queued:", JSON.stringify(payoutTxRes));
  process.exit(1);
}
const payoutHash = await waitForTx(payoutTxRes.data.id, "payout");

// ── Results ───────────────────────────────────────────────────────────────────
await sleep(3000);
const finalPlatform = await readContract<[string, string, bigint, bigint, bigint]>(
  "getPlatform", [BigInt(platformId)]
);
const feesAccrued   = await readContract<bigint>("feesAccrued");
const globalBatches = await readContract<bigint>("batchCount");
const expectedPool  = POOL_TOPUP - DEBIT;

console.log("\n══════════════════════════════════════════════════════════════════");
console.log("  RESULTS");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  Contract:              ${CONTRACT}`);
console.log(`  Chain:                 Arc Testnet (chain 5042002)`);
console.log(`  Signing wallet:        ${WALLET_ADDRESS}`);
console.log("");
console.log(`  createPlatform tx:     https://explorer.testnet.arc.io/tx/${createHash}`);
console.log(`  payout tx:             https://explorer.testnet.arc.io/tx/${payoutHash}`);
console.log("");
console.log(`  Platform ID:           ${platformId}`);
console.log(`  Platform name:         ${finalPlatform[1]}`);
console.log(`  Platform owner:        ${finalPlatform[0]}`);
console.log(`  Pool top-up:           ${Number(POOL_TOPUP)/1e18} USDC`);
console.log(`  Debit (total+fee):     ${Number(DEBIT)/1e18} USDC`);
console.log(`  Pool remaining:        ${Number(finalPlatform[2])/1e18} USDC  ${finalPlatform[2] === expectedPool ? "✓" : `(expected ${Number(expectedPool)/1e18})`}`);
console.log(`  Total paid (platform): ${Number(finalPlatform[3])/1e18} USDC`);
console.log(`  Platform batch count:  ${finalPlatform[4]}`);
console.log(`  feesAccrued (global):  ${Number(feesAccrued)/1e18} USDC  ${feesAccrued >= FEE ? "✓" : "⚠"}`);
console.log(`  Global batch count:    ${globalBatches}`);
console.log("");
console.log("  Recipients (each received 0.01 USDC):");
RECIPIENTS.forEach(r => console.log(`    ${r}`));
console.log(`  Ref:                   "${REF_STRING}"`);
console.log("══════════════════════════════════════════════════════════════════\n");
