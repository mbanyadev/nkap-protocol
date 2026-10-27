import { useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { Send, Clock, Settings, AlertCircle } from 'lucide-react'
import { ConnectKitButton } from 'connectkit'
import { Header } from './components/Header'
import { PlatformPanel } from './components/PlatformPanel'
import { BatchEditor } from './components/BatchEditor'
import { BatchHistory } from './components/BatchHistory'
import { AdminPanel } from './components/AdminPanel'
import type { PlatformCtx } from './components/PlatformPanel'
import { getArcChain } from './config'

// Read URL params for deep-linking
function getUrlParams() {
  const p = new URLSearchParams(window.location.search)
  return {
    contract: p.get('contract') ?? (import.meta.env.VITE_NKAP_ADDRESS as string | undefined) ?? '',
    platform: p.get('platform') ?? '0',
  }
}

type Tab = 'dispatch' | 'history' | 'admin'

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'dispatch', label: 'Dispatch',  icon: <Send size={15} /> },
  { id: 'history',  label: 'History',   icon: <Clock size={15} /> },
  { id: 'admin',    label: 'Admin',     icon: <Settings size={15} /> },
]

export default function App() {
  const { isConnected, chainId } = useAccount()
  const params = getUrlParams()

  // Default to History when a valid contract is pre-filled (read-only view without wallet)
  const [tab, setTab] = useState<Tab>(/^0x[0-9a-fA-F]{40}$/.test(params.contract) ? 'history' : 'dispatch')
  const [ctx, setCtx] = useState<PlatformCtx | null>(null)
  const [batchRefreshKey, setBatchRefreshKey] = useState(0)

  const handleBatchSuccess = useCallback(() => {
    setBatchRefreshKey((k) => k + 1)
    setTab('history')
  }, [])

  const arcChain = getArcChain(chainId)
  const wrongChain = isConnected && !arcChain

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Header />

      {/* Wrong chain banner */}
      {wrongChain && (
        <div
          style={{
            background: 'var(--warn-bg)', borderBottom: '1px solid rgba(180,83,9,0.18)',
            padding: '9px 20px', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, color: 'var(--warn)', fontWeight: 500,
          }}
        >
          <AlertCircle size={14} />
          Please switch to Arc Testnet or Arc to use Nkap. Use the network selector in the header.
        </div>
      )}

      {/* Main layout */}
      <div
        style={{
          flex: 1,
          maxWidth: 1100,
          width: '100%',
          margin: '0 auto',
          padding: '24px 16px 32px',
          display: 'grid',
          gridTemplateColumns: 'minmax(300px, 360px) 1fr',
          gap: 20,
          alignItems: 'start',
        }}
        className="main-grid"
      >
        {/* Left column: platform loader (always visible) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <PlatformPanel
            initialContract={params.contract}
            initialPlatformId={params.platform}
            onLoad={setCtx}
          />

          {/* Stats card when loaded */}
          {ctx && (
            <div
              className="card"
              style={{
                padding: 16,
                background: 'linear-gradient(135deg, rgba(79,70,229,0.07) 0%, rgba(99,102,241,0.04) 100%)',
                borderColor: 'rgba(79,70,229,0.20)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 10 }}>
                Platform · {ctx.name}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <MiniStat label="Pool" value={ctx ? fmtUsdcShort(ctx.pool) + ' USDC' : '—'} />
                <MiniStat label="Total paid" value={ctx ? fmtUsdcShort(ctx.totalPaid) + ' USDC' : '—'} />
                <MiniStat label="Batches" value={ctx?.batchCount.toString() ?? '—'} />
                <MiniStat label="Fee" value={ctx ? (ctx.feeBps / 100).toFixed(2) + '%' : '—'} />
              </div>
            </div>
          )}
        </div>

        {/* Right column: tabbed panels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Tab bar */}
          <div
            style={{
              display: 'flex', gap: 2, marginBottom: 16,
              background: 'var(--surface-strong)',
              border: '1px solid var(--border)',
              borderRadius: 12, padding: 4,
              width: 'fit-content',
            }}
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  background: tab === t.id ? 'var(--accent)' : 'transparent',
                  color: tab === t.id ? '#fff' : 'var(--muted)',
                  transition: 'all 0.15s',
                }}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content — History is read-only and wallet-free */}
          {tab === 'history' ? (
            ctx ? (
              <BatchHistory ctx={ctx} refreshKey={batchRefreshKey} />
            ) : (
              <EmptyCard
                title="Loading platform…"
                body="Platform data is loading from the public RPC."
              />
            )
          ) : tab === 'dispatch' ? (
            !isConnected ? (
              <WalletGate />
            ) : ctx ? (
              <BatchEditor ctx={ctx} onSuccess={handleBatchSuccess} />
            ) : (
              <EmptyCard
                title="Load a platform"
                body="Enter a contract address and platform ID on the left to dispatch payouts."
              />
            )
          ) : (
            !isConnected ? (
              <WalletGate />
            ) : (
              <AdminPanel ctx={ctx} contractAddr={ctx?.contract ?? params.contract} />
            )
          )}
        </div>
      </div>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '14px 20px',
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--subtle)',
          background: 'var(--surface-strong)',
        }}
      >
        Built by{' '}
        <a
          href="https://github.com/mbanya"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
        >
          Mbanya Dev
        </a>{' '}
        with{' '}
        <a
          href="https://studio.arc.io"
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}
        >
          Arc Studio
        </a>
        <span style={{ margin: '0 8px', opacity: 0.4 }}>·</span>
        NkapPayouts on Arc — USDC native mass payout infrastructure
      </footer>

      {/* Mobile responsive styles */}
      <style>{`
        @media (max-width: 720px) {
          .main-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}

function WalletGate() {
  return (
    <div
      className="card"
      style={{ padding: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
    >
      <div className="display" style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
        Connect your wallet
      </div>
      <div style={{ fontSize: 14, color: 'var(--muted)', maxWidth: 280 }}>
        Connect MetaMask or Rabby to dispatch batches and manage platforms. Batch history is readable without a wallet.
      </div>
      <ConnectKitButton label="Connect Wallet" />
    </div>
  )
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="card"
      style={{ padding: 32, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink-2)' }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{body}</div>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
        {label}
      </div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  )
}

function fmtUsdcShort(wei: bigint): string {
  const val = Number(wei) / 1e18
  if (val >= 1000) return (val / 1000).toFixed(1) + 'k'
  return val.toFixed(4).replace(/\.?0+$/, '')
}
