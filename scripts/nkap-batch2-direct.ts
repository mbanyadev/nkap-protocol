/**
 * Nkap batch-2: payoutSplit via Circle REST API directly (no SDK wrapper).
 * The SDK crashes on non-2xx responses; this script uses fetch + manual
 * RSA-OAEP entity secret encryption — confirmed working in earlier session.
 *
 * payoutSplit(platformId=0, [50,30,20] shares, total=0.05 USDC, ref=payout-run-002)
 */
import crypto from "node:crypto";
import { createPublicClient, http, encodeFunctionData, parseAbi, toHex } from "viem";
import { randomUUID } from "node:crypto";

// ── env ──────────────────────────────────────────────────────────────────────
const API_KEY    = process.env.CIRCLE_API_KEY!;
const ENT_SECRET = process.env.CIRCLE_ENTITY_SECRET!;
if (!API_KEY || !ENT_SECRET) {
  console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET"); process.exit(1);
}
if (ENT_SECRET.length !== 64) {
  console.error(`Entity secret must be 64 hex chars, got ${ENT_SECRET.length}`); process.exit(1);
}

const CONTRACT   = "0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f" as `0x${string}`;
const CIRCLE_API = "https://api.circle.com";
const ARC_BLOCKCHAIN = "ARC-TESTNET";
const RPC_URL    = "https://rpc.testnet.arc.io";
const WALLET_ID  = "bba7e5cd-136b-5cb2-b427-123d717a0b78";
const WALLET_ADDRESS = "0x486983fcc79725d2184ca89bdbcbeabf12f3bf75" as `0x${string}`;
const PLATFORM_ID = 0n;

const RECIPIENTS: `0x${string}`[] = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
];
const SHARES      = [50n, 30n, 20n];
const TOTAL_PAYOUT = 50000000000000000n;  // 0.05e18
const FEE_BPS     = 40n;
const FEE         = (TOTAL_PAYOUT * FEE_BPS) / 10000n;
const DEBIT       = TOTAL_PAYOUT + FEE;

const REF_STRING  = "payout-run-002";
const refBytes    = new Uint8Array(32);
for (let i = 0; i < REF_STRING.length; i++) refBytes[i] = REF_STRING.charCodeAt(i);
const REF_BYTES32 = toHex(refBytes);

// ── ABI ───────────────────────────────────────────────────────────────────────
const NKAP_ABI = parseAbi([
  "function payoutSplit(uint256 platformId, address[] recipients, uint256[] shares, uint256 total, bytes32 ref) external payable",
  "function getPlatform(uint256 platformId) external view returns (address owner, string name, uint256 pool, uint256 totalPaid, uint256 batchCount)",
  "function feesAccrued() external view returns (uint256)",
  "function batchCount() external view returns (uint256)",
]);

// ── helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Fetch Circle's RSA public key for entity secret encryption */
async function getCirclePublicKey(): Promise<string> {
  const res = await fetch(`${CIRCLE_API}/v1/w3s/config/entity/publicKey`, {
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`publicKey fetch failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { data: { publicKey: string } };
  return json.data.publicKey;
}

/** Encrypt entity secret with RSA-OAEP SHA-256 */
async function encryptEntitySecret(publicKeyPem: string): Promise<string> {
  const secretBytes = Buffer.from(ENT_SECRET, "hex");
  const encrypted   = crypto.publicEncrypt(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    secretBytes,
  );
  return encrypted.toString("base64");
}

async function circlePost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${CIRCLE_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`  Circle POST ${path} → ${res.status}:`, text.slice(0, 500));
    throw new Error(`Circle API error ${res.status}`);
  }
  return JSON.parse(text);
}

async function circleGet(path: string): Promise<unknown> {
  const res = await fetch(`${CIRCLE_API}${path}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Circle GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function waitForTx(txId: string, label: string, maxMs = 120_000): Promise<string> {
  console.log(`  polling [${label}] id=${txId}`);
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res   = await circleGet(`/v1/w3s/transactions/${txId}`) as { data: { transaction: { state: string; txHash?: string } } };
    const state = res.data?.transaction?.state;
    const hash  = res.data?.transaction?.txHash;
    console.log(`    state=${state}  hash=${hash ?? '—'}`);
    if (state === "CONFIRMED" || state === "COMPLETE") return hash!;
    if (state === "FAILED" || state === "CANCELLED" || state === "DENIED") {
      throw new Error(`Transaction ${txId} [${label}] ended in state ${state}`);
    }
    await sleep(4000);
  }
  throw new Error(`Transaction [${label}] timed out after ${maxMs}ms`);
}

// ── main ──────────────────────────────────────────────────────────────────────
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  Nkap batch-2 — payoutSplit — Circle REST API direct");
console.log("  Contract:      ", CONTRACT);
console.log("  Wallet:        ", WALLET_ADDRESS);
console.log("═══════════════════════════════════════════════════════════════\n");

const publicClient = createPublicClient({ transport: http(RPC_URL) });

// 1. Read current pool
const platformData = await publicClient.readContract({
  address: CONTRACT, abi: NKAP_ABI, functionName: "getPlatform", args: [PLATFORM_ID],
}) as [string, string, bigint, bigint, bigint];
const currentPool = platformData[2];
console.log(`Platform: "${platformData[1]}"  owner=${platformData[0]}`);
console.log(`Current pool:   ${Number(currentPool) / 1e18} USDC`);
console.log(`Debit required: ${Number(DEBIT) / 1e18} USDC`);

const shortfall = DEBIT > currentPool ? DEBIT - currentPool : 0n;
const BUFFER    = 1000000000000000n; // 0.001 USDC
const msgValue  = shortfall + BUFFER;
console.log(`Shortfall:      ${Number(shortfall) / 1e18} USDC`);
console.log(`msg.value:      ${Number(msgValue) / 1e18} USDC`);

// Check wallet balance
const walletBal = await publicClient.getBalance({ address: WALLET_ADDRESS });
console.log(`Wallet balance: ${Number(walletBal) / 1e18} USDC`);
if (walletBal < msgValue) {
  console.error(`Insufficient: need ${Number(msgValue)/1e18}, have ${Number(walletBal)/1e18}`);
  process.exit(1);
}

// 2. Get public key + encrypt entity secret
console.log("\nFetching Circle public key...");
const publicKeyPem    = await getCirclePublicKey();
const entitySecretCiphertext = await encryptEntitySecret(publicKeyPem);
console.log("Entity secret encrypted OK");

// 3. Encode calldata
const callData = encodeFunctionData({
  abi: NKAP_ABI,
  functionName: "payoutSplit",
  args: [PLATFORM_ID, RECIPIENTS, SHARES, TOTAL_PAYOUT, REF_BYTES32],
});
console.log(`\nCalldata (first 10 bytes): ${callData.slice(0, 22)}…`);
console.log(`Ref: "${REF_STRING}" → ${REF_BYTES32}`);

// 4. Submit transaction via Circle REST API
// amount= is the wei string of msg.value (native USDC on Arc uses raw wei, same as ETH)
const body = {
  idempotencyKey:        randomUUID(),
  walletId:              WALLET_ID,
  contractAddress:       CONTRACT,
  callData,
  amount:                msgValue.toString(),   // raw wei string — matches confirmed payout-run-001
  feeLevel:              "MEDIUM",
  blockchain:            ARC_BLOCKCHAIN,
  entitySecretCiphertext,
};

console.log(`\nPOST /v1/w3s/developer/transactions/contractExecution`);
console.log(`  amount (wei): ${msgValue.toString()}`);

const txRes = await circlePost("/v1/w3s/developer/transactions/contractExecution", body) as {
  data: { id: string }
};

const txId = txRes.data?.id;
if (!txId) {
  console.error("No tx id returned:", JSON.stringify(txRes));
  process.exit(1);
}
console.log(`  Circle tx id: ${txId}`);

// 5. Poll for confirmation
const txHash = await waitForTx(txId, "payoutSplit");

// 6. Read back results
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
console.log("  RESULTS — Batch 2 (payoutSplit)");
console.log("══════════════════════════════════════════════════════════════════");
console.log(`  Tx hash:  https://explorer.testnet.arc.io/tx/${txHash}`);
console.log(`  Platform pool (after): ${Number(finalPlatform[2])/1e18} USDC`);
console.log(`  Platform totalPaid:    ${Number(finalPlatform[3])/1e18} USDC`);
console.log(`  Platform batchCount:   ${finalPlatform[4]}`);
console.log(`  feesAccrued (global):  ${Number(feesAccrued)/1e18} USDC`);
console.log(`  Global batchCount:     ${globalBatches}`);
console.log("");
const totalShares = 100n;
console.log("  Recipient allocations:");
for (let i = 0; i < RECIPIENTS.length; i++) {
  const share  = SHARES[i];
  const amount = i < RECIPIENTS.length - 1
    ? (TOTAL_PAYOUT * share) / totalShares
    : TOTAL_PAYOUT - (TOTAL_PAYOUT * SHARES[0]) / totalShares - (TOTAL_PAYOUT * SHARES[1]) / totalShares;
  console.log(`    ${RECIPIENTS[i]}  share=${share}  amount=${Number(amount)/1e18} USDC`);
}
console.log(`  Ref: "${REF_STRING}"`);
console.log("══════════════════════════════════════════════════════════════════\n");
