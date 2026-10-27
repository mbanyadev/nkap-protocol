import { useAccount, useBalance, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { ChevronDown, Zap, Circle } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { ARC_CHAINS, getArcChain, resolveReadChainId, setUrlNetwork } from '@/config'
import { fmtUsdc } from '@/lib/nkap'


export function Header() {
  return (
    <header
      style={{
        background: 'var(--surface-strong)',
        borderBottom: '1px solid var(--border)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '0 20px',
          height: 56,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'var(--accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Zap size={15} color="#fff" strokeWidth={2.5} />
          </div>
          <span
            className="display"
            style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-0.02em' }}
          >
            Nkap
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--accent)',
              background: 'var(--accent-light)',
              borderRadius: 99,
              padding: '2px 6px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            Payout
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Network switcher */}
        <NetworkSwitcher />

        {/* Connect button (ConnectKit custom) */}
        <ConnectKitButton.Custom>
          {({ isConnected, show, address, truncatedAddress }) => (
            <button
              onClick={show}
              style={{
                background: isConnected ? 'var(--accent-light)' : 'var(--accent)',
                color: isConnected ? 'var(--accent)' : '#fff',
                border: isConnected ? '1px solid var(--border-strong)' : 'none',
                borderRadius: 8,
                padding: '7px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
              }}
            >
              {isConnected ? (
                <>
                  <Circle size={7} fill="var(--success)" color="var(--success)" />
                  {truncatedAddress ?? address?.slice(0, 6) + '…' + address?.slice(-4)}
                </>
              ) : (
                'Connect Wallet'
              )}
            </button>
          )}
        </ConnectKitButton.Custom>

        {/* USDC balance */}
        <USDCBalancePill />
      </div>
    </header>
  )
}

function NetworkSwitcher() {
  const { chainId: walletChainId, isConnected } = useAccount()
  const chainId = resolveReadChainId(walletChainId, isConnected)
  const { switchChain, isPending } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = getArcChain(chainId)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'var(--surface-muted)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 500,
          color: current ? 'var(--ink-2)' : 'var(--warn)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: current ? 'var(--success)' : 'var(--warn)',
            flexShrink: 0,
          }}
        />
        {current ? current.name : chainId ? `Chain ${chainId}` : 'No network'}
        <ChevronDown size={13} style={{ color: 'var(--subtle)', marginLeft: 2 }} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 180,
            background: 'var(--surface-strong)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
            overflow: 'hidden',
            zIndex: 100,
          }}
        >
          {ARC_CHAINS.map((chain) => (
            <button
              key={chain.id}
              onClick={() => {
                if (isConnected) switchChain({ chainId: chain.id })
                else setUrlNetwork(chain.id)
                setOpen(false)
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                background: chainId === chain.id ? 'var(--accent-light)' : 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: chainId === chain.id ? 600 : 400,
                color: chainId === chain.id ? 'var(--accent)' : 'var(--ink)',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: chain.isTestnet ? 'var(--warn)' : 'var(--success)',
                  flexShrink: 0,
                }}
              />
              {chain.name}
              {chain.isTestnet && (
                <span style={{ fontSize: 10, color: 'var(--warn)', marginLeft: 'auto' }}>testnet</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function USDCBalancePill() {
  const { address } = useAccount()

  // On Arc, native balance IS USDC — use native for display (18 dec).
  // ERC-20 view is the same pool; native gives 18-dec precision so we skip the 6-dec ERC-20 call.
  const { data: nativeBal } = useBalance(address ? { address } : undefined)

  if (!address) return null

  // Prefer native balance on Arc (18 dec gives more precision)
  const displayBal = nativeBal?.value ?? 0n
  const formatted = fmtUsdc(displayBal, 4)

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        background: 'var(--surface-muted)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--ink)',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>USDC</span>
      <span className="mono" style={{ color: 'var(--ink)' }}>
        {formatted}
      </span>
    </div>
  )
}
