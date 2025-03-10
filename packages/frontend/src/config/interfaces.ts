import { Bonders, Bridges } from '@hop-protocol/sdk/addresses'

export interface IProposalDetail {
  target: string
  functionSig: string
  callData: string
}

export interface IProposal {
  id: string
  title: string
  description: string
  proposer: string
  status: string
  forCount: number
  againstCount: number
  startBlock: number
  endBlock: number
  details: IProposalDetail[]
}

export interface HopAddresses {
  governance: {
    l1Hop: string
    stakingRewardsFactory: string
    stakingRewards: string
    governorAlpha: string
  }
  tokens: Partial<Bridges>
  bonders: Partial<Bonders>
}

export type Networks = {
  [key: string]: {
    networkId: number
    rpcUrl: string
    fallbackRpcUrls: string[]
    explorerUrl: string
    nativeBridgeUrl?: string
  }
}
