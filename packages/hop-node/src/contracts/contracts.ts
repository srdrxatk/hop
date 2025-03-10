import { Chain, Network, Token } from '@hop-protocol/hop-node-core/constants'
import type { Signer, providers } from 'ethers'

import wallets from '@hop-protocol/hop-node-core/wallets'
import {
  ERC20__factory,
  L1_ERC20_Bridge_Legacy__factory,
  L1_ERC20_Bridge__factory,
  L2_AmmWrapper__factory,
  L2_Bridge__factory,
  MessengerWrapper__factory,
  SaddleLpToken__factory
} from '@hop-protocol/sdk/contracts'
import { config as globalConfig } from '#config/index.js'

const getL1BridgeContract = (token: string) => {
  if (token === Token.USDC && globalConfig.network === Network.Mainnet) {
    return L1_ERC20_Bridge_Legacy__factory.connect(
      (globalConfig.addresses as any)[token][Chain.Ethereum].l1Bridge,
      wallets.get(Chain.Ethereum)
    )
  }
  return L1_ERC20_Bridge__factory.connect(
    globalConfig.addresses[token][Chain.Ethereum].l1Bridge,
    wallets.get(Chain.Ethereum)
  )
}

const getL1TokenContract = (token: string) => {
  return ERC20__factory.connect(
    globalConfig.addresses[token][Chain.Ethereum].l1CanonicalToken,
    wallets.get(Chain.Ethereum)
  )
}

const getL2TokenContract = (token: string, network: string, wallet: Signer | providers.Provider) => {
  return ERC20__factory.connect(
    globalConfig.addresses[token][network].l2CanonicalToken,
    wallet
  )
}

const getL2HopBridgeTokenContract = (
  token: string,
  network: string,
  wallet: Signer | providers.Provider
) => {
  return ERC20__factory.connect(
    globalConfig.addresses[token][network].l2HopBridgeToken,
    wallet
  )
}

const getL2BridgeContract = (token: string, network: string, wallet: Signer | providers.Provider) => {
  return L2_Bridge__factory.connect(
    globalConfig.addresses[token][network].l2Bridge,
    wallet
  )
}

const getL2AmmWrapperContract = (
  token: string,
  network: string,
  wallet: Signer | providers.Provider
) => {
  return L2_AmmWrapper__factory.connect(
    globalConfig.addresses[token][network].l2AmmWrapper,
    wallet
  )
}

const getL2SaddleSwapContract = (
  token: string,
  network: string,
  wallet: Signer | providers.Provider
) => {
  return SaddleLpToken__factory.connect(
    globalConfig.addresses[token][network].l2SaddleSwap,
    wallet
  )
}

const getL1MessengerWrapperContract = (
  token: string,
  network: string
) => {
  // Note: This only returns the base implementation, not the chain-specific implementation
  return MessengerWrapper__factory.connect(
    globalConfig.addresses[token][network].l1MessengerWrapper,
    wallets.get(Chain.Ethereum)
  )
}

const cache: Record<string, any> = {}

const constructContractsObject = (token: string) => {
  if (!globalConfig.addresses[token]) {
    return null
  }

  const cacheKey = `${token}`
  if (cache[cacheKey]) {
    return cache[cacheKey]
  }

  const contractObj = Object.keys(globalConfig.addresses[token]).reduce<any>((obj, network) => {
    const wallet = wallets.get(network)
    if (!wallet) {
      return obj
    }
    if (network === Chain.Ethereum) {
      obj[network] = {
        l1Bridge: getL1BridgeContract(token),
        l1CanonicalToken: getL1TokenContract(token)
      }
    } else {
      obj[network] = {
        l2Bridge: getL2BridgeContract(token, network, wallet),
        l2CanonicalToken: getL2TokenContract(token, network, wallet),
        l2HopBridgeToken: getL2HopBridgeTokenContract(token, network, wallet),
        ammWrapper: getL2AmmWrapperContract(token, network, wallet),
        saddleSwap: getL2SaddleSwapContract(token, network, wallet),
        l1MessengerWrapper: getL1MessengerWrapperContract(token, network)
      }
    }
    return obj
  }, {})

  cache[cacheKey] = contractObj
  return contractObj

}

export default {
  has (token: string, network: string) {
    const contracts = constructContractsObject(token)
    return !!contracts?.[network]
  },
  get (token: string, network: string) {
    const contracts = constructContractsObject(token)
    return contracts?.[network]
  }
}
