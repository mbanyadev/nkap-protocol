import { useEffect, useState, useCallback } from 'react'
import { arcTestnet } from 'viem/chains'
import { decodeEventLog, parseAbi, padHex, toHex } from 'viem'
import { arcMainnet } from '@/config'
import { useAccount } from 'wagmi'
import { ExternalLink, ChevronDown, ChevronRight, Loader2, Send, BookOpen, RefreshCw } from 'lucide-react'
import { fmtUsdc, fmtAddr, bytes32ToStr } from '@/lib/nkap'
import { getArcChain, resolveReadChainId } from '@/config'
import { rpcBlockNumber, rpcScanLogs } from '@/lib/rpc'
import type { RawLog } from '@/lib/rpc'
import type { PlatformCtx } from './PlatformPanel'

// ── Types ────────────────────────────────────────────────────────────────────

interface BatchEvent {
  batchId: bigint
  platformId: bigint
  operator: string
  recipients: readonly string[]
  total: bigint
  fee: bigint
  ref: string
  refReadable: string
  txHash: string
  blockNumber: bigint
  legs: LegEvent[]
}

interface LegEvent {
  batchId: bigint
  recipient: string
  amount: bigint
  type: 'sent' | 'credited'
}

interface Props {
  ctx: PlatformCtx
  refreshKey?: number
}

// ── ABI for decoding ─────────────────────────────────────────────────────────

const NKAP_EVENTS = parseAbi([
  'event BatchPaid(uint256 indexed batchId, uint256 indexed platformId, address indexed operator, address[] recipients, uint256 total, uint256 fee, bytes32 ref)',
  'event PayoutSent(uint256 indexed batchId, address indexed recipient, uint256 amount)',
  'event PayoutCredited(uint256 indexed batchId, address indexed recipient, uint256 amount)',
])

// Keccak256 topic hashes (precomputed from ABI)
const TOPIC_BATCH_PAID      = '0x781772caa8356e4fccf082ff07597c3ee2fcdf3b3084074754e80051944d86ed'
const TOPIC_PAYOUT_SENT     = '0xac496bf04b429bf7a6bb179271f3194066e9462a4f0d8afac065edd1f2be36b8'
const TOPIC_PAYOUT_CREDITED = '0x5ff63671c653c1352ac17c1c9dab5666b70ff6eedf646972be1b0b5cd8c579b1'

// Known deploy blocks per contract address (lowercase)
const DEPLOY_BLOCK: Record<string, bigint> = {
  '0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f': 69050800n,
}

// (RPC helpers imported from @/lib/rpc)

// Optional scan start: ?from=<block> in the URL, or VITE_NKAP_DEPLOY_BLOCK for mainnet
function urlFromBlock(): bigint | undefined {
  const v = new URLSearchParams(window.location.search).get('from')
  return v && /^\d+$/.test(v) ? BigInt(v) : undefined
}
function envDeployBlock(chainId: number): bigint | undefined {
  const v = import.meta.env.VITE_NKAP_DEPLOY_BLOCK as string | undefined
  return chainId === arcMainnet.id && v && /^\d+$/.test(v) ? BigInt(v) : undefined
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  batches: BatchEvent[]
  cachedAt: number      // ms timestamp
  highWaterBlock: bigint
}

// In-memory cache (survives tab switches, cleared on hard reload)
const historyCache = new Map<string, CacheEntry>()

function cacheKey(contract: string, platformId: string, chainId: number) {
  return `${contract.toLowerCase()}:${platformId}:${chainId}`
}

function serializeBigInts(obj: unknown): unknown {
  if (typeof obj === 'bigint') return obj.toString() + 'n'
  if (Array.isArray(obj)) return obj.map(serializeBigInts)
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, serializeBigInts(v)]))
  }
  return obj
}

function deserializeBigInts(obj: unknown): unknown {
  if (typeof obj === 'string' && /^\d+n$/.test(obj)) return BigInt(obj.slice(0, -1))
  if (Array.isArray(obj)) return obj.map(deserializeBigInts)
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, deserializeBigInts(v)]))
  }
  return obj
}

function saveToSession(key: string, entry: CacheEntry) {
  try {
    sessionStorage.setItem('nkap_hist_' + key, JSON.stringify(serializeBigInts(entry)))
  } catch { /* quota */ }
}

function loadFromSession(key: string): CacheEntry | null {
  try {
    const raw = sessionStorage.getItem('nkap_hist_' + key)
    if (!raw) return null
    return deserializeBigInts(JSON.parse(raw)) as CacheEntry
  } catch { return null }
}

// ── Component ────────────────────────────────────────────────────────────────

export function BatchHistory({ ctx, refreshKey }: Props) {
  const { chainId: walletChainId, isConnected } = useAccount()
  const chainId = resolveReadChainId(walletChainId, isConnected)
  const [batches, setBatches] = useState<BatchEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [scanLabel, setScanLabel] = useState('')          // "12 345 / 50 000 blocks"
  const [progressPct, setProgressPct] = useState(0)      // 0-100 for the bar width
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Wallet's Arc chain if connected, else ?network= (default Arc Mainnet)
  const resolvedChainId = chainId
  const viemChain = resolvedChainId === arcTestnet.id ? arcTestnet : arcMainnet
  const chain = getArcChain(chainId)
  const explorerBase: string =
    (chain as { blockExplorers?: { default?: { url?: string } } } | null)
      ?.blockExplorers?.default?.url
    ?? (viemChain.id === arcMainnet.id
      ? 'https://explorer.arc.io'
      : 'https://explorer.testnet.arc.io')

  const rpcUrl = viemChain.rpcUrls.default.http[0]
  const platformIdStr = ctx.platformId.toString()
  const contractAddr = ctx.contract.toLowerCase()
  const ck = cacheKey(contractAddr, platformIdStr, resolvedChainId)

  const load = useCallback(async (forceRefresh = false) => {
    // Check in-memory cache first (survives tab switch without rescan)
    const mem = historyCache.get(ck)
    if (!forceRefresh && mem) {
      setBatches(mem.batches)
      return
    }
    // Then sessionStorage
    const sess = loadFromSession(ck)
    if (!forceRefresh && sess) {
      historyCache.set(ck, sess)
      setBatches(sess.batches)
      return
    }

    setLoading(true)
    setProgressPct(0)
    setScanLabel('Fetching block height…')
    setError(null)

    // Helper: format bigint with locale thousands separator
    function fmtBlocks(n: bigint) { return Number(n).toLocaleString() }

    try {
      // 1. Get current head via shared queue
      const head = await rpcBlockNumber(rpcUrl)

      const knownDeploy = urlFromBlock() ?? envDeployBlock(resolvedChainId) ?? DEPLOY_BLOCK[contractAddr]
      const startBlock = knownDeploy ?? (head > 10000n ? head - 10000n : 0n)
      const totalSpan = head - startBlock + 1n

      // 2. Encode platformId as a 32-byte padded topic
      const platformTopic = padHex(toHex(ctx.platformId), { size: 32 })

      // 3. Scan BatchPaid events — 5 000-block chunks, halve on range error (floor 500)
      setScanLabel(`Scanning BatchPaid events — 0 / ${fmtBlocks(totalSpan)} blocks`)
      const batchLogs = await rpcScanLogs(
        rpcUrl,
        contractAddr,
        TOPIC_BATCH_PAID,
        [null, platformTopic],
        startBlock,
        head,
        (scanned, total) => {
          setProgressPct(Math.round(Number(scanned * 50n / total)))
          setScanLabel(`Scanning BatchPaid events — ${fmtBlocks(scanned)} / ${fmtBlocks(total)} blocks`)
        },
      )

      if (batchLogs.length === 0) {
        setBatches([])
        setLoading(false)
        return
      }

      // 4. Narrow leg scan to just the blocks containing batches
      const blockNums = batchLogs.map((l) => BigInt(l.blockNumber))
      const minBlock = blockNums.reduce((a, b) => (a < b ? a : b))
      const maxBlock = blockNums.reduce((a, b) => (a > b ? a : b))
      const legSpan = maxBlock - minBlock + 1n
      const batchIdSet = new Set(
        batchLogs.map((l) => BigInt(l.topics[1] ?? '0x0').toString()),
      )

      // 5. Scan leg events in the narrow range
      setScanLabel(`Scanning payout legs — 0 / ${fmtBlocks(legSpan)} blocks`)
      const sentLogsRaw = await rpcScanLogs(
        rpcUrl, contractAddr, TOPIC_PAYOUT_SENT, [], minBlock, maxBlock,
        (scanned, total) => {
          setProgressPct(50 + Math.round(Number(scanned * 25n / total)))
          setScanLabel(`Scanning PayoutSent — ${fmtBlocks(scanned)} / ${fmtBlocks(total)} blocks`)
        },
      )

      const creditedLogsRaw = await rpcScanLogs(
        rpcUrl, contractAddr, TOPIC_PAYOUT_CREDITED, [], minBlock, maxBlock,
        (scanned, total) => {
          setProgressPct(75 + Math.round(Number(scanned * 25n / total)))
          setScanLabel(`Scanning PayoutCredited — ${fmtBlocks(scanned)} / ${fmtBlocks(total)} blocks`)
        },
      )

      // Filter legs to only batchIds found in step 3
      const sentLogs = sentLogsRaw.filter(
        (l) => batchIdSet.has(BigInt(l.topics[1] ?? '0x0').toString()),
      )
      const creditedLogs = creditedLogsRaw.filter(
        (l) => batchIdSet.has(BigInt(l.topics[1] ?? '0x0').toString()),
      )

      // 6. Decode events
      function decodeBatchPaid(l: RawLog): BatchEvent | null {
        try {
          const decoded = decodeEventLog({
            abi: NKAP_EVENTS,
            eventName: 'BatchPaid',
            topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
            data: l.data as `0x${string}`,
          })
          const ref = (decoded.args.ref as string) ?? '0x' + '00'.repeat(32)
          return {
            batchId: decoded.args.batchId,
            platformId: decoded.args.platformId,
            operator: (decoded.args.operator) ?? '',
            recipients: (decoded.args.recipients) ?? [],
            total: decoded.args.total,
            fee: decoded.args.fee,
            ref,
            refReadable: bytes32ToStr(ref),
            txHash: l.transactionHash,
            blockNumber: BigInt(l.blockNumber),
            legs: [],
          }
        } catch { return null }
      }

      function decodePayoutLeg(l: RawLog, type: 'sent' | 'credited'): LegEvent | null {
        try {
          const eventName = type === 'sent' ? 'PayoutSent' : 'PayoutCredited'
          const decoded = decodeEventLog({
            abi: NKAP_EVENTS,
            eventName,
            topics: l.topics as [`0x${string}`, ...`0x${string}`[]],
            data: l.data as `0x${string}`,
          })
          return {
            batchId: decoded.args.batchId,
            recipient: decoded.args.recipient,
            amount: decoded.args.amount,
            type,
          }
        } catch { return null }
      }

      // Build legs map
      const legsByBatch = new Map<string, LegEvent[]>()
      for (const l of sentLogs) {
        const leg = decodePayoutLeg(l, 'sent')
        if (!leg) continue
        const id = leg.batchId.toString()
        if (!legsByBatch.has(id)) legsByBatch.set(id, [])
        legsByBatch.get(id)!.push(leg)
      }
      for (const l of creditedLogs) {
        const leg = decodePayoutLeg(l, 'credited')
        if (!leg) continue
        const id = leg.batchId.toString()
        if (!legsByBatch.has(id)) legsByBatch.set(id, [])
        legsByBatch.get(id)!.push(leg)
      }

      // Assemble, sort newest-first
      const result: BatchEvent[] = batchLogs
        .map(decodeBatchPaid)
        .filter((b): b is BatchEvent => b !== null)
        .map((b) => ({ ...b, legs: legsByBatch.get(b.batchId.toString()) ?? [] }))
        .sort((a, b) => (a.blockNumber > b.blockNumber ? -1 : 1))

      setProgressPct(100)
      setScanLabel('')
      setBatches(result)

      // Cache results
      const entry: CacheEntry = { batches: result, cachedAt: Date.now(), highWaterBlock: head }
      historyCache.set(ck, entry)
      saveToSession(ck, entry)

    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)).slice(0, 200))
    } finally {
      setLoading(false)
      setScanLabel('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.contract, platformIdStr, resolvedChainId, rpcUrl, ck, refreshKey])

  // On mount and when refreshKey bumps, force a fresh scan
  useEffect(() => {
    void load(refreshKey !== undefined && refreshKey > 0)
  }, [load, refreshKey])

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 className="display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          Batch History
        </h2>
        <button
          onClick={() => void load(true)}
          disabled={loading}
          className="btn-ghost"
          style={{ padding: '6px 14px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5 }}
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </div>

      {/* Progress bar */}
      {loading && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ height: 3, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progressPct}%`,
              background: 'linear-gradient(90deg, var(--accent), #818cf8)',
              borderRadius: 4,
              transition: 'width 0.3s ease',
            }} />
          </div>
          {scanLabel && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
              {scanLabel}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 12, color: 'var(--danger)', padding: '8px 12px',
          background: 'var(--danger-bg)', borderRadius: 8, marginBottom: 12,
        }}>
          {error.includes('RPC busy') || error.includes('rate limit') || error.includes('32014')
            ? 'RPC busy, retrying… If this persists, click Refresh in a moment.'
            : error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && batches.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--subtle)', textAlign: 'center', padding: '24px 0' }}>
          No batches found for platform {platformIdStr}.
        </div>
      )}

      {/* Batch list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {batches.map((b) => {
          const key = b.batchId.toString()
          const isOpen = expanded.has(key)
          const explorerUrl = b.txHash ? `${explorerBase}/tx/${b.txHash}` : undefined
          return (
            <div key={key} className="card-inner" style={{ overflow: 'hidden' }}>
              <button
                onClick={() => toggle(key)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', background: 'transparent', border: 'none',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ color: 'var(--accent)', flexShrink: 0 }}>
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                      #{b.batchId.toString()}
                    </span>
                    <span className="badge badge-indigo">{b.recipients.length} recip.</span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {b.refReadable || b.ref.slice(0, 10) + '…'}
                    </span>
                  </div>
                </div>
                <div style={{ flexShrink: 0, textAlign: 'right' }}>
                  <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
                    {fmtUsdc(b.total)} USDC
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                    fee {fmtUsdc(b.fee)} · block {b.blockNumber.toString()}
                  </div>
                </div>
              </button>

              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '10px 14px' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                    Operator: <span className="mono">{fmtAddr(b.operator)}</span>
                    {explorerUrl && (
                      <a
                        href={explorerUrl} target="_blank" rel="noreferrer"
                        style={{ marginLeft: 10, color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                      >
                        View tx <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {b.legs.length > 0 ? b.legs.map((leg, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        {leg.type === 'sent'
                          ? <Send size={10} color="var(--success)" />
                          : <BookOpen size={10} color="var(--warn)" />
                        }
                        <span className="mono" style={{ color: 'var(--ink-2)' }}>{fmtAddr(leg.recipient)}</span>
                        <span className="mono" style={{
                          color: leg.type === 'sent' ? 'var(--success)' : 'var(--warn)',
                          marginLeft: 'auto',
                        }}>
                          {leg.type === 'credited' ? 'credited ' : ''}{fmtUsdc(leg.amount)} USDC
                        </span>
                        <span className={`badge ${leg.type === 'sent' ? 'badge-green' : 'badge-warn'}`}>
                          {leg.type}
                        </span>
                      </div>
                    )) : (
                      <div style={{ fontSize: 12, color: 'var(--subtle)' }}>
                        No leg events found.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
