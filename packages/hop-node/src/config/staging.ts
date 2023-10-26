import { BonderConfig } from 'src/config/types'
import { mainnet as _networks } from '@hop-protocol/core/networks'
import { staging as config } from '@hop-protocol/core/config'
import { mainnet as metadata } from '@hop-protocol/core/metadata'
import { staging as stagingAddresses } from '@hop-protocol/core/addresses'

const addresses = stagingAddresses.bridges
const bonders = stagingAddresses.bonders
const canonicalAddresses = stagingAddresses.canonicalAddresses
const bonderConfig: BonderConfig = {}
const networks: any = {}

for (const chain in _networks) {
  const network = (_networks as any)[chain]
  if (!networks[chain]) {
    networks[chain] = {}
  }
  networks[chain].name = network?.name
  networks[chain].chainId = network?.networkId
  networks[chain].rpcUrl = network?.publicRpcUrl
  networks[chain].waitConfirmations = network?.waitConfirmations
  networks[chain].finalizationBlockTag = network?.finalizationBlockTag
  networks[chain].subgraphUrl = network?.subgraphUrl

  bonderConfig.totalStake = config.bonderTotalStake
}

export { addresses, bonders, canonicalAddresses, bonderConfig, networks, metadata }
