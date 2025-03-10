import Network from 'src/models/Network'
import React, { FC, ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react'
import Token from 'src/models/Token'
import logger from 'src/logger'
import { BigNumber, utils } from 'ethers'
import { CanonicalToken, HToken } from '@hop-protocol/sdk'
import { findNetworkBySlug } from 'src/utils'
import { getTokenImage } from 'src/utils/tokens'
import { retryPromise } from 'src/utils/retryPromise'
import { useApp } from 'src/contexts/AppContext'
import * as config from 'src/config'

interface Column {
  Header: string
  accessor: string
}

export interface TableColumns {
  Header: string
  columns: Column[]
}

const columns: TableColumns[] = [
  {
    Header: 'Bonder Stats',
    columns: [
      {
        Header: 'Bridge',
        accessor: 'network.slug',
      },
      {
        Header: 'Bonder',
        accessor: 'bonder',
      },
      {
        Header: 'Credit',
        accessor: 'credit',
      },
      {
        Header: 'Debit',
        accessor: 'debit',
      },
      {
        Header: 'Available Liquidity',
        accessor: 'availableLiquidity',
      },
      {
        Header: 'Pending Amount',
        accessor: 'pendingAmount',
      },
      {
        Header: 'Virtual Debt',
        accessor: 'virtualDebt',
      },
      {
        Header: 'Total Amount',
        accessor: 'totalAmount',
      },
      {
        Header: 'Available Native',
        accessor: 'availableNative',
      }
    ],
  },
]

type StatsContextProps = {
  stats: any[]
  fetching: boolean

  bonderStats: BonderStats[]
  fetchingBonderStats: boolean

  pendingAmounts: PendingAmountStats[]
  fetchingPendingAmounts: boolean

  balances: BalanceStats[]
  fetchingBalances: boolean

  debitWindowStats: DebitWindowStats[]
  fetchingDebitWindowStats: boolean
}

const StatsContext = createContext<StatsContextProps | undefined>(undefined)

type BonderStats = {
  id: string
  bonder: string
  token: Token
  network: Network
  credit: number
  debit: number
  availableLiquidity: number
  pendingAmount: number
  virtualDebt: number
  totalAmount: number
  availableNative: number
  error?: string
}

type BalanceStats = {
  network: Network
  name: string
  address: string
  balance: number
  tokenImageUrl: string
  error?: string
}

type DebitWindowStats = {
  id: string
  token: Token
  amountBonded: number[]
  remainingMin: number
  error?: string
}

type PendingAmountStats = {
  id: string
  sourceNetwork: Network
  destinationNetwork: Network
  token: Token
  pendingAmount: BigNumber
  formattedPendingAmount: number
  availableLiquidity: BigNumber
  error?: string
}

const StatsProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const { networks, tokens, sdk } = useApp()
  const [stats, setStats] = useState<any[]>([])
  const [fetching, setFetching] = useState<boolean>(true)
  const [bonderStats, setBonderStats] = useState<BonderStats[]>([])
  const [fetchingBonderStats, setFetchingBonderStats] = useState<boolean>(true)
  const [pendingAmounts, setPendingAmounts] = useState<PendingAmountStats[]>([])
  const [fetchingPendingAmounts, setFetchingPendingAmounts] = useState<boolean>(true)
  const [balances, setBalances] = useState<BalanceStats[]>([])
  const [fetchingBalances, setFetchingBalances] = useState<boolean>(true)
  const [debitWindowStats, setDebitWindowStats] = useState<DebitWindowStats[]>([])
  const [fetchingDebitWindowStats, setFetchingDebitWindowStats] = useState<boolean>(true)
  const filteredNetworks = networks?.filter(token => !token.isLayer1)

  async function fetchStats(selectedNetwork: Network, selectedToken: Token) {
    if (!selectedNetwork) {
      return
    }
    const token = tokens.find(token => token.symbol === selectedToken?.symbol)
    if (!token) {
      return
    }

    const hopToken = new Token({
      symbol: `h${token?.symbol}` as HToken,
      tokenName: token?.tokenName,
      imageUrl: token?.imageUrl,
      decimals: token?.decimals,
    })
    const decimals = hopToken.decimals
    const token0 = {
      symbol: selectedToken?.symbol,
      networkSymbol: selectedToken?.networkSymbol(selectedNetwork),
      imageUrl: token.imageUrl,
    }
    const token1 = {
      symbol: hopToken.symbol,
      networkSymbol: selectedToken?.networkSymbol(selectedNetwork),
    }

    const bridge = sdk.bridge(selectedToken.symbol)
    if (!bridge.isSupportedAsset(selectedNetwork.slug)) {
      return
    }
    const reserves = await bridge.getSaddleSwapReserves(selectedNetwork.slug)
    const reserve0 = Number(utils.formatUnits(reserves[0].toString(), decimals))
    const reserve1 = Number(utils.formatUnits(reserves[1].toString(), decimals))
    const id = `${selectedNetwork.slug}-${token0.symbol}-${token1.symbol}`

    return {
      id,
      pairAddress: null,
      pairUrl: '#',
      totalLiquidity: reserve0 + reserve1,
      token0,
      token1,
      reserve0,
      reserve1,
      network: selectedNetwork,
    }
  }

  useEffect(() => {
    const updateStats = async () => {
      setFetching(true)
      if (!filteredNetworks) {
        return
      }
      const promises: Promise<any>[] = []
      for (const network of filteredNetworks) {
        for (const token of tokens) {
          if (token.symbol === 'HOP') {
            continue
          }
          promises.push(retryPromise(fetchStats, network, token).catch((err: any) => {
            const id = `${network.slug}-${token.symbol}`
            return {
              id,
              token0: token,
              network,
              error: `FETCH ERROR: network: ${network.slug} token: ${token.symbol} error: ${err.message}`
            }
          }))
        }
      }
      const results: any[] = await Promise.all(promises)
      setFetching(false)
      setStats(results.filter(x => x))
    }

    updateStats().catch(logger.error)
  }, [])

  async function fetchBonderStats(
    selectedNetwork: Network,
    selectedToken: Token,
    bonder: string
  ): Promise<BonderStats | undefined> {
    if (!selectedNetwork) {
      return
    }
    if (!pendingAmounts?.length) {
      return
    }
    const token = tokens.find(token => token.symbol === selectedToken?.symbol)
    if (!token) {
      return
    }

    const id = `${selectedNetwork.slug}-${token.symbol}-${bonder}`
    const bridge = sdk.bridge(selectedToken.symbol)
    if (!bridge.isSupportedAsset(selectedNetwork.slug)) {
      return
    }
    const [credit, debit, totalDebit, availableLiquidity, nativeBalance ] =
      await Promise.all([
        bridge.getCredit(selectedNetwork.slug, bonder),
        bridge.getDebit(selectedNetwork.slug, bonder),
        bridge.getTotalDebit(selectedNetwork.slug, bonder),
        bridge.getAvailableLiquidity(selectedNetwork.slug, bonder),
        bridge.getEthBalance(selectedNetwork.slug, bonder),
      ])

    const virtualDebt = totalDebit.sub(debit)
    let pendingAmount = BigNumber.from(0)
    for (const obj of pendingAmounts) {
      if (obj.destinationNetwork.eq(selectedNetwork) && obj.token.eq(token) && obj.pendingAmount) {
        pendingAmount = pendingAmount.add(obj.pendingAmount)
      }
    }

    return {
      id,
      bonder,
      token,
      network: selectedNetwork,
      credit: Number(utils.formatUnits(credit.toString(), token.decimals)),
      debit: Number(utils.formatUnits(totalDebit.toString(), token.decimals)),
      availableLiquidity: Number(utils.formatUnits(availableLiquidity.toString(), token.decimals)),
      pendingAmount: Number(utils.formatUnits(pendingAmount.toString(), token.decimals)),
      virtualDebt: Number(utils.formatUnits(virtualDebt.toString(), token.decimals)),
      totalAmount: Number(
        utils.formatUnits(availableLiquidity.add(pendingAmount).add(virtualDebt), token.decimals)
      ),
      availableNative: Number(utils.formatEther(nativeBalance.toString())),
    }
  }

  useEffect(() => {
    const updateBonderStats = async () => {
      setFetchingBonderStats(true)
      if (!networks) {
        return
      }
      // start fetching after getting balance stats
      if (!balances?.length) {
        return
      }
      // start fetching after getting pending stats
      if (!pendingAmounts?.length) {
        return
      }
      const promises: Promise<any>[] = []
      for (const network of networks) {
        for (const token of tokens) {
          const bonders = new Set<string>()
          if (!config.addresses.bonders?.[token.symbol]?.[network.slug]) {
            continue
          }
          for (const destinationChain in config.addresses.bonders?.[token.symbol]?.[network.slug]) {
            const bonder = config.addresses.bonders?.[token.symbol][network.slug][destinationChain]
            if (bonder) {
              bonders.add(bonder)
            }
          }
          for (const bonder of bonders) {
            promises.push(retryPromise(fetchBonderStats, network, token, bonder).catch((err: any) => {
              logger.error('error fetching bonder stats', token, network, bonder, err)
              const id = `${network.slug}-${token.symbol}-${bonder}`
              return {
                id,
                bonder,
                token,
                network,
                error: `FETCH ERROR: network: ${network.slug} token: ${token.symbol} bonder: ${bonder} error: ${err.message}`
              }
            }))
          }
        }
      }
      let results: any[] = await Promise.all(promises)
      results = results.filter(x => x)
      setFetchingBonderStats(!results.length)
      setBonderStats(results)
    }

    updateBonderStats().catch(logger.error)
  }, [pendingAmounts, balances])

  async function fetchPendingAmounts(
    sourceNetwork: Network,
    destinationNetwork: Network,
    token: Token
  ) {
    if (!sourceNetwork) {
      return
    }
    if (!destinationNetwork) {
      return
    }
    if (!token) {
      return
    }

    const bridge = sdk.bridge(token.symbol)
    const isSupported = bridge.isSupportedAsset(sourceNetwork.slug)
    const isDestSupported = bridge.isSupportedAsset(destinationNetwork.slug)
    if (!isSupported || !isDestSupported) {
      return
    }
    const id = `${sourceNetwork.slug}-${destinationNetwork.slug}-${token.symbol}`
    const contract = await bridge.getBridgeContract(sourceNetwork.slug)
    const pendingAmount = await contract.pendingAmountForChainId(destinationNetwork.networkId)
    const formattedPendingAmount = Number(utils.formatUnits(pendingAmount, token.decimals))
    const al = await bridge.getFrontendAvailableLiquidity(
      sourceNetwork.slug,
      destinationNetwork.slug
    )

    return {
      id,
      sourceNetwork,
      destinationNetwork,
      token,
      pendingAmount,
      formattedPendingAmount,
      availableLiquidity: al,
    }
  }

  useEffect(() => {
    const updatePendingAmounts = async () => {
      setFetchingPendingAmounts(true)
      if (!filteredNetworks) {
        return
      }
      // start fetching after getting pool stats
      if (!stats?.length) {
        return
      }
      const promises: Promise<any>[] = []
      for (const sourceNetwork of filteredNetworks) {
        for (const token of tokens) {
          for (const destinationNetwork of networks) {
            if (destinationNetwork.eq(sourceNetwork)) {
              continue
            }
            promises.push(
              retryPromise(fetchPendingAmounts, sourceNetwork, destinationNetwork, token).catch((err: any) => {
                logger.error('error fetching pending amount stats', token, sourceNetwork, destinationNetwork)
                const id = `${sourceNetwork.slug}-${destinationNetwork.slug}-${token.symbol}`
                return {
                  id,
                  sourceNetwork,
                  destinationNetwork,
                  token,
                  error: `FETCH ERROR: source: ${sourceNetwork.slug} destination: ${destinationNetwork.slug} token: ${token.symbol} error: ${err.message}`
                }
              })
            )
          }
        }
      }
      const results: any[] = await Promise.all(promises)
      setFetchingPendingAmounts(false)
      setPendingAmounts(results.filter(x => x))
    }

    updatePendingAmounts().catch(logger.error)
  }, [stats])

  async function fetchBalances(
    slug: string,
    name: string,
    address: string,
    tokenSymbol: string
  ): Promise<BalanceStats | undefined> {
    if (!slug) {
      return
    }
    if (!name) {
      return
    }
    if (!address) {
      return
    }

    // The token doesn't matter as long as the bridge set exists
    const arbitraryToken = CanonicalToken.USDC
    const bridge = sdk.bridge(arbitraryToken)
    if (!bridge.isSupportedAsset(slug)) {
      return
    }

    const balance = await bridge.getEthBalance(slug, address)
    const formattedBalance: number = Number(utils.formatEther(balance))

    const n = findNetworkBySlug(slug)
    return {
      network: n,
      name,
      address,
      balance: formattedBalance,
      tokenImageUrl: getTokenImage(tokenSymbol),
    }
  }

  useEffect(() => {
    const updateBalances = async () => {
      setFetchingBalances(true)
      if (!filteredNetworks) {
        return
      }
      // start fetching after getting pending amount stats
      if (!pendingAmounts?.length) {
        return
      }
      const addressDatas = [['ethereum', 'relayer', '0x2A6303e6b99d451Df3566068EBb110708335658f']]

      const arbitrumSlug = 'arbitrum'
      for (const token of tokens) {
        const tokenConfig = config.addresses.tokens[token.symbol][arbitrumSlug]
        if (!tokenConfig) {
          continue
        }
        const messengerWrapperAddress: string = tokenConfig.l1MessengerWrapper
        addressDatas.push(['ethereum', `${token.symbol} Wrapper (Arbitrum)`, messengerWrapperAddress, token.symbol])
      }
      const novaSlug = 'nova'
      for (const token of tokens) {
        const tokenConfig = config.addresses.tokens[token.symbol][novaSlug]
        if (!tokenConfig) {
          continue
        }
        const messengerWrapperAddress: string = tokenConfig.l1MessengerWrapper
        addressDatas.push(['ethereum', `${token.symbol} Wrapper (Nova)`, messengerWrapperAddress, token.symbol])
      }
      const promises: Promise<any>[] = []
      for (const addressData of addressDatas) {
        const slug: string = addressData[0]
        const name: string = addressData[1]
        const address: string = addressData[2]
        promises.push(retryPromise(fetchBalances, slug, name, address, addressData[3]).catch((err: any) => {
          logger.error('error fetching balance stats', slug, name, address, err)
          return {
            name,
            address,
            error: `FETCH ERROR: network: ${slug} name: ${name} address: ${address} error: ${err?.message}`
          }
        }))
      }
      const results: any[] = await Promise.all(promises)
      setFetchingBalances(false)
      setBalances(results.filter(x => !!x))
    }

    updateBalances().catch(logger.error)
  }, [pendingAmounts])

  async function fetchDebitWindowStats(
    selectedToken: Token,
    bonder: string
  ): Promise<DebitWindowStats | undefined> {
    const token = tokens.find(token => token.symbol === selectedToken?.symbol)
    if (!token) {
      return
    }

    const bridge = sdk.bridge(selectedToken.symbol)

    const currentTime: number = Math.floor(Date.now() / 1000)
    const currentTimeSlot: BigNumber = await bridge.getTimeSlot(currentTime)
    const challengePeriod: BigNumber = await bridge.challengePeriod()
    const timeSlotSize: BigNumber = await bridge.timeSlotSize()
    const numTimeSlots: BigNumber = challengePeriod.div(timeSlotSize)
    const amountBonded: number[] = []

    for (let i = 0; i < Number(numTimeSlots); i++) {
      const timeSlot: number = Number(currentTimeSlot.sub(i))
      const amount: BigNumber = await bridge.timeSlotToAmountBonded(timeSlot, bonder)
      amountBonded.push(Number(utils.formatUnits(amount.toString(), token.decimals)))
    }

    const timeElapsedInSlot: number = currentTime % Number(timeSlotSize)
    const remainingSec: number = Number(timeSlotSize.sub(timeElapsedInSlot))
    const remainingMin: number = Math.ceil(remainingSec / 60)

    return {
      id: token.symbol,
      token,
      amountBonded,
      remainingMin,
    }
  }

  useEffect(() => {
    const updateDebitWindow = async () => {
      setFetchingDebitWindowStats(true)
      if (!networks) {
        return
      }
      // start fetching after getting pending amount stats
      if (!pendingAmounts?.length) {
        return
      }
      const results: any[] = []
      for (const token of tokens) {
        const bonders = new Set<string>()
        for (const bonder in config.addresses.bonders?.[token.symbol]) {
          for (const sourceChain in config.addresses.bonders?.[token.symbol]) {
            for (const destinationChain in config.addresses.bonders?.[token.symbol][
              sourceChain 
            ]) {
              const bonder = config.addresses.bonders?.[token.symbol][sourceChain][destinationChain]
              if (bonder) {
                bonders.add(bonder)
              }
            }
          }
        }
        for (const bonder of bonders) {
          try {
            const result = await retryPromise(fetchDebitWindowStats, token, bonder)
            logger.debug('got debit window stats result:', token, bonder)
            if (result) {
              results.push(result)
            }
          } catch (err: any) {
            logger.error('error fetching debit window stats:', token, bonder, err)
            results.push({
              id: token.symbol,
              token,
              error: `FETCH ERROR: token: ${token.symbol} bonder: ${bonder} error: ${err.message}`
            })
          }
        }
      }
      setFetchingDebitWindowStats(!results.length)
      setDebitWindowStats(results)
    }

    updateDebitWindow().catch(logger.error)
  }, [pendingAmounts])

  const cols = useMemo<TableColumns[]>(() => columns, [])

  return (
    <StatsContext.Provider
      value={{
        stats,
        fetching,

        bonderStats,
        fetchingBonderStats,

        pendingAmounts,
        fetchingPendingAmounts,

        balances,
        fetchingBalances,

        debitWindowStats,
        fetchingDebitWindowStats,
      }}
    >
      {children}
    </StatsContext.Provider>
  )
}

export function useStats() {
  const ctx = useContext(StatsContext)
  if (ctx === undefined) {
    throw new Error('useStats must be used within the StatsProvider')
  }
  return ctx
}

export default StatsProvider
