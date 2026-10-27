/**
 * wagmi configuration — Arc Testnet + Arc Mainnet
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { MIN_MAX_FEE_PER_GAS } from './lib/nkap'

// Arc Mainnet (chain ID 5042) — defined inline since viem may not export it yet
export const arcMainnet = {
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
    public:  { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'ArcScan', url: 'https://explorer.arc.io' },
  },
} as const

// Pre-register RPC URLs for trace events
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(arcMainnet.id, arcMainnet.rpcUrls.default.http[0])

// Ensure maxFeePerGas ≥ 20 gwei on Arc chains
function arcTransport(rpcUrl: string) {
  return http(rpcUrl, {
    fetchOptions: {},
    // Intercepted at transaction level in useNkapWrite
  })
}

export const config = createConfig({
  chains: [arcMainnet, arcTestnet, mainnet],
  connectors: [injected()],
  transports: {
    [arcTestnet.id]: arcTransport(arcTestnet.rpcUrls.default.http[0]),
    [arcMainnet.id]: arcTransport(arcMainnet.rpcUrls.default.http[0]),
    [mainnet.id]: http(),
  },
})

export const ARC_CHAINS = [
  { id: arcMainnet.id, name: 'Arc',          isTestnet: false, explorer: 'https://explorer.arc.io' },
  { id: arcTestnet.id, name: 'Arc Testnet',  isTestnet: true,  explorer: 'https://explorer.testnet.arc.io' },
] as const

export type ArcChainId = typeof ARC_CHAINS[number]['id']

export function getArcChain(chainId: number | undefined) {
  return ARC_CHAINS.find((c) => c.id === chainId)
}

export { MIN_MAX_FEE_PER_GAS }

// ── Read-only network (no wallet) ────────────────────────────────────────────
// Visitors without a wallet read Arc Mainnet by default. `?network=testnet`
// switches the read-only view to Arc Testnet. A connected wallet on an Arc
// chain always wins.

export const TESTNET_DEMO_CONTRACT = '0x2a9515d90182e7a49edcbcd19e49eb8bfecc3f2f'

export function getUrlNetworkChainId(): number {
  if (typeof window === 'undefined') return arcMainnet.id
  const n = new URLSearchParams(window.location.search).get('network')?.toLowerCase()
  return n === 'testnet' || n === 'arc-testnet' || n === String(arcTestnet.id)
    ? arcTestnet.id
    : arcMainnet.id
}

/** Default contract for the read-only network when none is given in the URL. */
export function getDefaultContract(chainId: number): string {
  if (chainId === arcTestnet.id) {
    return (import.meta.env.VITE_NKAP_TESTNET_ADDRESS as string | undefined) || TESTNET_DEMO_CONTRACT
  }
  return (import.meta.env.VITE_NKAP_ADDRESS as string | undefined) ?? ''
}

/** Chain used for reads: the wallet's Arc chain if connected, else the URL network. */
export function resolveReadChainId(walletChainId: number | undefined, isConnected: boolean): number {
  if (isConnected && getArcChain(walletChainId)) return walletChainId as number
  return getUrlNetworkChainId()
}

/** Switch the read-only network without a wallet (updates the URL and reloads). */
export function setUrlNetwork(chainId: number) {
  const url = new URL(window.location.href)
  if (chainId === arcTestnet.id) url.searchParams.set('network', 'testnet')
  else url.searchParams.delete('network')
  url.searchParams.delete('contract')
  window.location.href = url.toString()
}
