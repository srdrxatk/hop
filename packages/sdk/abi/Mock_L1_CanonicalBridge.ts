export default [
  {
    "inputs": [
      {
        "internalType": "contract IERC20",
        "name": "_canonicalToken",
        "type": "address"
      },
      {
        "internalType": "contract Mock_L1_Messenger",
        "name": "_messenger",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "canonicalToken",
    "outputs": [
      {
        "internalType": "contract IERC20",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "messenger",
    "outputs": [
      {
        "internalType": "contract Mock_L1_Messenger",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_target",
        "type": "address"
      },
      {
        "internalType": "bytes",
        "name": "_message",
        "type": "bytes"
      }
    ],
    "name": "sendMessage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_target",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "_recipient",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "_amount",
        "type": "uint256"
      },
      {
        "internalType": "bool",
        "name": "isPolygon",
        "type": "bool"
      }
    ],
    "name": "sendTokens",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
