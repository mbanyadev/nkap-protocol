/**
 * NkapPayouts — shared ABI, types, and helpers.
 * Native USDC on Arc: all value is 18-decimal msg.value, never ERC-20.
 */

export const NKAP_ABI = [
  // ── Views ──────────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'getPlatform', stateMutability: 'view',
    inputs: [{ name: 'platformId', type: 'uint256' }],
    outputs: [
      { name: 'owner', type: 'address' },
      { name: 'name', type: 'string' },
      { name: 'pool', type: 'uint256' },
      { name: 'totalPaid', type: 'uint256' },
      { name: 'batchCount_', type: 'uint256' },
    ],
  },
  {
    type: 'function', name: 'poolOf', stateMutability: 'view',
    inputs: [{ name: 'platformId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'quote', stateMutability: 'view',
    inputs: [{ name: 'total', type: 'uint256' }],
    outputs: [{ name: 'fee', type: 'uint256' }, { name: 'debit', type: 'uint256' }],
  },
  {
    type: 'function', name: 'previewSplit', stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256[]' }, { name: 'total', type: 'uint256' }],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    type: 'function', name: 'feeBps', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint16' }],
  },
  {
    type: 'function', name: 'feesAccrued', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'platformCount', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'batchCount', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalPaidOut', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'protocolOwner', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'treasury', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function', name: 'owed', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'operators', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }, { name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'totalReceivedBy', stateMutability: 'view',
    inputs: [{ name: 'recipient', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // ── Writes ─────────────────────────────────────────────────────────────────
  {
    type: 'function', name: 'createPlatform', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'string' }],
    outputs: [{ name: 'platformId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'setOperator', stateMutability: 'nonpayable',
    inputs: [
      { name: 'platformId', type: 'uint256' },
      { name: 'operator', type: 'address' },
      { name: 'allowance', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'fund', stateMutability: 'payable',
    inputs: [{ name: 'platformId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'withdrawPool', stateMutability: 'nonpayable',
    inputs: [
      { name: 'platformId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'to', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'payout', stateMutability: 'payable',
    inputs: [
      { name: 'platformId', type: 'uint256' },
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'ref', type: 'bytes32' },
    ],
    outputs: [{ name: 'batchId', type: 'uint256' }],
  },
  {
    type: 'function', name: 'payoutSplit', stateMutability: 'payable',
    inputs: [
      { name: 'platformId', type: 'uint256' },
      { name: 'recipients', type: 'address[]' },
      { name: 'shares', type: 'uint256[]' },
      { name: 'total', type: 'uint256' },
      { name: 'ref', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function', name: 'withdraw', stateMutability: 'nonpayable',
    inputs: [], outputs: [],
  },
  {
    type: 'function', name: 'claimFees', stateMutability: 'nonpayable',
    inputs: [], outputs: [],
  },
  {
    type: 'function', name: 'setFee', stateMutability: 'nonpayable',
    inputs: [{ name: 'newFeeBps', type: 'uint16' }],
    outputs: [],
  },
  {
    type: 'function', name: 'setTreasury', stateMutability: 'nonpayable',
    inputs: [{ name: 'newTreasury', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'transferPlatformOwner', stateMutability: 'nonpayable',
    inputs: [{ name: 'platformId', type: 'uint256' }, { name: 'newOwner', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'acceptPlatformOwnership', stateMutability: 'nonpayable',
    inputs: [{ name: 'platformId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'transferProtocolOwner', stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function', name: 'acceptProtocolOwnership', stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  // ── Errors ─────────────────────────────────────────────────────────────────
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
  { type: 'error', name: 'InvalidFeeBps', inputs: [] },
  { type: 'error', name: 'PlatformNotFound', inputs: [] },
  { type: 'error', name: 'InsufficientPool', inputs: [] },
  { type: 'error', name: 'EmptyBatch', inputs: [] },
  { type: 'error', name: 'TooManyRecipients', inputs: [] },
  { type: 'error', name: 'LengthMismatch', inputs: [] },
  { type: 'error', name: 'ZeroAmount', inputs: [] },
  { type: 'error', name: 'ZeroShare', inputs: [] },
  { type: 'error', name: 'DuplicateRef', inputs: [] },
  { type: 'error', name: 'NothingToClaim', inputs: [] },
  { type: 'error', name: 'TransferFailed', inputs: [] },
  { type: 'error', name: 'NoFeesAccrued', inputs: [] },
  { type: 'error', name: 'ZeroTotal', inputs: [] },
  { type: 'error', name: 'OverOperatorAllowance', inputs: [] },
  // ── Events ─────────────────────────────────────────────────────────────────
  {
    type: 'event', name: 'BatchPaid',
    inputs: [
      { name: 'batchId', type: 'uint256', indexed: true },
      { name: 'platformId', type: 'uint256', indexed: true },
      { name: 'operator', type: 'address', indexed: true },
      { name: 'recipients', type: 'address[]', indexed: false },
      { name: 'total', type: 'uint256', indexed: false },
      { name: 'fee', type: 'uint256', indexed: false },
      { name: 'ref', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PayoutSent',
    inputs: [
      { name: 'batchId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PayoutCredited',
    inputs: [
      { name: 'batchId', type: 'uint256', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PoolFunded',
    inputs: [
      { name: 'platformId', type: 'uint256', indexed: true },
      { name: 'funder', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event', name: 'PlatformCreated',
    inputs: [
      { name: 'platformId', type: 'uint256', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'name', type: 'string', indexed: false },
    ],
  },
] as const

// ── NkapPayouts bytecode for browser-side deployment ─────────────────────────
// Constructor: (address treasury_, uint16 feeBps_)
// This is a placeholder — the user deploys via the Admin panel which loads from
// the compiled artifact. We declare the constructor ABI here for encoding only.
export const NKAP_CONSTRUCTOR_ABI = [
  {
    type: 'constructor',
    inputs: [
      { name: 'treasury_', type: 'address' },
      { name: 'feeBps_', type: 'uint16' },
    ],
    stateMutability: 'nonpayable',
  },
] as const

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Format a native-USDC wei amount (18 dec) to a readable string. */
export function fmtUsdc(wei: bigint, decimals = 6): string {
  // Native Arc: 18 dec. Display with up to `decimals` fractional digits.
  const divisor = 10n ** 18n
  const whole = wei / divisor
  const frac = wei % divisor
  const fracStr = frac.toString().padStart(18, '0').slice(0, decimals).replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : `${whole}`
}

/** Parse a decimal USDC string to native wei (18 dec). Returns 0n on bad input. */
export function parseNativeUsdc(val: string): bigint {
  if (!val || isNaN(Number(val))) return 0n
  const [intPart = '0', fracPart = ''] = val.split('.')
  const frac = (fracPart + '0'.repeat(18)).slice(0, 18)
  return BigInt(intPart) * 10n ** 18n + BigInt(frac)
}

/** Encode a string ≤32 bytes as a bytes32 (UTF-8, left-aligned, zero-padded). */
export function strToBytes32(s: string): `0x${string}` {
  const bytes = new TextEncoder().encode(s)
  if (bytes.length > 32) throw new Error('Reference too long (max 32 bytes)')
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `0x${hex.padEnd(64, '0')}`
}

/** Decode a bytes32 back to its readable string (strips trailing null bytes). */
export function bytes32ToStr(hex: string): string {
  const bytes = []
  for (let i = 2; i < hex.length; i += 2) {
    const b = parseInt(hex.slice(i, i + 2), 16)
    if (b === 0) break
    bytes.push(b)
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

export function fmtAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Parse CSV lines: "wallet,amount,label" or "wallet,share,label". */
export interface CsvRow {
  address: string
  value: string   // amount or share (string to preserve decimals)
  label: string
  error?: string
}

export function parseCsv(raw: string): CsvRow[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim())
      const address = parts[0] ?? ''
      const value = parts[1] ?? ''
      const label = parts[2] ?? ''
      let error: string | undefined
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) error = 'Invalid address'
      else if (isNaN(Number(value)) || Number(value) <= 0) error = 'Invalid amount'
      return { address, value, label, error }
    })
}

/** Minimum maxFeePerGas on Arc: 20 gwei */
export const MIN_MAX_FEE_PER_GAS = 20_000_000_000n // 20 gwei
