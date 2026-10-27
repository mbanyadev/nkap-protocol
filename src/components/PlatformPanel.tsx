import { useState, useEffect, useCallback, useRef } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useAccount } from 'wagmi'
import { isAddress, encodeFunctionData, decodeFunctionResult } from 'viem'
import { arcTestnet } from 'viem/chains'
import { RefreshCw, TrendingUp, Layers, DollarSign, AlertCircle, Loader2 } from 'lucide-react'
import { NKAP_ABI, fmtUsdc, parseNativeUsdc, fmtAddr } from '@/lib/nkap'
import { TxButton } from './TxButton'
import { MIN_MAX_FEE_PER_GAS, arcMainnet, resolveReadChainId } from '@/config'
import { rpcEthCall } from '@/lib/rpc'

export interface PlatformCtx {
  contract: `0x${string}`
  platformId: bigint
  name: string
  owner: string
  pool: bigint
  totalPaid: bigint
  batchCount: bigint
  feeBps: number
  refetch: () => void
}

interface Props {
  initialContract?: string
  initialPlatformId?: string
  onLoad: (ctx: PlatformCtx | null) => void
}

// Pick RPC URL for the given chainId (default Arc Mainnet)
function rpcUrlFor(chainId: number | undefined): string {
  if (chainId === arcMainnet.id) return arcMainnet.rpcUrls.default.http[0]
  if (chainId === arcTestnet.id) return arcTestnet.rpcUrls.default.http[0]
  return arcMainnet.rpcUrls.default.http[0]
}

// ── Platform sessionStorage cache ─────────────────────────────────────────────

interface PlatformCacheEntry {
  platform: readonly [string, string, string, string, string]  // bigints as strings
  feeBps: number
  cachedAt: number
}

function platformCacheKey(addr: string, pid: bigint, chainId: number | undefined) {
  return `nkap_plat_${addr.toLowerCase()}:${pid}:${chainId ?? 0}`
}

function savePlatformCache(
  key: string,
  p: readonly [string, string, bigint, bigint, bigint],
  fee: number,
) {
  try {
    const entry: PlatformCacheEntry = {
      platform: [p[0], p[1], p[2].toString(), p[3].toString(), p[4].toString()],
      feeBps: fee,
      cachedAt: Date.now(),
    }
    sessionStorage.setItem(key, JSON.stringify(entry))
  } catch { /* quota */ }
}

function loadPlatformCache(key: string): { p: readonly [string, string, bigint, bigint, bigint]; fee: number } | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as PlatformCacheEntry
    const p = [
      entry.platform[0],
      entry.platform[1],
      BigInt(entry.platform[2]),
      BigInt(entry.platform[3]),
      BigInt(entry.platform[4]),
    ] as const
    return { p, fee: entry.feeBps }
  } catch { return null }
}

export function PlatformPanel({ initialContract, initialPlatformId, onLoad }: Props) {
  const [contractAddr, setContractAddr] = useState(initialContract ?? '')
  const [pidStr, setPidStr]             = useState(initialPlatformId ?? '0')
  const [loading, setLoading]           = useState(false)
  const [retrying, setRetrying]         = useState(false)
  const [error, setError]               = useState<string | null>(null)
  const [platform, setPlatform]         = useState<readonly [string, string, bigint, bigint, bigint] | null>(null)
  const [feeBps, setFeeBps]             = useState<number | null>(null)
  const [fundAmt, setFundAmt]           = useState('')
  const { address, chainId: walletChainId, isConnected } = useAccount()
  const chainId = resolveReadChainId(walletChainId, isConnected)

  const validContract = isAddress(contractAddr)
  const pid = BigInt(pidStr.replace(/\D/g, '') || '0')

  // ── Direct raw-fetch eth_call — wallet-free, throttled, cached ──────────
  const fetchPlatform = useCallback(async (
    addr: string,
    platformId: bigint,
    cId: number | undefined,
    useCache = false,
  ) => {
    if (!isAddress(addr)) return
    const ck = platformCacheKey(addr, platformId, cId)

    // On cold load (auto-load from URL params), try session cache first
    if (useCache) {
      const cached = loadPlatformCache(ck)
      if (cached) {
        setPlatform(cached.p)
        setFeeBps(cached.fee)
        return
      }
    }

    setLoading(true)
    setRetrying(false)
    setError(null)
    const rpc = rpcUrlFor(cId)

    try {
      // Encode calldata for getPlatform(uint256)
      const getPlatformData = encodeFunctionData({
        abi: NKAP_ABI,
        functionName: 'getPlatform',
        args: [platformId],
      })
      // Encode calldata for feeBps()
      const feeBpsData = encodeFunctionData({
        abi: NKAP_ABI,
        functionName: 'feeBps',
      })

      // Fire both through the shared throttled queue (sequential, 4 req/s)
      let platformHex: string
      let feeHex: string
      try {
        platformHex = await rpcEthCall(rpc, addr, getPlatformData)
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e))
        if (msg.includes('RPC busy')) setRetrying(true)
        throw e
      }
      try {
        feeHex = await rpcEthCall(rpc, addr, feeBpsData)
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e))
        if (msg.includes('RPC busy')) setRetrying(true)
        throw e
      }
      setRetrying(false)

      // Decode results
      const p = decodeFunctionResult({
        abi: NKAP_ABI,
        functionName: 'getPlatform',
        data: platformHex as `0x${string}`,
      }) as readonly [string, string, bigint, bigint, bigint]

      const fee = decodeFunctionResult({
        abi: NKAP_ABI,
        functionName: 'feeBps',
        data: feeHex as `0x${string}`,
      }) as unknown as bigint

      setPlatform(p)
      setFeeBps(Number(fee))

      // Persist to sessionStorage for instant reload
      savePlatformCache(ck, p, Number(fee))
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e))
      setRetrying(false)
      setError(msg)
      setPlatform(null)
      setFeeBps(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-load on mount when a valid contract is pre-filled from URL / env
  // Pass useCache=true so a cached entry shows immediately without a network call
  const didAutoLoad = useRef(false)
  useEffect(() => {
    if (!didAutoLoad.current && isAddress(initialContract ?? '')) {
      didAutoLoad.current = true
      void fetchPlatform(contractAddr, pid, chainId, true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push context up whenever data changes
  useEffect(() => {
    if (platform && feeBps !== null) {
      onLoad({
        contract: contractAddr as `0x${string}`,
        platformId: pid,
        name: platform[1],
        owner: platform[0],
        pool: platform[2],
        totalPaid: platform[3],
        batchCount: platform[4],
        feeBps,
        refetch: () => void fetchPlatform(contractAddr, pid, chainId),
      })
    } else if (!loading) {
      onLoad(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, feeBps, loading])

  function handleLoad() {
    if (!validContract) return
    void fetchPlatform(contractAddr, pid, chainId)
  }

  // ── Fund pool write (wallet required) ────────────────────────────────────
  const { writeContract: fundWrite, data: fundHash, isPending: fundPending, error: fundError } = useWriteContract()
  const { isLoading: fundConfirming, isSuccess: fundSuccess } = useWaitForTransactionReceipt({ hash: fundHash })

  function handleFund() {
    if (!validContract) return
    const wei = parseNativeUsdc(fundAmt)
    if (wei === 0n) return
    fundWrite({
      address: contractAddr,
      abi: NKAP_ABI,
      functionName: 'fund',
      args: [pid],
      value: wei,
      maxFeePerGas: MIN_MAX_FEE_PER_GAS,
    })
  }

  useEffect(() => {
    if (fundSuccess) {
      setFundAmt('')
      void fetchPlatform(contractAddr, pid, chainId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundSuccess])

  const feePct = feeBps !== null ? (feeBps / 100).toFixed(2) : '—'

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
        Load Platform
      </h2>

      {/* Contract + Platform ID inputs */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <div>
          <label className="label">Contract address</label>
          <input
            className="field"
            value={contractAddr}
            onChange={(e) => { setContractAddr(e.target.value); setPlatform(null); setError(null) }}
            placeholder="0x…"
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label className="label">Platform ID</label>
            <input
              className="field"
              type="number"
              min={0}
              value={pidStr}
              onChange={(e) => { setPidStr(e.target.value); setPlatform(null); setError(null) }}
              placeholder="0"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button
              className="btn-primary"
              onClick={handleLoad}
              disabled={!validContract || loading}
              style={{ padding: '9px 18px', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {loading ? (retrying ? 'Retrying…' : 'Loading…') : 'Load'}
            </button>
          </div>
        </div>
      </div>

      {/* Loading / retrying state */}
      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
          color: retrying ? 'var(--warn)' : 'var(--muted)', marginBottom: 10 }}>
          <Loader2 size={14} className="animate-spin" />
          {retrying ? 'RPC busy, retrying…' : 'Fetching from Arc Testnet RPC…'}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px',
          background: 'var(--danger-bg)', borderRadius: 10, fontSize: 13, color: 'var(--danger)',
          marginBottom: 14,
        }}>
          <AlertCircle size={14} />
          {error.includes('PlatformNotFound') || error.includes('0x4e487') || error.includes('revert')
            ? 'Platform not found — check the contract address and platform ID.'
            : error.includes('RPC busy')
              ? 'RPC rate limit reached. Please wait a moment and click Load.'
              : `RPC error: ${error.slice(0, 100)}`}
        </div>
      )}

      {/* Platform info */}
      {!loading && platform && (
        <div className="card-inner"
          style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
              {platform[1]}
            </span>
            <span className="badge badge-indigo">ID {pid.toString()}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <StatRow icon={<DollarSign size={13} />} label="Pool"       value={fmtUsdc(platform[2])} unit="USDC" />
            <StatRow icon={<TrendingUp size={13} />} label="Total Paid" value={fmtUsdc(platform[3])} unit="USDC" />
            <StatRow icon={<Layers size={13} />}     label="Batches"    value={platform[4].toString()} />
            <StatRow icon={<DollarSign size={13} />} label="Fee"        value={`${feePct}%`} />
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Owner:&nbsp;
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>
              {fmtAddr(platform[0])}
            </span>
            {address?.toLowerCase() === platform[0].toLowerCase() && (
              <span className="badge badge-indigo" style={{ marginLeft: 6 }}>you</span>
            )}
          </div>
        </div>
      )}

      {/* Fund pool (wallet required) */}
      {address && platform && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="label">Fund pool</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="field"
              type="number"
              step="0.01"
              min={0}
              value={fundAmt}
              onChange={(e) => setFundAmt(e.target.value)}
              placeholder="0.00 USDC"
              style={{ flex: 1 }}
            />
            <button
              className="btn-ghost"
              onClick={handleFund}
              disabled={fundPending || fundConfirming || !fundAmt || parseNativeUsdc(fundAmt) === 0n}
              style={{ whiteSpace: 'nowrap' }}
            >
              {fundPending || fundConfirming ? 'Funding…' : 'Fund'}
            </button>
          </div>
          {(fundHash || fundError) && (
            <TxButton
              label="Fund Pool"
              onClick={handleFund}
              isPending={fundPending}
              isConfirming={fundConfirming}
              isSuccess={fundSuccess}
              txHash={fundHash}
              error={fundError}
              disabled={true}
            />
          )}
          {fundSuccess && (
            <div style={{ fontSize: 12, color: 'var(--success)' }}>Pool funded. Stats updated.</div>
          )}
        </div>
      )}
    </div>
  )
}

function StatRow({ icon, label, value, unit }: { icon: React.ReactNode; label: string; value: string; unit?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted)',
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }} className="mono">
        {value}{unit ? <span style={{ fontSize: 11, color: 'var(--subtle)', marginLeft: 3 }}>{unit}</span> : null}
      </div>
    </div>
  )
}
