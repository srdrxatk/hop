import { BonderConfig } from 'src/config/types'
import { goerli as _networks } from '@hop-protocol/core/networks'
import { goerli as config } from '@hop-protocol/core/config'
import { goerli as goerliAddresses } from '@hop-protocol/core/addresses'
import { goerli as metadata } from '@hop-protocol/core/metadata'

const addresses = goerliAddresses.bridges
const bonders = goerliAddresses.bonders
const canonicalAddresses = goerliAddresses.canonicalAddresses
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
