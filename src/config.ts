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
