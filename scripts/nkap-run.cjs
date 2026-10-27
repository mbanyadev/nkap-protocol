"use strict";

/**
 * Nkap testnet run — CommonJS for Node.js direct execution (no bundling).
 * Run: node --env-file=.env scripts/nkap-run.cjs
 */

const {
  initiateDeveloperControlledWalletsClient,
  FeeLevel,
} = require("@circle-fin/developer-controlled-wallets");
const {
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  toHex,
} = require("viem");
const { randomUUID } = require("node:crypto");

// ── env ──────────────────────────────────────────────────────────────────────
const API_KEY    = (process.env.CIRCLE_API_KEY    || "").trim();
const ENT_SECRET = (process.env.CIRCLE_ENTITY_SECRET || "").trim();
const CONTRACT   = (process.env.VITE_NKAP_ADDRESS || "").trim();

if (!API_KEY || !ENT_SECRET) {
  console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET"); process.exit(1);
}
if (!CONTRACT || CONTRACT === "0x0000000000000000000000000000000000000000") {
  console.error("Missing VITE_NKAP_ADDRESS"); process.exit(1);
}

// ── constants ─────────────────────────────────────────────────────────────────
const ARC_BLOCKCHAIN = "ARC-TESTNET";
const RPC_URL        = "https://rpc.testnet.arc.io";
const WALLET_ID      = "bba7e5cd-136b-5cb2-b427-123d717a0b78";
const WALLET_ADDR    = "0x486983fcc79725d2184ca89bdbcbeabf12f3bf75";

const RECIPIENTS = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
];

const AMOUNT_EACH  = BigInt("10000000000000000");    // 0.01e18
const TOTAL_PAYOUT = AMOUNT_EACH * 3n;
const FEE          = (TOTAL_PAYOUT * 40n) / 10000n; // 40 bps
const DEBIT        = TOTAL_PAYOUT + FEE;
const POOL_TOPUP   = DEBIT + BigInt("5000000000000000"); // debit + 0.005 USDC buffer

const REF_STRING = "payout-run-001";
const refBytes   = new Uint8Array(32);
for (let i = 0; i < REF_STRING.length; i++) refBytes[i] = REF_STRING.charCodeAt(i);
const REF_BYTES32 = toHex(refBytes);

// ── ABI ───────────────────────────────────────────────────────────────────────
const NKAP_ABI = parseAbi([
  "function createPlatform(string name) external returns (uint256)",
  "function payout(uint256 platformId, address[] recipients, uint256[] amounts, bytes32 ref) external payable returns (uint256)",
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
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForTx(txId, label, maxMs = 120_000) {
  console.log(`  polling [${label}] id=${txId}`);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res   = await walletsClient.getTransaction({ id: txId });
    const state = res.data?.transaction?.state;
    const hash  = res.data?.transaction?.txHash;
    if (state === "CONFIRMED" || state === "COMPLETE") {
      console.log(`  ✓ ${hash}`);
      return hash;
    }
    if (["FAILED", "CANCELLED", "DENIED"].includes(state)) {
      console.error("  tx:", JSON.stringify(res.data?.transaction));
      throw new Error(`[${label}] ended in state ${state}`);
    }
    await sleep(3000);
  }
  throw new Error(`[${label}] timed out`);
}

async function readContract(fn, args = []) {
  return publicClient.readContract({
    address: CONTRACT, abi: NKAP_ABI, functionName: fn, args,
  });
}

// ── main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Nkap testnet run — Arc Testnet");
  console.log("  Contract:      ", CONTRACT);
  console.log("  Signing wallet:", WALLET_ADDR);
  console.log("═══════════════════════════════════════════════════════\n");

  // Confirm balance
  const balance = await publicClient.getBalance({ address: WALLET_ADDR });
  console.log(`Wallet balance: ${Number(balance) / 1e18} USDC`);
  if (balance < POOL_TOPUP) {
    console.error(`Insufficient balance: need ${Number(POOL_TOPUP)/1e18}, have ${Number(balance)/1e18}`);
    process.exit(1);
  }

  // ── Step 1: createPlatform ─────────────────────────────────────────────────
  console.log("\n── Step 1: createPlatform('Vexlio Labs') ──");
  const createData = encodeFunctionData({
    abi: NKAP_ABI, functionName: "createPlatform", args: ["Vexlio Labs"],
  });
  const createRes = await walletsClient.createContractExecutionTransaction({
    idempotencyKey:  randomUUID(),
    walletId:        WALLET_ID,
    contractAddress: CONTRACT,
    callData:        createData,
    feeLevel:        "MEDIUM",
    blockchain:      ARC_BLOCKCHAIN,
  });
  if (!createRes.data?.id) {
    console.error("no tx id:", JSON.stringify(createRes)); process.exit(1);
  }
  const createHash = await waitForTx(createRes.data.id, "createPlatform");

  await sleep(3000);
  const count      = await readContract("platformCount");
  const platformId = Number(count) - 1;
  console.log(`  platformId: ${platformId}`);
  const pInfo = await readContract("getPlatform", [BigInt(platformId)]);
  console.log(`  name: "${pInfo[1]}"  owner: ${pInfo[0]}`);

  // ── Step 2: payout ─────────────────────────────────────────────────────────
  console.log("\n── Step 2: payout() (fund-and-pay in one call) ──");
  console.log(`  msg.value:   ${Number(POOL_TOPUP)/1e18} USDC  (pool top-up)`);
  console.log(`  total:       ${Number(TOTAL_PAYOUT)/1e18} USDC  (3 × 0.01)`);
  console.log(`  fee 40 bps:  ${Number(FEE)/1e18} USDC`);
  console.log(`  debit:       ${Number(DEBIT)/1e18} USDC`);

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
  const payoutRes = await walletsClient.createContractExecutionTransaction({
    idempotencyKey:  randomUUID(),
    walletId:        WALLET_ID,
    contractAddress: CONTRACT,
    callData:        payoutData,
    amount:          POOL_TOPUP.toString(),
    feeLevel:        "MEDIUM",
    blockchain:      ARC_BLOCKCHAIN,
  });
  if (!payoutRes.data?.id) {
    console.error("no tx id:", JSON.stringify(payoutRes)); process.exit(1);
  }
  const payoutHash = await waitForTx(payoutRes.data.id, "payout");

  // ── Read-back ─────────────────────────────────────────────────────────────
  await sleep(3000);
  const fp          = await readContract("getPlatform",  [BigInt(platformId)]);
  const feesAccrued = await readContract("feesAccrued");
  const globalBatch = await readContract("batchCount");
  const expectedPool = POOL_TOPUP - DEBIT;

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  Contract:              ${CONTRACT}`);
  console.log(`  Signing wallet:        ${WALLET_ADDR}`);
  console.log("");
  console.log(`  createPlatform tx:     https://explorer.testnet.arc.io/tx/${createHash}`);
  console.log(`  payout tx:             https://explorer.testnet.arc.io/tx/${payoutHash}`);
  console.log("");
  console.log(`  Platform ID:           ${platformId}`);
  console.log(`  Platform name:         ${fp[1]}`);
  console.log(`  Platform owner:        ${fp[0]}`);
  console.log(`  Pool top-up:           ${Number(POOL_TOPUP)/1e18} USDC`);
  console.log(`  Debit (total+fee):     ${Number(DEBIT)/1e18} USDC`);
  console.log(`  Pool remaining:        ${Number(fp[2])/1e18} USDC  ${fp[2] === expectedPool ? "✓" : `⚠ expected ${Number(expectedPool)/1e18}`}`);
  console.log(`  Total paid (platform): ${Number(fp[3])/1e18} USDC  ${fp[3] === TOTAL_PAYOUT ? "✓" : "⚠"}`);
  console.log(`  Platform batch count:  ${fp[4]}`);
  console.log(`  feesAccrued (global):  ${Number(feesAccrued)/1e18} USDC  ${feesAccrued >= FEE ? "✓" : "⚠"}`);
  console.log(`  Global batch count:    ${globalBatch}`);
  console.log("");
  console.log("  Recipients (0.01 USDC each):");
  RECIPIENTS.forEach(r => console.log(`    ${r}`));
  console.log(`  Ref:                   "${REF_STRING}"  →  ${REF_BYTES32}`);
  console.log("══════════════════════════════════════════════════════════════\n");
})();
