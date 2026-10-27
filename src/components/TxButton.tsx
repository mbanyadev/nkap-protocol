import { Loader2, ExternalLink } from 'lucide-react'
import { useAccount } from 'wagmi'
import { getArcChain } from '@/config'

interface TxButtonProps {
  label: string
  loadingLabel?: string
  onClick: () => void
  isPending: boolean
  isConfirming: boolean
  isSuccess: boolean
  txHash?: `0x${string}`
  error?: Error | null
  disabled?: boolean
  className?: string
}

export function TxButton({
  label,
  loadingLabel,
  onClick,
  isPending,
  isConfirming,
  isSuccess,
  txHash,
  error,
  disabled,
}: TxButtonProps) {
  const { chainId } = useAccount()
  const chain = getArcChain(chainId)
  const explorerUrl = txHash && chain ? `${chain.explorer}/tx/${txHash}` : undefined

  const busy = isPending || isConfirming

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        className="btn-primary"
        onClick={onClick}
        disabled={disabled || busy}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
      >
        {busy && <Loader2 size={15} className="animate-spin" />}
        {isPending
          ? 'Confirm in wallet…'
          : isConfirming
          ? (loadingLabel ?? 'Confirming…')
          : label}
      </button>

      {isSuccess && explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontSize: 12,
            color: 'var(--success)',
            fontWeight: 600,
            textDecoration: 'none',
            padding: '6px 10px',
            background: 'var(--success-bg)',
            borderRadius: 8,
          }}
        >
          <span>Confirmed</span>
          <ExternalLink size={11} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>
            {txHash?.slice(0, 10)}…
          </span>
        </a>
      )}

      {error && !isPending && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--danger)',
            background: 'var(--danger-bg)',
            borderRadius: 8,
            padding: '7px 10px',
          }}
        >
          {parseErr(error)}
        </div>
      )}
    </div>
  )
}

function parseErr(e: Error): string {
  const m = e.message?.toLowerCase() ?? ''
  if (m.includes('user rejected') || m.includes('user denied')) return 'Transaction cancelled.'
  if (m.includes('insufficient funds') || m.includes('exceeds balance')) return 'Insufficient balance.'
  if (m.includes('duplicateref')) return 'Reference already used — choose a different ref.'
  if (m.includes('insufficientpool')) return 'Pool balance too low. Fund the pool first.'
  if (m.includes('emptybatch')) return 'Batch has no recipients.'
  if (m.includes('toomanyrecipients')) return 'Max 200 recipients per batch.'
  if (m.includes('unauthorized')) return 'Not authorised for this action.'
  if (m.includes('reverted')) {
    const r = e.message.match(/reason="([^"]+)"/)
    return r ? `Reverted: ${r[1]}` : 'Transaction reverted.'
  }
  return 'Something went wrong. Try again.'
}
