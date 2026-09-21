// Based on https://github.com/solana-foundation/solana-web3.js/tree/maintenance/v1.x/src/transaction

const crypto = require('solana-crypto')
const shortvec = require('./short-vector-encoding.js')

const PACKET_DATA_SIZE = 1280 - 40 - 8 // IPv6 minimum MTU - headers
const SIGNATURE_LENGTH = 64

module.exports = class VersionedTransaction {
  constructor (message, signatures) {
    if (signatures) {
      if (signatures.length !== message.header.numRequiredSignatures) {
        throw new Error('Expected signatures length to be equal to the number of required signatures')
      }

      this.signatures = signatures
    } else {
      this.signatures = []

      for (let i = 0; i < message.header.numRequiredSignatures; i++) {
        this.signatures.push(Buffer.alloc(SIGNATURE_LENGTH))
      }
    }

    this.message = message
  }

  get version () {
    return this.message.version
  }

  get signature () {
    return this.signatures.length > 0 ? this.signatures[0] : null
  }

  sign (signers) {
    const messageData = this.message.serialize()
    const signerKeys = this.message.staticAccountKeys.slice(0, this.message.header.numRequiredSignatures)

    for (const signer of signers) {
      const signerIndex = signerKeys.findIndex(pubkey => pubkey.equals(signer.publicKey))

      if (signerIndex < 0) {
        throw new Error('Cannot sign with non signer key ' + signer.publicKey.toBase58())
      }

      this.signatures[signerIndex] = toBuffer(crypto.sign(messageData, signer.secretKey))
    }
  }

  addSignature (pubkey, signature) {
    if (signature.length !== 64) {
      throw new Error('Signature has invalid length')
    }

    const signerKeys = this.message.staticAccountKeys.slice(0, this.message.header.numRequiredSignatures)
    const signerIndex = signerKeys.findIndex(signerKey => signerKey.equals(pubkey))

    if (signerIndex < 0) {
      throw new Error('Can not add signature; `' + pubkey.toBase58() + '` is not required to sign this transaction')
    }

    this.signatures[signerIndex] = Buffer.from(signature)
  }

  serialize () {
    const serializedMessage = this.message.serialize()

    const signatureCount = shortvec.encodeLength(this.signatures.length)
    const transactionLength = signatureCount.length + this.signatures.length * 64 + serializedMessage.length
    const wireTransaction = Buffer.alloc(transactionLength)

    if (this.signatures.length >= 256) {
      throw new Error('Assertion failed')
    }

    Buffer.from(signatureCount).copy(wireTransaction, 0)

    for (let i = 0; i < this.signatures.length; i++) {
      const signature = this.signatures[i]

      if (signature.length !== 64) {
        throw new Error('Signature has invalid length')
      }

      Buffer.from(signature).copy(wireTransaction, signatureCount.length + i * 64)
    }

    serializedMessage.copy(wireTransaction, signatureCount.length + this.signatures.length * 64)

    if (wireTransaction.length > PACKET_DATA_SIZE) {
      throw new Error('Transaction too large: ' + wireTransaction.length + ' > ' + PACKET_DATA_SIZE)
    }

    return wireTransaction
  }
}

function toBuffer (arr) {
  if (Buffer.isBuffer(arr)) {
    return arr
  } else if (arr instanceof Uint8Array) {
    return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
  } else {
    return Buffer.from(arr)
  }
}
