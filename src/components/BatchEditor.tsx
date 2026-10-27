import { useState, useMemo, useEffect } from 'react'
import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance } from 'wagmi'
import { AlertCircle, CheckCircle2, Info } from 'lucide-react'
import { NKAP_ABI, parseCsv, parseNativeUsdc, fmtUsdc, strToBytes32 } from '@/lib/nkap'
import { TxButton } from './TxButton'
import { MIN_MAX_FEE_PER_GAS } from '@/config'
import type { PlatformCtx } from './PlatformPanel'

interface Props {
  ctx: PlatformCtx
  onSuccess?: () => void
}

type Mode = 'exact' | 'split'

export function BatchEditor({ ctx, onSuccess }: Props) {
  const { address } = useAccount()
  const [mode, setMode] = useState<Mode>('exact')
  const [csv, setCsv] = useState('')
  const [ref, setRef] = useState('')
  const [splitTotal, setSplitTotal] = useState('')
  const [fundShortfall, setFundShortfall] = useState(true)

  const { data: nativeBal } = useBalance({ address })

  const rows = useMemo(() => parseCsv(csv), [csv])
  const validRows = rows.filter((r) => !r.error)
  const hasErrors = rows.some((r) => !!r.error)

  // Parse amounts / shares
  const amounts: bigint[] = useMemo(() => {
    if (mode === 'exact') return validRows.map((r) => parseNativeUsdc(r.value))
    return validRows.map((r) => BigInt(Math.round(Number(r.value))))
  }, [validRows, mode])

  const totalWei: bigint = useMemo(() => {
    if (mode === 'exact') return amounts.reduce((a, b) => a + b, 0n)
    const splitTotalWei = parseNativeUsdc(splitTotal)
    return splitTotalWei
  }, [amounts, mode, splitTotal])

  // Live quote from contract
  const { data: quoteData } = useReadContract(
    totalWei > 0n
      ? { address: ctx.contract, abi: NKAP_ABI, functionName: 'quote', args: [totalWei] }
      : undefined,
  )
  const feeWei = quoteData ? quoteData[0] : 0n
  const debitWei = quoteData ? quoteData[1] : totalWei

  const shortfallWei = debitWei > ctx.pool ? debitWei - ctx.pool : 0n

  // Ref as bytes32
  let refBytes32: `0x${string}` | null = null
  let refError: string | null = null
  try {
    if (ref) refBytes32 = strToBytes32(ref)
  } catch {
    refError = 'Reference too long (max 32 bytes)'
  }

  // Wallet balance check
  const walletBal = nativeBal?.value ?? 0n
  const valueToSend = fundShortfall ? shortfallWei : 0n
  const walletShort = valueToSend > walletBal

  // Write contract
  const {
    writeContract, data: txHash, isPending, error: txError, reset,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  useEffect(() => {
    if (isSuccess) {
      ctx.refetch()
      onSuccess?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  function canSend(): boolean {
    if (!address) return false
    if (validRows.length === 0 || hasErrors) return false
    if (!ref || refError) return false
    if (mode === 'split' && parseNativeUsdc(splitTotal) === 0n) return false
    if (amounts.some((a) => a === 0n)) return false
    if (walletShort) return false
    return true
  }

  function handleSend() {
    if (!refBytes32) return
    const recipients = validRows.map((r) => r.address as `0x${string}`)

    if (mode === 'exact') {
      writeContract({
        address: ctx.contract,
        abi: NKAP_ABI,
        functionName: 'payout',
        args: [ctx.platformId, recipients, amounts, refBytes32],
        value: fundShortfall && shortfallWei > 0n ? shortfallWei : 0n,
        maxFeePerGas: MIN_MAX_FEE_PER_GAS,
      })
    } else {
      const shares = validRows.map((r) => BigInt(Math.round(Number(r.value))))
      const splitTotalWei = parseNativeUsdc(splitTotal)
      writeContract({
        address: ctx.contract,
        abi: NKAP_ABI,
        functionName: 'payoutSplit',
        args: [ctx.platformId, recipients, shares, splitTotalWei, refBytes32],
        value: fundShortfall && shortfallWei > 0n ? shortfallWei : 0n,
        maxFeePerGas: MIN_MAX_FEE_PER_GAS,
      })
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: 0 }}>
          Batch Editor
        </h2>
        {/* Mode toggle */}
        <div
          style={{
            display: 'flex',
            background: 'var(--surface-muted)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 2,
            gap: 2,
          }}
        >
          {(['exact', 'split'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); reset() }}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: 'none',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: mode === m ? 'var(--accent)' : 'transparent',
                color: mode === m ? '#fff' : 'var(--muted)',
                transition: 'background 0.15s',
              }}
            >
              {m === 'exact' ? 'Exact' : 'Split'}
            </button>
          ))}
        </div>
      </div>

      {/* Mode hint */}
      <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 5 }}>
        <Info size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        {mode === 'exact'
          ? 'Each line: wallet, amount (USDC), label. Example: 0x1234…, 10.5, Alice'
          : 'Each line: wallet, share weight, label. Set total USDC below. Dust goes to last recipient.'}
      </div>

      {/* CSV textarea */}
      <div>
        <label className="label">Recipients ({validRows.length} valid{rows.length !== validRows.length ? `, ${rows.length - validRows.length} error` : ''})</label>
        <textarea
          className="field"
          value={csv}
          onChange={(e) => { setCsv(e.target.value); reset() }}
          placeholder={
            mode === 'exact'
              ? '0xRecipient1, 10.00, Alice\n0xRecipient2, 25.50, Bob'
              : '0xRecipient1, 3, Alice\n0xRecipient2, 7, Bob'
          }
          style={{ minHeight: 120 }}
        />
      </div>

      {/* Row validation */}
      {hasErrors && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.filter((r) => r.error).map((r, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--danger)', alignItems: 'center' }}>
              <AlertCircle size={11} />
              <span className="mono">{r.address || '(empty)'}</span>
              <span>— {r.error}</span>
            </div>
          ))}
        </div>
      )}

      {/* Split total */}
      {mode === 'split' && (
        <div>
          <label className="label">Total payout (USDC)</label>
          <input
            className="field"
            type="number"
            step="0.01"
            min={0}
            value={splitTotal}
            onChange={(e) => { setSplitTotal(e.target.value); reset() }}
            placeholder="100.00"
          />
        </div>
      )}

      {/* Reference */}
      <div>
        <label className="label">Reference (≤32 bytes)</label>
        <input
          className="field"
          value={ref}
          onChange={(e) => { setRef(e.target.value); reset() }}
          placeholder="payout-2024-001"
        />
        {refError && <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>{refError}</div>}
        {ref && !refError && (
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontFamily: 'monospace' }}>
            {strToBytes32(ref)}
          </div>
        )}
      </div>

      {/* Live quote */}
      {validRows.length > 0 && totalWei > 0n && (
        <div
          className="card-inner"
          style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <QuoteRow label="Total payout" value={fmtUsdc(totalWei)} unit="USDC" />
          <QuoteRow label={`Fee (${(ctx.feeBps / 100).toFixed(2)}%)`} value={fmtUsdc(feeWei)} unit="USDC" />
          <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
          <QuoteRow label="Debit from pool" value={fmtUsdc(debitWei)} unit="USDC" bold />
          <QuoteRow
            label="Pool balance"
            value={fmtUsdc(ctx.pool)}
            unit="USDC"
            color={ctx.pool < debitWei ? 'var(--danger)' : 'var(--success)'}
          />
          {shortfallWei > 0n && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                color: 'var(--warn)', background: 'var(--warn-bg)', borderRadius: 8, padding: '7px 10px',
              }}
            >
              <AlertCircle size={12} />
              Pool shortfall: {fmtUsdc(shortfallWei)} USDC
            </div>
          )}
        </div>
      )}

      {/* Fund shortfall toggle */}
      {shortfallWei > 0n && (
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
            color: 'var(--ink)', cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={fundShortfall}
            onChange={(e) => setFundShortfall(e.target.checked)}
            style={{ accentColor: 'var(--accent)', width: 15, height: 15 }}
          />
          Fund shortfall ({fmtUsdc(shortfallWei)} USDC) in same transaction
          {walletShort && fundShortfall && (
            <span style={{ color: 'var(--danger)', fontSize: 11 }}> — wallet balance too low</span>
          )}
        </label>
      )}

      {/* Recipient preview table */}
      {validRows.length > 0 && validRows.length <= 10 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Wallet</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>
                  {mode === 'exact' ? 'Amount' : 'Share'}
                </th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Label</th>
              </tr>
            </thead>
            <tbody>
              {validRows.map((r, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '5px 8px' }} className="mono">{r.address.slice(0, 10)}…</td>
                  <td style={{ padding: '5px 8px' }} className="mono">{r.value}</td>
                  <td style={{ padding: '5px 8px', color: 'var(--muted)' }}>{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {validRows.length > 10 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {validRows.length} recipients (preview hidden for large batches)
        </div>
      )}

      {/* Send button */}
      <TxButton
        label={`Send Batch (${validRows.length} recipients)`}
        loadingLabel="Broadcasting…"
        onClick={handleSend}
        isPending={isPending}
        isConfirming={isConfirming}
        isSuccess={isSuccess}
        txHash={txHash}
        error={txError}
        disabled={!canSend()}
      />

      {isSuccess && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
            color: 'var(--success)', fontWeight: 600,
          }}
        >
          <CheckCircle2 size={14} />
          Batch confirmed! Pool updated.
        </div>
      )}
    </div>
  )
}

function QuoteRow({
  label, value, unit, bold, color,
}: { label: string; value: string; unit?: string; bold?: boolean; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span
        className="mono"
        style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: color ?? 'var(--ink)' }}
      >
        {value}{unit && <span style={{ fontSize: 11, color: 'var(--subtle)', marginLeft: 3 }}>{unit}</span>}
      </span>
    </div>
  )
}
