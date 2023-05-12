import '../moduleAlias'
import BaseWatcher from './classes/BaseWatcher'
import L1Bridge from './classes/L1Bridge'
import MerkleTree from 'src/utils/MerkleTree'
import chainSlugToId from 'src/utils/chainSlugToId'
import contracts from 'src/contracts'
import getRedundantRpcUrls from 'src/utils/getRedundantRpcUrls'
import getRpcProviderFromUrl from 'src/utils/getRpcProviderFromUrl'
import getTransferRootId from 'src/utils/getTransferRootId'
import { BigNumber, providers } from 'ethers'
import { BondTransferRootDelayBufferSeconds, Chain } from 'src/constants'
import { L1_Bridge as L1BridgeContract } from '@hop-protocol/core/contracts/generated/L1_Bridge'
import { L2_Bridge as L2BridgeContract } from '@hop-protocol/core/contracts/generated/L2_Bridge'
import { PreTransactionValidationError } from 'src/types/error'
import { TransferRoot } from 'src/db/TransferRootsDb'
import { enableEmergencyMode, getFinalityTimeSeconds, config as globalConfig } from 'src/config'

type Config = {
  chainSlug: string
  tokenSymbol: string
  bridgeContract: L1BridgeContract | L2BridgeContract
  dryMode?: boolean
}

export type SendBondTransferRootTxParams = {
  transferRootId: string
  transferRootHash: string
  destinationChainId: number
  totalAmount: BigNumber
  transferIds: string[]
  rootCommittedAt: number
}

class BondTransferRootWatcher extends BaseWatcher {
  siblingWatchers: { [chainId: string]: BondTransferRootWatcher }

  constructor (config: Config) {
    super({
      chainSlug: config.chainSlug,
      tokenSymbol: config.tokenSymbol,
      logColor: 'cyan',
      bridgeContract: config.bridgeContract,
      dryMode: config.dryMode
    })
  }

  async pollHandler () {
    await this.checkTransfersCommittedFromDb()
  }

  async checkTransfersCommittedFromDb () {
    const dbTransferRoots = await this.db.transferRoots.getUnbondedTransferRoots(await this.getFilterRoute())
    if (!dbTransferRoots.length) {
      this.logger.debug('no unbonded transfer root db items to check')
      return
    }

    this.logger.info(
        `checking ${dbTransferRoots.length} unbonded transfer roots db items`
    )

    const promises: Array<Promise<any>> = []
    for (const dbTransferRoot of dbTransferRoots) {
      const {
        transferRootId,
        transferRootHash,
        totalAmount,
        destinationChainId,
        committedAt,
        sourceChainId,
        transferIds
      } = dbTransferRoot
      const logger = this.logger.create({ root: transferRootId })

      const bondChainId = chainSlugToId(Chain.Ethereum)
      const availableCredit = this.getAvailableCreditForBond(bondChainId)
      const notEnoughCredit = availableCredit.lt(totalAmount)
      if (notEnoughCredit) {
        logger.debug(
        `not enough credit to bond transferRoot. Have ${this.bridge.formatUnits(
          availableCredit
        )}, need ${this.bridge.formatUnits(totalAmount)}`)
        continue
      }

      promises.push(this.checkTransfersCommitted(
        transferRootId,
        transferRootHash,
        totalAmount,
        destinationChainId,
        committedAt,
        sourceChainId,
        transferIds
      ))
    }

    await Promise.all(promises)
  }

  async checkTransfersCommitted (
    transferRootId: string,
    transferRootHash: string,
    totalAmount: BigNumber,
    destinationChainId: number,
    committedAt: number,
    sourceChainId: number,
    transferIds: string[]
  ) {
    const logger = this.logger.create({ root: transferRootId })
    const l1Bridge = this.getSiblingWatcherByChainSlug(Chain.Ethereum).bridge as L1Bridge

    // Use the greater of the min delay or the chain finality time and add a buffer for additional reorg safety
    const minTransferRootBondDelaySeconds = await l1Bridge.getMinTransferRootBondDelaySeconds()
    const chainFinalityTimeSec = getFinalityTimeSeconds(this.chainSlug)
    const delaySeconds = Math.max(minTransferRootBondDelaySeconds, chainFinalityTimeSec) + BondTransferRootDelayBufferSeconds
    const delayMs = delaySeconds * 1000
    const committedAtMs = committedAt * 1000
    const delta = Date.now() - committedAtMs - delayMs
    const shouldBond = delta > 0
    if (!shouldBond) {
      logger.debug(
        `too early to bond. Must wait ${Math.abs(
          delta
        )} milliseconds`
      )
      return
    }

    const isBonded = await l1Bridge.isTransferRootIdBonded(transferRootId)
    if (isBonded) {
      logger.warn('checkTransfersCommitted already bonded. marking item not found.')
      await this.db.transferRoots.update(transferRootId, { isNotFound: true })
      return
    }

    logger.info(`source: ${sourceChainId} transferRootId: ${transferRootId} transferRootHash: ${transferRootHash}`)
    logger.debug('committedAt:', committedAt)
    logger.debug('destinationChainId:', destinationChainId)
    logger.debug('sourceChainId:', sourceChainId)
    logger.debug('transferRootId:', transferRootId)
    logger.debug('transferRootHash:', transferRootHash)
    logger.debug('totalAmount:', this.bridge.formatUnits(totalAmount))
    logger.debug('transferRootId:', transferRootId)

    const pendingTransfers: string[] = transferIds ?? []
    logger.debug('transferRootHash transferIds:', pendingTransfers)
    if (pendingTransfers.length > 0) {
      const tree = new MerkleTree(pendingTransfers)
      const rootHash = tree.getHexRoot()
      logger.debug('calculated transfer root hash:', rootHash)
      if (rootHash !== transferRootHash) {
        logger.error('calculated transfer root hash does not match')
        return
      }
    }

    const bondChainId = chainSlugToId(Chain.Ethereum)
    const bondAmount = await l1Bridge.getBondForTransferAmount(totalAmount)
    const availableCredit = this.getAvailableCreditForBond(bondChainId)
    const notEnoughCredit = availableCredit.lt(bondAmount)
    if (notEnoughCredit) {
      const msg = `not enough credit to bond transferRoot. Have ${this.bridge.formatUnits(
          availableCredit
        )}, need ${this.bridge.formatUnits(bondAmount)}`
      logger.error(msg)
      this.notifier.error(msg)
      return
    }

    if (this.dryMode || globalConfig.emergencyDryMode) {
      logger.warn(`dry: ${this.dryMode}, emergencyDryMode: ${globalConfig.emergencyDryMode}, skipping bondTransferRoot`)
      return
    }

    await this.withdrawFromVaultIfNeeded(destinationChainId, bondAmount)

    logger.debug(
      `attempting to bond transfer root id ${transferRootId} with destination chain ${destinationChainId}`
    )

    await this.db.transferRoots.update(transferRootId, {
      sentBondTxAt: Date.now()
    })

    try {
      const tx = await this.sendBondTransferRoot(
        transferRootId,
        transferRootHash,
        destinationChainId,
        totalAmount,
        transferIds,
        committedAt
      )

      const msg = `L1 bondTransferRoot dest ${destinationChainId}, tx ${tx.hash} transferRootHash: ${transferRootHash}`
      logger.info(msg)
      this.notifier.info(msg)
    } catch (err) {
      logger.error('sendBondTransferRoot error:', err.message)
      if (err instanceof PreTransactionValidationError) {
        logger.error('pre transaction validation error. turning off writes.')
        enableEmergencyMode()
      }
      throw err
    }
  }

  async sendBondTransferRoot (
    transferRootId: string,
    transferRootHash: string,
    destinationChainId: number,
    totalAmount: BigNumber,
    transferIds: string[],
    rootCommittedAt: number
  ): Promise<providers.TransactionResponse> {
    await this.preTransactionValidation({
      transferRootId,
      transferRootHash,
      destinationChainId,
      totalAmount,
      transferIds,
      rootCommittedAt
    })

    const l1Bridge = this.getSiblingWatcherByChainSlug(Chain.Ethereum).bridge as L1Bridge
    return l1Bridge.bondTransferRoot(
      transferRootHash,
      destinationChainId,
      totalAmount
    )
  }

  getAvailableCreditForBond (destinationChainId: number) {
    const baseAvailableCredit = this.availableLiquidityWatcher.getBaseAvailableCreditIncludingVault(destinationChainId)
    return baseAvailableCredit
  }

  async withdrawFromVaultIfNeeded (destinationChainId: number, bondAmount: BigNumber) {
    if (!globalConfig.vault[this.tokenSymbol]?.[this.chainIdToSlug(destinationChainId)]?.autoWithdraw) {
      return
    }

    return await this.mutex.runExclusive(async () => {
      const availableCredit = this.getAvailableCreditForBond(destinationChainId)
      const vaultBalance = this.availableLiquidityWatcher.getVaultBalance(destinationChainId)
      const shouldWithdraw = (availableCredit.sub(vaultBalance)).lt(bondAmount)
      this.logger.debug(`availableCredit: ${this.bridge.formatUnits(availableCredit)}, vaultBalance: ${this.bridge.formatUnits(vaultBalance)}, bondAmount: ${this.bridge.formatUnits(bondAmount)}, shouldWithdraw: ${shouldWithdraw}`)
      if (shouldWithdraw) {
        try {
          const msg = `attempting withdrawFromVaultAndStake. amount: ${this.bridge.formatUnits(vaultBalance)}`
          this.notifier.info(msg)
          this.logger.info(msg)
          const destinationWatcher = this.getSiblingWatcherByChainId(destinationChainId)
          await destinationWatcher.withdrawFromVaultAndStake(vaultBalance)
        } catch (err) {
          const errMsg = `withdrawFromVaultAndStake error: ${err.message}`
          this.notifier.error(errMsg)
          this.logger.error(errMsg)
          throw err
        }
      }
    })
  }

  async preTransactionValidation (txParams: SendBondTransferRootTxParams): Promise<void> {
    // Perform this check as late as possible before the transaction is sent
    await this.validateDbExistence(txParams)
    await this.validateDestinationChainId(txParams)
    await this.validateUniqueness(txParams)
    await this.validateLogsWithRedundantRpcs(txParams)
  }

  async validateDbExistence (txParams: SendBondTransferRootTxParams): Promise<void> {
    // Validate DB existence with calculated transferRootId
    const calculatedDbTransferRoot = await this.getCalculatedDbTransferRoot(txParams)
    if (!calculatedDbTransferRoot?.transferRootId || !txParams?.transferRootId) {
      throw new PreTransactionValidationError(`Calculated transferRootId (${calculatedDbTransferRoot?.transferRootId}) or transferIds (${txParams?.transferRootId}) is missing`)
    }
    if (calculatedDbTransferRoot.transferRootId !== txParams.transferRootId) {
      throw new PreTransactionValidationError(`Calculated calculatedTransferRootId (${calculatedDbTransferRoot.transferRootId}) does not match transferRootId in db`)
    }
  }

  async validateDestinationChainId (txParams: SendBondTransferRootTxParams): Promise<void> {
    // Validate that the destination chain id matches the db entry
    const calculatedDbTransferRoot = await this.getCalculatedDbTransferRoot(txParams)
    if (!calculatedDbTransferRoot?.destinationChainId || !txParams?.destinationChainId) {
      throw new PreTransactionValidationError(`Calculated destinationChainId (${calculatedDbTransferRoot?.destinationChainId}) or transferIds (${txParams?.destinationChainId}) is missing`)
    }
    if (calculatedDbTransferRoot.destinationChainId !== txParams.destinationChainId) {
      throw new PreTransactionValidationError(`Calculated destinationChainId (${txParams.destinationChainId}) does not match destinationChainId in db (${calculatedDbTransferRoot.destinationChainId})`)
    }
  }

  async validateUniqueness (txParams: SendBondTransferRootTxParams): Promise<void> {
    // Validate uniqueness for redundant reorg protection. A transferId should only exist in one transferRoot per source chain
    const transferIds = txParams.transferIds.map((x: string) => x.toLowerCase())

    // Only use roots that are not the current root, from the source chain, and have associated transferIds
    const dbTransferRoots: TransferRoot[] = (await this.db.transferRoots.getTransferRootsFromTwoWeeks())
      .filter(dbTransferRoot => dbTransferRoot.transferRootId !== txParams.transferRootId)
      .filter(dbTransferRoot => dbTransferRoot.sourceChainId === this.bridge.chainId)
      .filter(dbTransferRoot => dbTransferRoot?.transferIds?.length)
    const dbTransferIds: string[] = dbTransferRoots.flatMap(dbTransferRoot => dbTransferRoot.transferIds!)

    for (const transferId of transferIds) {
      const transferIdCount: string[] = dbTransferIds.filter((dbTransferId: string) => dbTransferId.toLowerCase() === transferId)
      if (transferIdCount.length > 0) {
        const duplicateRoot = dbTransferRoots.find(dbTransferRoot => dbTransferRoot.transferIds?.includes(transferId))
        throw new PreTransactionValidationError(`transferId (${transferId}) exists in multiple transferRoots in db with the duplicateRootId: ${duplicateRoot?.transferRootId}`)
      }
    }
  }

  async validateLogsWithRedundantRpcs (txParams: SendBondTransferRootTxParams): Promise<void> {
    // Validate logs with redundant RPC endpoint, if it exists
    const calculatedDbTransferRoot = await this.getCalculatedDbTransferRoot(txParams)
    const blockNumber = calculatedDbTransferRoot?.commitTxBlockNumber
    if (!blockNumber) {
      throw new PreTransactionValidationError(`Calculated commitTxBlockNumber (${blockNumber}) is missing`)
    }

    const redundantRpcUrls = getRedundantRpcUrls(this.chainSlug) ?? []
    for (const redundantRpcUrl of redundantRpcUrls) {
      const redundantProvider = getRpcProviderFromUrl(redundantRpcUrl)

      const l2Bridge = contracts.get(this.tokenSymbol, this.chainSlug)?.l2Bridge
      const filter = l2Bridge.filters.TransfersCommitted(
        txParams.destinationChainId,
        txParams.transferRootHash
      )
      const events = await l2Bridge.connect(redundantProvider).queryFilter(filter, blockNumber, blockNumber)
      const eventParams = events.find((x: any) => x.args.rootHash === txParams.transferRootHash)
      if (!eventParams) {
        throw new PreTransactionValidationError(`TransfersCommitted event not found for transferRootHash ${txParams.transferRootHash} at block ${blockNumber}`)
      }

      if (
        (Number(eventParams.args.destinationChainId) !== txParams.destinationChainId) ||
        (eventParams.args.rootHash !== txParams.transferRootHash) ||
        (eventParams.args.totalAmount.toString() !== txParams.totalAmount.toString()) ||
        (eventParams.args.rootCommittedAt.toString() !== txParams.rootCommittedAt.toString())
      ) {
        throw new PreTransactionValidationError(`TransfersCommitted event does not match db. eventParams: ${JSON.stringify(eventParams)}, calculatedDbTransfer: ${JSON.stringify(calculatedDbTransferRoot)}`)
      }
    }
  }

  async getCalculatedDbTransferRoot (txParams: SendBondTransferRootTxParams): Promise<TransferRoot> {
    const { transferRootHash, totalAmount } = txParams
    const calculatedTransferRootId = getTransferRootId(transferRootHash, totalAmount)
    const dbTransferRoot = this.db.transferRoots.getByTransferRootId(calculatedTransferRootId)
    if (!dbTransferRoot) {
      throw new PreTransactionValidationError(`Calculated dbTransferRoot (${calculatedTransferRootId}) not found in db`)
    }
    return dbTransferRoot
  }
}

export default BondTransferRootWatcher
