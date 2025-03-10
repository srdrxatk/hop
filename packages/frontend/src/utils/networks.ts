import Network from 'src/models/Network'
import find from 'lodash/find'
import { ChainId, ChainSlug, Slug, TChain } from '@hop-protocol/sdk'
import { JsonRpcProvider } from '@ethersproject/providers'
import { Signer, providers } from 'ethers'
import { WaitConfirmations, networks } from 'src/config'
import { allNetworks } from 'src/config/networks'
import { networks as coreNetworks } from '@hop-protocol/sdk/networks'
import { getNativeTokenSymbol } from './getNativeTokenSymbol'

export function findNetworkBySlug(slug: string, networks: Network[] = allNetworks) {
  return find(networks, ['slug', slug])
}

export function findNetwork(slugOrNetwork?: string | Network, networks: Network[] = allNetworks) {
  return find(networks, [
    'slug',
    slugOrNetwork instanceof Network ? slugOrNetwork.slug : slugOrNetwork,
  ])
}

function normalizeNetworkToSlug(network?: Network | ChainSlug | ChainId) {
  if (network instanceof Network) {
    return network.slug
  }
  if (typeof network === 'string' && network in Slug) {
    return network
  }
  if (typeof network === 'number') {
    return networkIdToSlug(network)
  }
}

export function isSameNetwork(
  network1?: Network | ChainSlug | ChainId,
  network2?: Network | ChainSlug | ChainId
) {
  const slug1 = normalizeNetworkToSlug(network1)
  const slug2 = normalizeNetworkToSlug(network2)
  return slug1 === slug2
}

export const networkSlugToId = (slug: string) => {
  return networks[slug]?.networkId
}

export const networkSlugToName = (slug: string) => {
  const n = findNetworkBySlug(slug)
  return n?.name
}

export const networkIdToSlug = (networkId: string | number | undefined): Slug | string => {
  if (networkId === undefined) {
    return ''
  }

  if (typeof networkId === 'number') {
    networkId = networkId.toString()
  }

  for (const _network in coreNetworks) {
    const chains = (coreNetworks as any)[_network]
    for (const chainSlug in chains) {
      const chainObj = chains[chainSlug]
      if (chainObj.networkId.toString() === networkId) {
        return chainSlug as Slug
      }
    }
  }

  return ''
}

export const networkIdToName = (networkId: string | number) => {
  const name = networkSlugToName(networkIdToSlug(networkId))
  return name
}

export const networkIdNativeTokenSymbol = (networkId: string | number) => {
  const slug = networkIdToSlug(networkId)
  return getNativeTokenSymbol(slug)
}

export function getNetworkWaitConfirmations(tChain: TChain): number {
  let waitConfirmations: number
  if (typeof tChain === 'string') {
    waitConfirmations = WaitConfirmations?.[tChain]
  } else {
    waitConfirmations = WaitConfirmations?.[tChain.slug]
  }

  if (!waitConfirmations) {
    throw new Error(`Wait confirmations not found for ${tChain}`)
  }
  return waitConfirmations
}

export function isLayer1(chain: Network | ChainSlug | undefined) {
  if (chain instanceof Network) {
    return chain.isLayer1
  }
  if (typeof chain === 'string' && chain in Slug) {
    return chain === ChainSlug.Ethereum
  }
  return false
}

export function isL1ToL2(srcNetwork?: Network | ChainSlug, destNetwork?: Network | ChainSlug) {
  const srcCheck = isLayer1(srcNetwork)
  const destCheck = !isLayer1(destNetwork)

  return srcCheck && destCheck
}

export function isL2ToL1(srcNetwork?: Network | ChainSlug, destNetwork?: Network | ChainSlug) {
  const srcCheck = !isLayer1(srcNetwork)
  const destCheck = isLayer1(destNetwork)

  return srcCheck && destCheck
}

export function isL2ToL2(srcNetwork?: Network | ChainSlug, destNetwork?: Network | ChainSlug) {
  const srcCheck = !isLayer1(srcNetwork)
  const destCheck = !isLayer1(destNetwork)

  return srcCheck && destCheck
}

export function isProviderNetworkByChainId(chainId: ChainId, provider?: JsonRpcProvider) {
  if (!provider) return false

  if (chainId in ChainId) {
    return chainId === provider.network.chainId
  }
}

export function getNetworkProviderOrDefault(
  chainId: ChainId,
  defaultProvider: providers.Provider | Signer,
  provider?: JsonRpcProvider
) {
  if (isProviderNetworkByChainId(chainId, provider)) return provider!

  return defaultProvider
}
