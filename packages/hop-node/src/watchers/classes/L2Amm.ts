import ContractBase from './ContractBase.js'
import { BigNumber } from 'ethers'
import { TokenIndex } from '#constants/index.js'
import type { TxOverrides } from '@hop-protocol/hop-node-core/types'

export default class L2Amm extends ContractBase {
  calculateToHTokensAmount = async (amountIn: BigNumber): Promise<BigNumber> => {
    const hTokenAmount = await this.contract.calculateSwap(
      TokenIndex.CanonicalToken,
      TokenIndex.HopBridgeToken,
      amountIn
    )
    return hTokenAmount
  }

  calculateFromHTokensAmount = async (amountIn: BigNumber): Promise<BigNumber> => {
    const amountOut = await this.contract.calculateSwap(
      TokenIndex.HopBridgeToken,
      TokenIndex.CanonicalToken,
      amountIn
    )
    return amountOut
  }

  swap = async (fromTokenIndex: number, toTokenIndex: number, amountIn: BigNumber, minAmountOut: BigNumber = BigNumber.from(0), deadline: BigNumber = this.defaultDeadline()): Promise<BigNumber> => {
    const txOverrides: TxOverrides = await this.txOverrides()
    return this.contract.swap(
      fromTokenIndex,
      toTokenIndex,
      amountIn,
      minAmountOut,
      deadline,
      txOverrides
    )
  }

  defaultDeadline () {
    return BigNumber.from(Math.floor((Date.now() / 1000) + 300))
  }
}
