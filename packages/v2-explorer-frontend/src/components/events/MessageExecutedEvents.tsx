import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import React, { useState } from 'react'
import Select from '@mui/material/Select'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { Table } from '../Table'
import { useEvents } from '../../hooks/useEvents'

export function MessageExecutedEvents () {
  const eventName = 'MessageExecuted'
  const [filterBy, setFilterBy] = useState('messageId')
  const [filterValue, setFilterValue] = useState('')
  const filter = { [filterBy]: filterValue }
  const { events, nextPage, previousPage, showNextButton, showPreviousButton, limit, loading } = useEvents(eventName, filter)

  const headers = [
    {
      key: 'timestamp',
      value: 'Timestamp',
    },
    {
      key: 'transactionHash',
      value: 'Transaction Hash'
    },
    {
      key: 'messageId',
      value: 'Message ID',
    },
    {
      key: 'fromChainId',
      value: 'From Chain ID',
    },
    {
      key: 'from',
      value: 'From',
    },
    {
      key: 'to',
      value: 'To',
    },
    {
      key: 'eventChainId',
      value: 'Event Chain ID',
    },
  ]

  const rows = events.map((event: any) => {
    return [
      {
        key: 'timestamp',
        value: `${event.context.blockTimestamp} (${event.context.blockTimestampRelative})`,
        clipboardValue: event.context.blockTimestamp
      },
      {
        key: 'transactionHash',
        value: event.context.transactionHashTruncated,
        valueUrl: event.context.transactionHashExplorerUrl,
        clipboardValue: event.context.transactionHash
      },
      {
        key: 'messageId',
        value: event.messageIdTruncated,
        clipboardValue: event.messageId
      },
      {
        key: 'fromChainId',
        value: event.fromChainLabel,
        clipboardValue: event.fromChainId
      },
      {
        key: 'from',
        value: event.fromTruncated,
        clipboardValue: event.from
      },
      {
        key: 'to',
        value: event.toTruncated,
        clipboardValue: event.to
      },
      {
        key: 'eventChainId',
        value: event.context.chainLabel,
        clipboardValue: event.context.chainId
      },
    ]
  })

  function handleFilterByChange (event: any) {
    setFilterBy(event.target.value)
  }

  return (
    <Box>
      <Table title={`${eventName} Events`} headers={headers} rows={rows} showNextButton={showNextButton} showPreviousButton={showPreviousButton} nextPage={nextPage} previousPage={previousPage} limit={limit} loading={loading} filters={
      <Box display="flex" justifyContent="flex-end" alignItems="center">
        <Box mr={2}>
          <Typography variant="body1">Filter</Typography>
        </Box>
        <Box mr={2}>
          <Select
            value={filterBy}
            onChange={handleFilterByChange}>
              <MenuItem value={'messageId'}>Message ID</MenuItem>
              <MenuItem value={'transactionHash'}>Transaction Hash</MenuItem>
          </Select>
        </Box>
        <Box>
          <TextField placeholder="0x" value={filterValue} onChange={(event: any) => setFilterValue(event.target.value)} />
        </Box>
      </Box>
        } />
    </Box>
  )
}
