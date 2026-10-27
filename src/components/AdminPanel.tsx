import { useState, useEffect } from 'react'
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract, useDeployContract } from 'wagmi'
import { isAddress } from 'viem'
import { AlertCircle, Info, Rocket } from 'lucide-react'
import { NKAP_ABI, fmtUsdc } from '@/lib/nkap'
import { TxButton } from './TxButton'
import { MIN_MAX_FEE_PER_GAS } from '@/config'
import type { PlatformCtx } from './PlatformPanel'

// Bytecode from the compiled artifact (Arc Testnet deployment)
// For "deploy new contract" we import it lazily from the artifact JSON.
async function loadBytecode(): Promise<`0x${string}`> {
  try {
    const artifact = await import('../../contracts/out/NkapPayouts.sol/NkapPayouts.json')
    return (artifact.bytecode?.object ?? artifact.bytecode) as `0x${string}`
  } catch {
    throw new Error('Compiled artifact not found. Run forge build first.')
  }
}

interface Props {
  ctx: PlatformCtx | null
  contractAddr: string
}

type Section = 'platform' | 'protocol' | 'deploy' | 'claim'

export function AdminPanel({ ctx, contractAddr }: Props) {
  const { address } = useAccount()
  const [section, setSection] = useState<Section>('platform')

  const isProtocolOwner = useReadContract(
    contractAddr && isAddress(contractAddr)
      ? { address: contractAddr, abi: NKAP_ABI, functionName: 'protocolOwner' }
      : undefined,
  )
  const feesAccrued = useReadContract(
    contractAddr && isAddress(contractAddr)
      ? { address: contractAddr, abi: NKAP_ABI, functionName: 'feesAccrued' }
      : undefined,
  )

  const protocolOwnerAddr = isProtocolOwner.data as string | undefined
  const isOwner = !!(address && protocolOwnerAddr &&
    protocolOwnerAddr.toLowerCase() === address.toLowerCase())

  const sections: { id: Section; label: string }[] = [
    { id: 'platform', label: 'Platform ops' },
    { id: 'protocol', label: 'Protocol admin' },
    { id: 'deploy',   label: 'Deploy contract' },
    { id: 'claim',    label: 'Claim fees' },
  ]

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="display" style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', margin: '0 0 16px' }}>
        Admin
      </h2>

      {/* Section tabs */}
      <div
        style={{
          display: 'flex', gap: 4, marginBottom: 20,
          background: 'var(--surface-muted)', borderRadius: 10, padding: 4,
          flexWrap: 'wrap',
        }}
      >
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              flex: 1, minWidth: 'fit-content',
              padding: '7px 12px', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: section === s.id ? 'var(--surface-strong)' : 'transparent',
              color: section === s.id ? 'var(--accent)' : 'var(--muted)',
              boxShadow: section === s.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              transition: 'all 0.15s',
              whiteSpace: 'nowrap',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'platform' && (
        <PlatformOps ctx={ctx} contractAddr={contractAddr} />
      )}
      {section === 'protocol' && (
        <ProtocolOps contractAddr={contractAddr} isOwner={isOwner} />
      )}
      {section === 'deploy' && (
        <DeployContract />
      )}
      {section === 'claim' && (
        <ClaimFees
          contractAddr={contractAddr}
          isOwner={isOwner}
          feesAccrued={feesAccrued.data}
          refetch={() => void feesAccrued.refetch()}
        />
      )}
    </div>
  )
}

// ── Platform ops: register, operator, withdraw ──────────────────────────────

function PlatformOps({ ctx, contractAddr }: { ctx: PlatformCtx | null; contractAddr: string }) {
  const { address } = useAccount()
  const [name, setName] = useState('')
  const [opAddr, setOpAddr] = useState('')
  const [opCap, setOpCap] = useState('10')
  const [withdrawAmt, setWithdrawAmt] = useState('')
  const [withdrawTo, setWithdrawTo] = useState(address ?? '')

  const {
    writeContract: createWrite, data: createHash, isPending: createPending,
    error: createError, reset: createReset,
  } = useWriteContract()
  const { isLoading: createConfirming, isSuccess: createDone } = useWaitForTransactionReceipt({ hash: createHash })

  const {
    writeContract: opWrite, data: opHash, isPending: opPending, error: opError, reset: opReset,
  } = useWriteContract()
  const { isLoading: opConfirming, isSuccess: opDone } = useWaitForTransactionReceipt({ hash: opHash })

  const {
    writeContract: wdWrite, data: wdHash, isPending: wdPending, error: wdError, reset: wdReset,
  } = useWriteContract()
  const { isLoading: wdConfirming, isSuccess: wdDone } = useWaitForTransactionReceipt({ hash: wdHash })

  const {
    writeContract: claimWrite, data: claimHash, isPending: claimPending, error: claimError,
  } = useWriteContract()
  const { isLoading: claimConfirming, isSuccess: claimDone } = useWaitForTransactionReceipt({ hash: claimHash })

  // owed balance
  const owedQuery = useReadContract(
    contractAddr && isAddress(contractAddr) && address
      ? { address: contractAddr, abi: NKAP_ABI, functionName: 'owed', args: [address] }
      : undefined,
  )
  const owedBal = owedQuery.data

  const refetchOwed = owedQuery.refetch
  useEffect(() => { if (claimDone) void refetchOwed() }, [claimDone, refetchOwed])

  const valid = isAddress(contractAddr)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Register platform */}
      <Section label="Register Platform">
        <label className="label">Platform name</label>
        <input className="field" value={name} onChange={(e) => { setName(e.target.value); createReset() }} placeholder="My Platform" style={{ marginBottom: 10 }} />
        <TxButton
          label="Create Platform"
          onClick={() => createWrite({
            address: contractAddr as `0x${string}`,
            abi: NKAP_ABI, functionName: 'createPlatform', args: [name],
            maxFeePerGas: MIN_MAX_FEE_PER_GAS,
          })}
          isPending={createPending} isConfirming={createConfirming}
          isSuccess={createDone} txHash={createHash} error={createError}
          disabled={!valid || !name}
        />
      </Section>

      {/* Set operator (only if platform loaded) */}
      {ctx && (
        <Section label={`Set Operator — Platform ${ctx.platformId}`}>
          <label className="label">Operator address</label>
          <input className="field" value={opAddr} onChange={(e) => { setOpAddr(e.target.value); opReset() }} placeholder="0x…" style={{ marginBottom: 8 }} />
          <label className="label">Spending allowance (USDC) — 0 revokes</label>
          <input className="field" type="number" min={0} step="0.01" value={opCap} onChange={(e) => { setOpCap(e.target.value); opReset() }} placeholder="100" style={{ marginBottom: 10 }} />
          <TxButton
            label="Set Operator"
            onClick={() => {
              const allowanceWei = BigInt(Math.round(Number(opCap || '0') * 1e18))
              opWrite({
                address: ctx.contract, abi: NKAP_ABI, functionName: 'setOperator',
                args: [ctx.platformId, opAddr as `0x${string}`, allowanceWei],
                maxFeePerGas: MIN_MAX_FEE_PER_GAS,
              })
            }}
            isPending={opPending} isConfirming={opConfirming}
            isSuccess={opDone} txHash={opHash} error={opError}
            disabled={!ctx || !isAddress(opAddr) || opCap === ''}
          />
        </Section>
      )}

      {/* Withdraw pool (only if platform loaded and owner) */}
      {ctx && (
        <Section label={`Withdraw Pool — Platform ${ctx.platformId} (${fmtUsdc(ctx.pool)} USDC)`}>
          <label className="label">Amount (USDC)</label>
          <input className="field" type="number" step="0.01" value={withdrawAmt} onChange={(e) => { setWithdrawAmt(e.target.value); wdReset() }} placeholder="0.00" style={{ marginBottom: 8 }} />
          <label className="label">To address</label>
          <input className="field" value={withdrawTo} onChange={(e) => { setWithdrawTo(e.target.value); wdReset() }} placeholder="0x…" style={{ marginBottom: 10 }} />
          <TxButton
            label="Withdraw Pool"
            onClick={() => {
              const wei = BigInt(Math.round(Number(withdrawAmt) * 1e18))
              wdWrite({
                address: ctx.contract, abi: NKAP_ABI, functionName: 'withdrawPool',
                args: [ctx.platformId, wei, withdrawTo as `0x${string}`],
                maxFeePerGas: MIN_MAX_FEE_PER_GAS,
              })
            }}
            isPending={wdPending} isConfirming={wdConfirming}
            isSuccess={wdDone} txHash={wdHash} error={wdError}
            disabled={!ctx || !withdrawAmt || !isAddress(withdrawTo)}
          />
        </Section>
      )}

      {/* Withdraw owed USDC */}
      <Section label="Withdraw My Owed USDC">
        {owedBal !== undefined && owedBal > 0n ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--ink)', marginBottom: 10 }}>
              You have <strong className="mono">{fmtUsdc(owedBal)} USDC</strong> credited to your address.
            </div>
            <TxButton
              label={`Claim ${fmtUsdc(owedBal)} USDC`}
              onClick={() => claimWrite({
                address: contractAddr as `0x${string}`, abi: NKAP_ABI, functionName: 'withdraw',
                maxFeePerGas: MIN_MAX_FEE_PER_GAS,
              })}
              isPending={claimPending} isConfirming={claimConfirming}
              isSuccess={claimDone} txHash={claimHash} error={claimError}
              disabled={!valid}
            />
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--subtle)' }}>
            No owed balance{owedBal === 0n ? ' for your address' : ''}.
          </div>
        )}
      </Section>
    </div>
  )
}

// ── Protocol admin ──────────────────────────────────────────────────────────

function ProtocolOps({ contractAddr, isOwner }: { contractAddr: string; isOwner: boolean }) {
  const [newFee, setNewFee] = useState('')
  const [newTreasury, setNewTreasury] = useState('')

  const {
    writeContract: feeWrite, data: feeHash, isPending: feePending, error: feeError, reset: feeReset,
  } = useWriteContract()
  const { isLoading: feeConfirming, isSuccess: feeDone } = useWaitForTransactionReceipt({ hash: feeHash })

  const {
    writeContract: tWrite, data: tHash, isPending: tPending, error: tError, reset: tReset,
  } = useWriteContract()
  const { isLoading: tConfirming, isSuccess: tDone } = useWaitForTransactionReceipt({ hash: tHash })

  const valid = isAddress(contractAddr)

  if (!isOwner) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', padding: '10px 0' }}>
        <AlertCircle size={14} />
        Only the protocol owner can use these settings.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Section label="Update Protocol Fee">
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, display: 'flex', gap: 5 }}>
          <Info size={11} style={{ flexShrink: 0, marginTop: 1 }} />
          Max 100 bps (1%). Current fee is shown on the Platform panel.
        </div>
        <label className="label">New fee (bps)</label>
        <input className="field" type="number" min={0} max={100} value={newFee} onChange={(e) => { setNewFee(e.target.value); feeReset() }} placeholder="40" style={{ marginBottom: 10 }} />
        <TxButton
          label="Set Fee"
          onClick={() => feeWrite({
            address: contractAddr as `0x${string}`, abi: NKAP_ABI, functionName: 'setFee',
            args: [Number(newFee)],
            maxFeePerGas: MIN_MAX_FEE_PER_GAS,
          })}
          isPending={feePending} isConfirming={feeConfirming}
          isSuccess={feeDone} txHash={feeHash} error={feeError}
          disabled={!valid || !newFee || Number(newFee) > 100}
        />
      </Section>

      <Section label="Update Treasury">
        <label className="label">New treasury address</label>
        <input className="field" value={newTreasury} onChange={(e) => { setNewTreasury(e.target.value); tReset() }} placeholder="0x…" style={{ marginBottom: 10 }} />
        <TxButton
          label="Set Treasury"
          onClick={() => tWrite({
            address: contractAddr as `0x${string}`, abi: NKAP_ABI, functionName: 'setTreasury',
            args: [newTreasury as `0x${string}`],
            maxFeePerGas: MIN_MAX_FEE_PER_GAS,
          })}
          isPending={tPending} isConfirming={tConfirming}
          isSuccess={tDone} txHash={tHash} error={tError}
          disabled={!valid || !isAddress(newTreasury)}
        />
      </Section>
    </div>
  )
}

// ── Deploy new contract ──────────────────────────────────────────────────────

function DeployContract() {
  const { address } = useAccount()
  const [treasury, setTreasury] = useState(address ?? '')
  const [feeBps, setFeeBps] = useState('40')
  const [bytecodeLoaded, setBytecodeLoaded] = useState<`0x${string}` | null>(null)
  const [bytecodeError, setBytecodeError] = useState<string | null>(null)
  const { deployContract, data: deployHash, isPending, error: deployError, reset: _resetDeploy } = useDeployContract()
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash: deployHash })

  // Derive deployed address directly from receipt (no extra state)
  const deployedAddr = isSuccess && receipt?.contractAddress ? receipt.contractAddress : null

  async function handleLoad() {
    setBytecodeError(null)
    try {
      const bc = await loadBytecode()
      setBytecodeLoaded(bc)
    } catch (e) {
      setBytecodeError((e as Error).message)
    }
  }

  function handleDeploy() {
    if (!bytecodeLoaded) return
    deployContract({
      abi: NKAP_ABI,
      bytecode: bytecodeLoaded,
      args: [treasury as `0x${string}`, Number(feeBps)],
      maxFeePerGas: MIN_MAX_FEE_PER_GAS,
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 5 }}>
        <Rocket size={12} style={{ flexShrink: 0, marginTop: 1 }} />
        Deploy a fresh NkapPayouts contract from your wallet on the current network.
      </div>

      {!bytecodeLoaded && (
        <button className="btn-ghost" onClick={() => void handleLoad()} style={{ width: 'fit-content' }}>
          Load bytecode from artifact
        </button>
      )}
      {bytecodeError && (
        <div style={{ fontSize: 12, color: 'var(--danger)', background: 'var(--danger-bg)', borderRadius: 8, padding: '8px 10px' }}>
          {bytecodeError}
        </div>
      )}

      {bytecodeLoaded && (
        <>
          <div style={{ fontSize: 11, color: 'var(--success)' }}>Bytecode loaded ({bytecodeLoaded.length / 2 - 1} bytes)</div>
          <label className="label">Treasury address</label>
          <input className="field" value={treasury} onChange={(e) => { setTreasury(e.target.value); _resetDeploy() }} placeholder="0x…" />
          <label className="label">Fee bps (≤100)</label>
          <input className="field" type="number" min={0} max={100} value={feeBps} onChange={(e) => { setFeeBps(e.target.value); _resetDeploy() }} placeholder="40" />
          <TxButton
            label="Deploy NkapPayouts"
            onClick={handleDeploy}
            isPending={isPending} isConfirming={isConfirming}
            isSuccess={isSuccess} txHash={deployHash} error={deployError}
            disabled={!isAddress(treasury) || Number(feeBps) > 100}
          />
          {deployedAddr && (
            <div style={{ fontSize: 12, color: 'var(--success)', background: 'var(--success-bg)', borderRadius: 8, padding: '8px 10px' }}>
              Deployed at: <span className="mono">{deployedAddr}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Claim protocol fees ──────────────────────────────────────────────────────

function ClaimFees({
  contractAddr, isOwner, feesAccrued, refetch,
}: { contractAddr: string; isOwner: boolean; feesAccrued?: bigint; refetch: () => void }) {
  const {
    writeContract, data: hash, isPending, error,
  } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  useEffect(() => { if (isSuccess) refetch() }, [isSuccess, refetch])

  const valid = isAddress(contractAddr)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card-inner" style={{ padding: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Protocol fees accrued</div>
        <div className="display mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)' }}>
          {feesAccrued !== undefined ? fmtUsdc(feesAccrued) : '—'}
          <span style={{ fontSize: 14, color: 'var(--subtle)', marginLeft: 6 }}>USDC</span>
        </div>
      </div>

      {!isOwner && (
        <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 5 }}>
          <AlertCircle size={11} style={{ marginTop: 1 }} />
          Only the protocol owner can claim fees.
        </div>
      )}

      <TxButton
        label="Claim Fees to Treasury"
        onClick={() => writeContract({
          address: contractAddr as `0x${string}`,
          abi: NKAP_ABI,
          functionName: 'claimFees',
          maxFeePerGas: MIN_MAX_FEE_PER_GAS,
        })}
        isPending={isPending} isConfirming={isConfirming}
        isSuccess={isSuccess} txHash={hash} error={error}
        disabled={!valid || !isOwner || !feesAccrued || feesAccrued === 0n}
      />
    </div>
  )
}

// ── Helper section wrapper ────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 10, borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  )
}
