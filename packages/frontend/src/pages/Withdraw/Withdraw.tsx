import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import React, { ChangeEvent, FC, useEffect, useState } from 'react'
import Typography from '@mui/material/Typography'
import useQueryParams from 'src/hooks/useQueryParams'
import { Alert } from 'src/components/Alert'
import { Button } from 'src/components/Button/Button'
import { InfoTooltip } from 'src/components/InfoTooltip'
import { LargeTextField } from 'src/components/LargeTextField'
import { WithdrawalProof } from '@hop-protocol/sdk/utils'
import { formatError } from 'src/utils/format'
import { makeStyles } from '@mui/styles'
import { reactAppNetwork } from 'src/config'
import { toTokenDisplay } from 'src/utils'
import { updateQueryParams } from 'src/utils/updateQueryParams'
import { useApp } from 'src/contexts/AppContext'
import { useWeb3Context } from 'src/contexts/Web3Context'

const useStyles = makeStyles((theme: any) => ({
  root: {
    maxWidth: '680px',
    margin: '0 auto',
  },
  header: {
    marginBottom: '4rem',
    textAlign: 'center',
  },
  form: {
    display: 'block',
    marginBottom: '4rem',
  },
  card: {
    marginBottom: '4rem',
  },
  loader: {
    marginTop: '2rem',
    textAlign: 'center',
  },
  notice: {
    display: 'flex',
    alignItems: 'center',
    flexDirection: 'column',
  },
}))

export const Withdraw: FC = () => {
  const styles = useStyles()
  const { sdk, networks, txConfirm } = useApp()
  const { checkConnectedNetworkId } = useWeb3Context()
  const { queryParams } = useQueryParams()
  const [transferIdOrTxHash, setTransferIdOrTxHash] = useState<string>(() => {
    return queryParams?.transferId as string || ''
  })
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    try {
      updateQueryParams({
        transferId: transferIdOrTxHash || ''
      })
    } catch (err: any) {
      console.error(err)
    }
  }, [transferIdOrTxHash])

  async function handleSubmit(event: ChangeEvent<any>) {
    event.preventDefault()
    try {
      setLoading(true)
      setError('')
      let wp: WithdrawalProof
      await new Promise(async (resolve, reject) => {
        try {
          wp = new WithdrawalProof(reactAppNetwork, transferIdOrTxHash)
          await wp.generateProof()
          const { sourceChain } = wp.transfer
          await txConfirm?.show({
            kind: 'withdrawReview',
            inputProps: {
              source: {
                network: sourceChain,
              },
              getProof: async () => {
                return wp
              },
              getInfo: async (wp: WithdrawalProof) => {
                const { sourceChain, destinationChain, token, tokenDecimals, amount } = wp.transfer
                const formattedAmount = toTokenDisplay(amount, tokenDecimals)
                const source = networks.find(network => network.slug === sourceChain)
                const destination = networks.find(network => network.slug === destinationChain)
                return {
                  source,
                  destination,
                  token,
                  amount: formattedAmount,
                }
              },
              sendTx: async () => {
                wp.checkWithdrawable()
                const networkId = Number(wp.transfer.destinationChainId)
                const isNetworkConnected = await checkConnectedNetworkId(networkId)
                if (!isNetworkConnected) {
                  throw new Error('wrong network connected')
                }
                const {
                  recipient,
                  amount,
                  transferNonce,
                  bonderFee,
                  amountOutMin,
                  deadline,
                  transferRootHash,
                  rootTotalAmount,
                  transferIdTreeIndex,
                  siblings,
                  totalLeaves,
                } = wp.getTxPayload()
                const bridge = sdk.bridge(wp.transfer.token)
                const tx = await bridge.withdraw(
                  wp.transfer.destinationChain,
                  recipient,
                  amount,
                  transferNonce,
                  bonderFee,
                  amountOutMin,
                  deadline,
                  transferRootHash,
                  rootTotalAmount,
                  transferIdTreeIndex,
                  siblings,
                  totalLeaves
                )
                return tx
              },
              onError: (err: any) => {
                reject(err)
              },
            },
            onConfirm: async () => {}, // needed to close modal
          })
          resolve(null)
        } catch (err) {

          try {
            const bridge = sdk.bridge('USDC')
            const data = await bridge.getCctpWithdrawData(transferIdOrTxHash)
            if (data) {
              const { transactionHash, fromChain, toChain, toChainId, nonceUsed } = data
              if (nonceUsed) {
                reject(new Error('The withdrawal for this transfer has already been processed'))
                return
              }
              await txConfirm?.show({
                kind: 'withdrawReview',
                inputProps: {
                  source: {
                    network: fromChain,
                  },
                  getProof: async () => {
                    return null
                  },
                  getInfo: async () => {
                    return null
                  },
                  sendTx: async () => {
                    const networkId = Number(toChainId)
                    const isNetworkConnected = await checkConnectedNetworkId(networkId)
                    if (!isNetworkConnected) {
                      throw new Error('wrong network connected')
                    }
                    const tx = await bridge.cctpWithdraw(fromChain, toChain, transactionHash)
                    return tx
                  },
                  onError: (err: any) => {
                    reject(err)
                  },
                },
                onConfirm: async () => {}, // needed to close modal
              })
            }
          } catch (err: any) {
            console.error('withdraw check error', error)
          }

          reject(err)
        }
      })
    } catch (err: any) {
      console.error(err)
      setError(formatError(err))
    }
    setLoading(false)
  }

  function handleInputChange(event: ChangeEvent<any>) {
    setTransferIdOrTxHash(event.target.value)
  }

  return (
    <Box className={styles.root}>
      <Box className={styles.header}>
        <Typography variant="h4">Withdraw</Typography>
      </Box>
      <form className={styles.form} onSubmit={handleSubmit}>
        <Box>
          <Card className={styles.card}>
            <Typography variant="h6">
              Transfer ID
              <InfoTooltip
                title={
                  'Enter the transfer ID or origin transaction hash of transfer to withdraw at the destination. You can use this to withdraw unbonded transfers after the transfer root has been propagated to the destination. The transfer ID can be found in the Hop explorer.'
                }
              />
              <Box ml={2} display="inline-flex">
                <Typography variant="body2" color="secondary" component="span">
                  Enter transfer ID or origin transaction hash
                </Typography>
              </Box>
            </Typography>
            <LargeTextField
              value={transferIdOrTxHash}
              onChange={handleInputChange}
              placeholder="0x123"
              smallFontSize
              leftAlign
            />
          </Card>
        </Box>
        <Box>
          <Button onClick={handleSubmit} loading={loading} large highlighted>
            Withdraw
          </Button>
        </Box>
      </form>
      <Box className={styles.notice}>
        <Alert severity="error">{error}</Alert>
      </Box>
    </Box>
  )
}
