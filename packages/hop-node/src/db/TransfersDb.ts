import BaseDb, { KeyFilter } from './BaseDb'
import chainIdToSlug from 'src/utils/chainIdToSlug'
import getExponentialBackoffDelayMs from 'src/utils/getExponentialBackoffDelayMs'
import { BigNumber } from 'ethers'
import { Chain, FiveMinutesMs, OneHourMs, OneWeekMs, RelayableChains, TxError } from 'src/constants'
import { TxRetryDelayMs } from 'src/config'
import { normalizeDbItem } from './utils'

interface BaseTransfer {
  amount?: BigNumber
  amountOutMin?: BigNumber
  bonderFee?: BigNumber
  bondWithdrawalAttemptedAt?: number
  committed?: boolean
  deadline?: BigNumber
  destinationChainId?: number
  destinationChainSlug?: string
  isBondable?: boolean
  isFinalized?: boolean
  isRelayable?: boolean
  isRelayed?: boolean
  isNotFound?: boolean
  isTransferSpent?: boolean
  recipient?: string
  relayAttemptedAt?: number
  relayBackoffIndex?: number
  relayTxError?: TxError
  relayer?: string
  relayerFee?: BigNumber
  sourceChainId?: number
  sourceChainSlug?: string
  transferFromL1Complete?: boolean
  transferFromL1CompleteTxHash?: string
  transferNonce?: string
  transferRelayed?: boolean
  transferRootHash?: string
  transferRootId?: string
  transferSentBlockNumber?: number
  transferSentIndex?: number
  transferSentLogIndex?: number
  transferSentTimestamp?: number
  transferSentTxHash?: string
  transferSpentTxHash?: string
  withdrawalBondBackoffIndex?: number
  withdrawalBondSettled?: boolean
  withdrawalBondSettledTxHash?: string
  withdrawalBondTxError?: TxError
  withdrawalBonded?: boolean
  withdrawalBondedTxHash?: string
  withdrawalBonder?: string
  sender?: string
}

export interface Transfer extends BaseTransfer {
  transferId: string
}

interface UpdateTransfer extends BaseTransfer {
  transferId?: string
}

type TransfersDateFilter = {
  fromUnix?: number
  toUnix?: number
}

type GetItemsFilter = Partial<Transfer> & {
  destinationChainIds?: number[]
}

export type UnbondedSentTransfer = {
  transferId: string
  transferSentTimestamp: number
  withdrawalBonded: boolean
  transferSentTxHash: string
  isBondable: boolean
  isTransferSpent: boolean
  destinationChainId: number
  amount: BigNumber
  withdrawalBondTxError: TxError
  sourceChainId: number
  recipient: string
  amountOutMin: BigNumber
  bonderFee: BigNumber
  transferNonce: string
  deadline: BigNumber
  transferSentIndex: number
  transferSentBlockNumber: number
  isFinalized: boolean
}

export type UnrelayedSentTransfer = {
  transferId: string
  sourceChainId: number
  destinationChainId: number
  recipient: string
  amount: BigNumber
  relayer: string
  relayerFee: BigNumber
  transferSentTxHash: string
  transferSentTimestamp: number
  transferSentLogIndex: number
}

export type UncommittedTransfer = {
  transferId: string
  transferRootId: string
  transferSentTxHash: string
  committed: boolean
  destinationChainId: number
}

// structure:
// key: `transfer:<transferSentTimestamp>:<transferId>`
// value: `{ transferId: <transferId> }`
// note: the "transfer" prefix is not required but requires a migration to remove
class SubDbTimestamps extends BaseDb {
  constructor (prefix: string, _namespace?: string) {
    super(`${prefix}:timestampedKeys`, _namespace)
  }

  getTimestampedKey (transfer: Transfer) {
    if (transfer.transferSentTimestamp && transfer.transferId) {
      return `transfer:${transfer.transferSentTimestamp}:${transfer.transferId}`
    }
  }

  async upsertItem (transfer: Transfer) {
    const { transferId } = transfer
    const logger = this.logger.create({ id: transferId })
    const key = this.getTimestampedKey(transfer)
    if (!key) {
      return
    }
    const exists = await this.getById(key)
    if (!exists) {
      logger.debug(`storing db transfer timestamped key item. key: ${key}`)
      await this._update(key, { transferId })
      logger.debug(`updated db transfer timestamped key item. key: ${key}`)
    }
  }

  async getFilteredKeyValues (dateFilter?: TransfersDateFilter) {
    const filter: KeyFilter = {
      gte: 'transfer:',
      lte: 'transfer:~'
    }

    // return only transfer-id keys that are within specified range (filter by timestamped keys)
    if (dateFilter?.fromUnix || dateFilter?.toUnix) { // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
      if (dateFilter.fromUnix) {
        filter.gte = `transfer:${dateFilter.fromUnix}`
      }
      if (dateFilter.toUnix) {
        filter.lte = `transfer:${dateFilter.toUnix}~` // tilde is intentional
      }
    }

    return this.getKeyValues(filter)
  }
}

// structure:
// key: `<transferId>`
// value: `{ transferId: <transferId> }`
class SubDbIncompletes extends BaseDb {
  constructor (prefix: string, _namespace?: string) {
    super(`${prefix}:incompleteItems`, _namespace)
  }

  async upsertItem (transfer: Transfer) {
    const { transferId } = transfer
    const logger = this.logger.create({ id: transferId })
    const isIncomplete = this.isItemIncomplete(transfer)
    const exists = await this.getById(transferId)
    const shouldUpsert = isIncomplete && !exists
    const shouldDelete = !isIncomplete && exists
    if (shouldUpsert) {
      logger.debug('updating db transfer incomplete key item')
      await this._update(transferId, { transferId })
      logger.debug('updated db transfer incomplete key item')
    } else if (shouldDelete) {
      logger.debug('deleting db transfer incomplete key item')
      await this.deleteById(transferId)
      logger.debug('deleted db transfer incomplete key item')
    }
  }

  isItemIncomplete (item: Transfer) {
    if (!item?.transferId) {
      return false
    }

    if (item.isNotFound) {
      return false
    }

    return (
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
      !item.sourceChainId ||
      !item.destinationChainId ||
      !item.transferSentBlockNumber ||
      (item.transferSentBlockNumber && !item.transferSentTimestamp) ||
      (item.withdrawalBondedTxHash && !item.withdrawalBonder) ||
      (item.withdrawalBondSettledTxHash && !item.withdrawalBondSettled) ||
      (!item.sender)
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    )
  }
}

// structure:
// key: `<transferRootHash>:<transferId>`
// value: `{ transferId: <transferId> }`
class SubDbRootHashes extends BaseDb {
  constructor (prefix: string, _namespace?: string) {
    super(`${prefix}:transferRootHashes`, _namespace)
  }

  getTransferRootHashKey (transfer: Transfer) {
    if (transfer.transferRootHash && transfer.transferId) {
      return `${transfer.transferRootHash}:${transfer.transferId}`
    }
  }

  async insertItem (transfer: Transfer) {
    const { transferId } = transfer
    const logger = this.logger.create({ id: transferId })
    const key = this.getTransferRootHashKey(transfer)
    if (key) {
      const exists = await this.getById(key)
      if (!exists) {
        logger.debug(`storing db transfer rootHash key item. key: ${key}`)
        await this._update(key, { transferId })
        logger.debug(`updated db transfer rootHash key item. key: ${key}`)
      }
    }
  }

  async getFilteredKeyValues (transferRootHash: string) {
    if (!transferRootHash) {
      throw new Error('expected transfer root hash')
    }

    const filter: KeyFilter = {
      gte: `${transferRootHash}`,
      lte: `${transferRootHash}~` // tilde is intentional
    }

    return this.getKeyValues(filter)
  }
}

// structure:
// key: `<transferId>`
// value: `{ ...Transfer }`
class TransfersDb extends BaseDb {
  subDbTimestamps: SubDbTimestamps
  subDbIncompletes: SubDbIncompletes
  subDbRootHashes: SubDbRootHashes

  constructor (prefix: string, _namespace?: string) {
    super(prefix, _namespace)
    this.subDbTimestamps = new SubDbTimestamps(prefix, _namespace)
    this.subDbIncompletes = new SubDbIncompletes(prefix, _namespace)
    this.subDbRootHashes = new SubDbRootHashes(prefix, _namespace)
  }

  shouldMigrate (): boolean {
    return true
  }

  async migration (key: string, value: any): Promise<void> {
    if (value?.isFinalized === undefined) {
      const { value: updatedValue } = await this._getUpdateData(key, value)
      updatedValue.isFinalized = true
      return this.db.put(key, updatedValue)
    }
  }

  private isRouteOk (filter: GetItemsFilter = {}, item: Transfer) {
    if (filter.sourceChainId) {
      if (!item.sourceChainId || filter.sourceChainId !== item.sourceChainId) {
        return false
      }
    }

    if (filter.destinationChainIds) {
      if (!item.destinationChainId || !filter.destinationChainIds.includes(item.destinationChainId)) {
        return false
      }
    }

    return true
  }

  private normalizeItem (item: Transfer) {
    try {
      if (!item) {
        return null
      }

      if (item.destinationChainId) {
        item.destinationChainSlug = chainIdToSlug(item.destinationChainId)
      }
      if (item.sourceChainId) {
        item.sourceChainSlug = chainIdToSlug(item.sourceChainId)
      }
      if (item.deadline !== undefined) {
        // convert number to BigNumber for backward compatibility reasons
        if (typeof item.deadline === 'number') {
          item.deadline = BigNumber.from((item.deadline as number).toString())
        }
      }
      return normalizeDbItem(item)
    } catch (err: any) {
      const logger = this.logger.create({ id: item?.transferId })

      logger.error('normalizeItem error:', err)
      return null
    }
  }

  private readonly filterValueTransferId = (x: any) => {
    return x?.value?.transferId
  }

  private async upsertTransferItem (transfer: Transfer) {
    const { transferId } = transfer
    const logger = this.logger.create({ id: transferId })
    await this._update(transferId, transfer)
    const entry = await this.getById(transferId)
    logger.debug(`updated db transfer item. ${JSON.stringify(entry)}`)
    await this.subDbIncompletes.upsertItem(entry)
  }

  // sort explainer: https://stackoverflow.com/a/9175783/1439168
  private readonly sortItems = (a: any, b: any) => {
    /* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
    if (a.transferSentBlockNumber! > b.transferSentBlockNumber!) return 1
    if (a.transferSentBlockNumber! < b.transferSentBlockNumber!) return -1
    if (a.transferSentIndex! > b.transferSentIndex!) return 1
    if (a.transferSentIndex! < b.transferSentIndex!) return -1
    /* eslint-enable @typescript-eslint/no-unnecessary-type-assertion */
    return 0
  }

  async update (transferId: string, transfer: UpdateTransfer) {
    const logger = this.logger.create({ id: transferId })
    logger.debug('update called')
    transfer.transferId = transferId
    await Promise.all([
      this.subDbTimestamps.upsertItem(transfer as Transfer),
      this.subDbRootHashes.insertItem(transfer as Transfer),
      this.upsertTransferItem(transfer as Transfer)
    ])
  }

  async getByTransferId (transferId: string): Promise<Transfer> {
    const item: Transfer = await this.getById(transferId)
    return this.normalizeItem(item)
  }

  async getTransferIds (dateFilter?: TransfersDateFilter): Promise<string[]> {
    const kv = await this.subDbTimestamps.getFilteredKeyValues(dateFilter)
    return kv.map(this.filterValueTransferId).filter(this.filterExisty)
  }

  async getItems (dateFilter?: TransfersDateFilter): Promise<Transfer[]> {
    const transferIds = await this.getTransferIds(dateFilter)
    return this.getMultipleTransfersByTransferIds(transferIds)
  }

  async getMultipleTransfersByTransferIds (transferIds: string[]) {
    const batchedItems = await this.batchGetByIds(transferIds)
    const transfers = batchedItems.map((item: Transfer) => this.normalizeItem(item))
    const items = transfers.filter(Boolean).sort(this.sortItems)
    this.logger.info(`items length: ${items.length}`)

    return items
  }

  async getTransfers (dateFilter?: TransfersDateFilter): Promise<Transfer[]> {
    await this.tilReady()
    return await this.getItems(dateFilter)
  }

  // gets only transfers within range: now - 1 week ago
  async getTransfersFromWeek () {
    await this.tilReady()
    const fromUnix = Math.floor((Date.now() - OneWeekMs) / 1000)
    return await this.getTransfers({
      fromUnix
    })
  }

  async getTransfersWithTransferRootHash (transferRootHash: string) {
    await this.tilReady()
    const kv = await this.subDbRootHashes.getFilteredKeyValues(transferRootHash)
    const unsortedTransferIds = kv.map(this.filterValueTransferId).filter(this.filterExisty)
    const items = await this.batchGetByIds(unsortedTransferIds)
    const sortedTransfers = items.sort(this.sortItems).filter(this.filterExisty)
    return sortedTransfers
  }

  async getUncommittedTransfers (
    filter: GetItemsFilter = {}
  ): Promise<UncommittedTransfer[]> {
    const transfers: Transfer[] = await this.getTransfersFromWeek()
    const filtered = transfers.filter(item => {
      if (!this.isRouteOk(filter, item)) {
        return false
      }

      return (
        item.transferId &&
        !item.transferRootId &&
        item.transferSentTxHash &&
        !item.committed &&
        item.isFinalized
      )
    })

    return filtered as UncommittedTransfer[]
  }

  async getUnbondedSentTransfers (
    filter: GetItemsFilter = {}
  ): Promise<UnbondedSentTransfer[]> {
    const transfers: Transfer[] = await this.getTransfersFromWeek()
    const filtered = transfers.filter(item => {
      if (!item?.transferId) {
        return false
      }

      if (!this.isRouteOk(filter, item)) {
        return false
      }

      if (item.isNotFound) {
        return false
      }

      let timestampOk = true
      if (item.bondWithdrawalAttemptedAt) {
        if (
          item.withdrawalBondTxError === TxError.BonderFeeTooLow ||
          item.withdrawalBondTxError === TxError.RedundantRpcOutOfSync ||
          item.withdrawalBondTxError === TxError.RpcServerError
        ) {
          const delayMs = getExponentialBackoffDelayMs(item.withdrawalBondBackoffIndex!)
          if (delayMs > OneWeekMs) {
            return false
          }
          timestampOk = item.bondWithdrawalAttemptedAt + delayMs < Date.now()
        } else {
          timestampOk = item.bondWithdrawalAttemptedAt + TxRetryDelayMs < Date.now()
        }
      }

      return (
        item.transferId &&
        item.transferSentTimestamp &&
        !item.withdrawalBonded &&
        item.transferSentTxHash &&
        item.isBondable &&
        item.transferSentBlockNumber &&
        !item.isTransferSpent &&
        timestampOk
      )
    })

    return filtered as UnbondedSentTransfer[]
  }

  async getUnrelayedSentTransfers (
    filter: GetItemsFilter = {}
  ): Promise<UnrelayedSentTransfer[]> {
    const transfers: Transfer[] = await this.getTransfersFromWeek()
    const filtered = transfers.filter(item => {
      if (!item?.transferId) {
        return false
      }

      if (!this.isRouteOk(filter, item)) {
        return false
      }

      if (item.isNotFound) {
        return false
      }

      if (!item?.sourceChainId) {
        return false
      }

      const sourceChainSlug = chainIdToSlug(item.sourceChainId)
      if (sourceChainSlug !== Chain.Ethereum) {
        return false
      }

      if (!item?.destinationChainId) {
        return false
      }

      const destinationChainSlug = chainIdToSlug(item.destinationChainId)
      if (!RelayableChains.includes(destinationChainSlug)) {
        return false
      }

      if (!item.transferSentTimestamp) {
        return false
      }

      // TODO: This is temp. Rm.
      const lineaRelayTime = 5 * FiveMinutesMs
      if (item.destinationChainSlug === Chain.Linea) {
        if ((item.transferSentTimestamp * 1000) + lineaRelayTime > Date.now()) {
          return false
        }
      }

      let timestampOk = true
      if (item.relayAttemptedAt) {
        if (
          item.relayTxError === TxError.RelayerFeeTooLow ||
          item.withdrawalBondTxError === TxError.RpcServerError ||
          item.withdrawalBondTxError === TxError.UnfinalizedTransferBondError
        ) {
          const delayMs = getExponentialBackoffDelayMs(item.relayBackoffIndex!)
          if (delayMs > OneWeekMs) {
            return false
          }
          timestampOk = item.relayAttemptedAt + delayMs < Date.now()
        } else {
          timestampOk = item.relayAttemptedAt + TxRetryDelayMs < Date.now()
        }
      }

      return (
        item.transferId &&
        item.transferSentTimestamp &&
        !item.transferRelayed &&
        item.transferSentTxHash &&
        item.isRelayable &&
        !item.isRelayed &&
        !item.transferFromL1Complete &&
        item.transferSentLogIndex &&
        timestampOk
      )
    })

    return filtered as UnrelayedSentTransfer[]
  }

  async getIncompleteItems (
    filter: GetItemsFilter = {}
  ) {
    const kv = await this.subDbIncompletes.getKeyValues()
    const transferIds = kv.map(this.filterValueTransferId).filter(this.filterExisty)
    if (!transferIds.length) {
      return []
    }
    const batchedItems = await this.batchGetByIds(transferIds)
    const transfers = batchedItems.map((item: Transfer) => this.normalizeItem(item))

    return transfers.filter((item: any) => {
      if (!item) {
        return false
      }

      if (filter.sourceChainId && item.sourceChainId) {
        if (filter.sourceChainId !== item.sourceChainId) {
          return false
        }
      }

      if (item.isNotFound) {
        return false
      }

      return this.subDbIncompletes.isItemIncomplete(item)
    })
  }

  async getWithdrawalBondBackoffIndexForTransferId (transferId: string) {
    let { withdrawalBondBackoffIndex } = await this.getByTransferId(transferId)
    if (!withdrawalBondBackoffIndex) {
      withdrawalBondBackoffIndex = 0
    }

    return withdrawalBondBackoffIndex
  }

  async getRelayBackoffIndexForTransferId (transferId: string) {
    let { relayBackoffIndex } = await this.getByTransferId(transferId)
    if (!relayBackoffIndex) {
      relayBackoffIndex = 0
    }

    return relayBackoffIndex
  }

  async getInFlightTransfers (): Promise<Transfer[]> {
    await this.tilReady()

    // Unbonded should not be in flight for more than 1 hour
    const fromUnix = Math.floor((Date.now() - OneHourMs) / 1000)
    const transfersFromHour: Transfer[] = await this.getTransfers({
      fromUnix
    })

    return transfersFromHour.filter((transfer: Transfer) => {
      if (!transfer?.sourceChainId || !transfer?.transferId || !transfer?.isBondable) {
        return false
      }

      // L1 to L2 transfers are not bonded by the bonder so they are not considered in flight.
      // Checking bonderFeeTooLow could be a false positive since the bonder bonds relative to the current gas price.
      const sourceChainSlug = chainIdToSlug(transfer.sourceChainId)
      return (
        sourceChainSlug !== Chain.Ethereum &&
        transfer.transferId &&
        transfer.isBondable &&
        !transfer?.withdrawalBonded &&
        !transfer?.isTransferSpent
      )
    })
  }
}

export default TransfersDb
