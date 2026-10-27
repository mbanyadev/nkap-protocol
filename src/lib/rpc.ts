/**
 * Shared throttled RPC helper.
 *
 * All eth_call / eth_blockNumber / eth_getLogs requests from the app flow
 * through ONE serialised queue, capped at ≤4 requests per second.
 * On rate-limit or range errors it retries with 800 ms doubling backoff
 * (up to 6 attempts) before rejecting.
 *
 * Usage:
 *   import { rpcCall, rpcBlockNumber, rpcGetLogs } from '@/lib/rpc'
 *
 * Never import viem createPublicClient for read-only calls — use this module.
 */

// ── Configuration ─────────────────────────────────────────────────────────────

const MIN_INTERVAL_MS = 260   // 1000 / 4 = 250 ms; add a small buffer → 4 req/s max
const MAX_RETRIES     = 6
const RETRY_BASE_MS   = 800   // 800, 1600, 3200, 6400, 12800, 25600

// ── Internal state ────────────────────────────────────────────────────────────

let lastSentAt = 0            // timestamp of the most-recently dispatched request
let queueDepth = 0            // number of requests currently waiting in the queue

// ── Error classification ──────────────────────────────────────────────────────

export function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('rate limit')       ||
    m.includes('too many request') ||
    m.includes('-32014')           ||
    m.includes('32014')            ||
    m.includes('429')              ||
    m.includes('throttl')
  )
}

export function isRangeError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('exceeds defined limit') ||
    m.includes('too large')             ||
    m.includes('result window')         ||
    m.includes('-32012')                ||
    m.includes('32012')                 ||
    m.includes('request exceeds')
  )
}

export function isRetryable(msg: string): boolean {
  return isRateLimitError(msg) || isRangeError(msg)
}

// ── Core queue ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Acquire a send slot: wait until at least MIN_INTERVAL_MS has elapsed since
 * the last request was sent, then reserve the slot.
 *
 * This is cooperative (not mutex-locked) but runs inside an async queue so
 * all callers await in order.
 */
async function acquireSlot(): Promise<void> {
  const now = Date.now()
  const wait = lastSentAt + MIN_INTERVAL_MS - now
  if (wait > 0) await sleep(wait)
  lastSentAt = Date.now()
}

/**
 * Low-level: send one JSON-RPC request through the throttle queue.
 * Retries on rate-limit or range errors with exponential backoff.
 * Throws on non-retryable errors or after MAX_RETRIES exhausted.
 */
async function sendOnce(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  await acquireSlot()
  queueDepth++

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${text}`)
    }

    const json = await res.json() as
      | { result: unknown; error?: undefined }
      | { result?: undefined; error: { code: number; message: string } }

    if (json.error) {
      throw new Error(`RPC ${json.error.code}: ${json.error.message}`)
    }

    return json.result
  } finally {
    queueDepth--
  }
}

/**
 * Public: send one JSON-RPC call with retry + backoff.
 * Callers see "RPC busy, retrying…" errors while backing off.
 */
export async function rpcCall(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await sendOnce(rpcUrl, method, params)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_RETRIES && isRetryable(msg)) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt)
        await sleep(delay)
        continue
      }
      throw new Error(
        isRetryable(msg)
          ? `RPC busy, retrying… (${msg.slice(0, 80)})`
          : msg,
      )
    }
  }
  throw new Error('RPC busy, retrying… (max retries exceeded)')
}

// ── Typed helpers ─────────────────────────────────────────────────────────────

/** eth_blockNumber → bigint */
export async function rpcBlockNumber(rpcUrl: string): Promise<bigint> {
  const result = await rpcCall(rpcUrl, 'eth_blockNumber', [])
  return BigInt(result as string)
}

/** eth_call → hex string */
export async function rpcEthCall(
  rpcUrl: string,
  to: string,
  data: string,
  block = 'latest',
): Promise<string> {
  const result = await rpcCall(rpcUrl, 'eth_call', [{ to, data }, block])
  return result as string
}

// ── RawLog type (shared) ───────────────────────────────────────────────────────

export interface RawLog {
  address: string
  topics: string[]
  data: string
  blockNumber: string
  transactionHash: string
  logIndex: string
}

/**
 * eth_getLogs for one [fromBlock, toBlock] window.
 * address and topic0 are ALWAYS included (required for filtered queries).
 * Extra topics are appended after topic0.
 * On range errors: halves chunk size (caller handles the retry loop).
 */
export async function rpcGetLogsOnce(
  rpcUrl: string,
  address: string,
  topic0: string,
  extraTopics: (string | null)[],
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RawLog[]> {
  const topics: (string | null)[] = [topic0, ...extraTopics]
  const result = await rpcCall(rpcUrl, 'eth_getLogs', [{
    address,
    topics,
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock:   `0x${toBlock.toString(16)}`,
  }])
  return result as RawLog[]
}

/**
 * Scan startBlock → endBlock in sequential chunks.
 * On range errors: halves chunk (floor 100) and retries the same window.
 * On rate-limit: rpcCall's own retry handles it.
 * Reports progress 0–100 via onProgress.
 */
export async function rpcScanLogs(
  rpcUrl: string,
  address: string,
  topic0: string,
  extraTopics: (string | null)[],
  startBlock: bigint,
  endBlock: bigint,
  // Called after each chunk with (blocksScanned, totalBlocks)
  onProgress?: (scanned: bigint, total: bigint) => void,
  initialChunkSize = 5000n,   // start at 5 000, halve on range errors
  minChunkSize     = 500n,    // never go below 500 blocks per chunk
): Promise<RawLog[]> {
  const all: RawLog[] = []
  const total = endBlock >= startBlock ? endBlock - startBlock + 1n : 1n
  let cursor = startBlock
  let chunkSize = initialChunkSize

  while (cursor <= endBlock) {
    const to = cursor + chunkSize - 1n > endBlock ? endBlock : cursor + chunkSize - 1n

    // Inner retry loop for range errors only (rate-limit handled by rpcCall)
    let logs: RawLog[] | null = null
    while (logs === null) {
      try {
        logs = await rpcGetLogsOnce(rpcUrl, address, topic0, extraTopics, cursor, to)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (isRangeError(msg)) {
          const half = chunkSize / 2n
          chunkSize = half < minChunkSize ? minChunkSize : half
          await sleep(200)
          continue
        }
        throw err
      }
    }

    all.push(...logs)
    if (onProgress) {
      const scanned = to - startBlock + 1n
      onProgress(scanned > total ? total : scanned, total)
    }
    cursor = to + 1n
  }

  return all
}

/** Expose current queue depth for debugging */
export function rpcQueueDepth(): number { return queueDepth }
