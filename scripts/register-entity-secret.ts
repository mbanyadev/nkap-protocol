/**
 * One-time entity secret registration for Circle developer-controlled wallets.
 * Run with: bun run scripts/register-entity-secret.ts
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerEntitySecretCiphertext, initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  console.error("ERROR: CIRCLE_API_KEY not set in environment.");
  process.exit(1);
}

// 1. Generate secret — never print it
const entitySecret = crypto.randomBytes(32).toString("hex");

// 2. Register ciphertext with Circle and get recovery file
const recoveryDir = "/home/user/app/.circle";
fs.mkdirSync(recoveryDir, { recursive: true });

console.log("Registering entity secret ciphertext with Circle...");
const response = await registerEntitySecretCiphertext({
  apiKey,
  entitySecret,
  recoveryFileDownloadPath: recoveryDir,
});

// Write recovery file if SDK didn't already
const recoveryPath = path.join(recoveryDir, "recovery_file.dat");
if (response.data?.recoveryFile && !fs.existsSync(recoveryPath)) {
  fs.writeFileSync(recoveryPath, response.data.recoveryFile);
}

if (!fs.existsSync(recoveryPath)) {
  console.error("ERROR: recovery file was not written.");
  process.exit(1);
}

// 3. Persist secret to .env (never log value)
const envPath = "/home/user/app/.env";
fs.appendFileSync(envPath, `\nCIRCLE_ENTITY_SECRET=${entitySecret}\n`, "utf-8");

// 4. Verify by doing a read-only SDK call
const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
try {
  await client.listWalletSets({ pageSize: 1 });
  console.log("OK: entity secret registered and verified.");
} catch (e) {
  console.error("ERROR: verification call failed:", e);
  process.exit(1);
}

console.log("RECOVERY_FILE_PATH=" + recoveryPath);
console.log("DONE");
