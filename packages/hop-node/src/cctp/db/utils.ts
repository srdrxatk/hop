import os from 'node:os'
import path from 'node:path'
import { Chain, Network } from '@hop-protocol/hop-node-core/constants'
import { chainIdToSlug } from '@hop-protocol/hop-node-core/utils'
import { config as globalConfig } from '#config/index.js'
import { mkdirp } from 'mkdirp'

// Assume that a path is a location if it contains a slash
export function getDbPathForNameOrLocation (dbNameOrLocation: string): string {
  if (dbNameOrLocation.includes('/')) {
    return dbNameOrLocation
  }

  const basePath = globalConfig.db.path.replace('~', os.homedir() + '/')
  const pathWithName = basePath + '_' + dbNameOrLocation
  const pathname = path.resolve(pathWithName)
  mkdirp.sync(pathname.replace(path.basename(pathname), ''))
  return pathname
}


// TODO: Get these from more persistent config
export const DEFAULT_START_BLOCK_NUMBER: Record<string, Partial<Record<Chain, number>>> = {
  [Network.Mainnet]: {
    [Chain.Ethereum]: 19447854,
    [Chain.Optimism]: 117499078,
    [Chain.Arbitrum]: 190986712,
    [Chain.Base]: 11903793,
    [Chain.Polygon]: 54729294
  },
  [Network.Sepolia]: {
    [Chain.Ethereum]: 5498073,
    [Chain.Optimism]: 9397181,
    [Chain.Arbitrum]: 23788247,
    [Chain.Base]: 7414306
  }
}

export function getDefaultStartBlockNumber (chainId: number): number {
  const chainSlug = chainIdToSlug(chainId)
  return (DEFAULT_START_BLOCK_NUMBER as any)[globalConfig.network][chainSlug]!
}
