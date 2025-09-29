// Based on https://github.com/solana-foundation/solana-web3.js/tree/maintenance/v1.x/src/transaction

const crypto = require('solana-crypto')
const PublicKey = require('solana-public-key')
const bs58 = maybeDefaultModule(require('bs58'))
const shortvec = require('./short-vector-encoding.js')
const Message = require('./message.js')
const TransactionInstruction = require('solana-transaction-instruction')

const PACKET_DATA_SIZE = 1280 - 40 - 8 // IPv6 minimum MTU - headers

module.exports = class Transaction {
  constructor (opts = {}) {
    this.feePayer = opts.feePayer || null
    this.instructions = []
    this.signatures = opts.signatures || []

    if (opts.nonceInfo) {
      this.nonceInfo = opts.nonceInfo || null
      this.minNonceContextSlot = opts.minContextSlot || 0
    } else if (opts.lastValidBlockHeight) {
      this.recentBlockhash = opts.blockhash || null
      this.lastValidBlockHeight = opts.lastValidBlockHeight || 0
    } else {
      this.nonceInfo = opts.nonceInfo || null
      this.recentBlockhash = opts.recentBlockhash || null
    }

    this.crypto = opts.crypto || null
  }

  get signature () {
    return this.signatures.length > 0 ? this.signatures[0].signature : null
  }

  toJSON () {
    return {
      recentBlockhash: this.recentBlockhash || null,
      feePayer: this.feePayer ? this.feePayer.toJSON() : null,
      nonceInfo: this.nonceInfo
        ? {
            nonce: this.nonceInfo.nonce,
            nonceInstruction: this.nonceInfo.nonceInstruction.toJSON()
          }
        : null,
      instructions: this.instructions.map(ix => ix.toJSON()),
      signers: this.signatures.map(sig => sig.publicKey.toJSON())
    }
  }

  add (...items) {
    for (const item of items) {
      if (item.instructions) {
        this.instructions = this.instructions.concat(item.instructions)
      } else if (item.data && item.programId && item.keys) {
        this.instructions.push(item)
      } else {
        this.instructions.push(new TransactionInstruction(item))
      }
    }

    return this
  }

  compileMessage () {
    if (this._message && JSON.stringify(this.toJSON()) === JSON.stringify(this._json)) {
      return this._message
    }

    let recentBlockhash = this.recentBlockhash
    let instructions = this.instructions

    if (this.nonceInfo) {
      recentBlockhash = this.nonceInfo.nonce

      if (this.instructions[0] !== this.nonceInfo.nonceInstruction) {
        instructions = [this.nonceInfo.nonceInstruction, ...this.instructions]
      }
    }

    if (!recentBlockhash) {
      throw new Error('Transaction recentBlockhash required')
    }

    let feePayer = this.feePayer

    if (this.feePayer) {
      feePayer = this.feePayer
    } else if (this.signatures.length > 0 && this.signatures[0].publicKey) {
      feePayer = this.signatures[0].publicKey
    } else {
      throw new Error('Transaction fee payer required')
    }

    const programIds = []
    const accountMetas = []

    for (const ix of instructions) {
      for (const accountMeta of ix.keys) {
        accountMetas.push({ ...accountMeta })
      }

      const programId = ix.programId.toString()

      if (!programIds.includes(programId)) {
        programIds.push(programId)
      }
    }

    for (const programId of programIds) {
      accountMetas.push({
        pubkey: new PublicKey(programId),
        isSigner: false,
        isWritable: false
      })
    }

    const uniqueMetas = []

    for (const accountMeta of accountMetas) {
      const pubkeyString = accountMeta.pubkey.toString()
      const uniqueIndex = uniqueMetas.findIndex(x => x.pubkey.toString() === pubkeyString)

      if (uniqueIndex > -1) {
        uniqueMetas[uniqueIndex].isWritable = uniqueMetas[uniqueIndex].isWritable || accountMeta.isWritable
        uniqueMetas[uniqueIndex].isSigner = uniqueMetas[uniqueIndex].isSigner || accountMeta.isSigner
      } else {
        uniqueMetas.push(accountMeta)
      }
    }

    // Sort. Prioritizing first by signer, then by writable
    uniqueMetas.sort(function (x, y) {
      // Signers always come before non-signers
      if (x.isSigner !== y.isSigner) {
        return x.isSigner ? -1 : 1
      }

      // Writable accounts always come before read-only accounts
      if (x.isWritable !== y.isWritable) {
        return x.isWritable ? -1 : 1
      }

      // Otherwise, sort by pubkey, stringwise.
      const options = {
        localeMatcher: 'best fit',
        usage: 'sort',
        sensitivity: 'variant',
        ignorePunctuation: false,
        numeric: false,
        caseFirst: 'lower'
      }

      return x.pubkey.toBase58().localeCompare(y.pubkey.toBase58(), 'en', options)
    })

    // Move fee payer to the front
    const feePayerIndex = uniqueMetas.findIndex(x => x.pubkey.equals(feePayer))

    if (feePayerIndex > -1) {
      const [payerMeta] = uniqueMetas.splice(feePayerIndex, 1)

      payerMeta.isSigner = true
      payerMeta.isWritable = true

      uniqueMetas.unshift(payerMeta)
    } else {
      uniqueMetas.unshift({
        pubkey: feePayer,
        isSigner: true,
        isWritable: true
      })
    }

    // Disallow unknown signers
    for (const signature of this.signatures) {
      const uniqueIndex = uniqueMetas.findIndex(x => x.pubkey.equals(signature.publicKey))

      if (uniqueIndex > -1) {
        if (!uniqueMetas[uniqueIndex].isSigner) {
          throw new Error('Transaction references a signature that is unnecessary')
        }
      } else {
        throw new Error('Unknown signer: ' + signature.publicKey.toString())
      }
    }

    let numRequiredSignatures = 0
    let numReadonlySignedAccounts = 0
    let numReadonlyUnsignedAccounts = 0

    // Split out signing from non-signing keys and count header values
    const signedKeys = []
    const unsignedKeys = []

    for (const { pubkey, isSigner, isWritable } of uniqueMetas) {
      if (isSigner) {
        signedKeys.push(pubkey.toString())

        numRequiredSignatures += 1

        if (!isWritable) {
          numReadonlySignedAccounts += 1
        }
      } else {
        unsignedKeys.push(pubkey.toString())

        if (!isWritable) {
          numReadonlyUnsignedAccounts += 1
        }
      }
    }

    const accountKeys = signedKeys.concat(unsignedKeys)

    const compiledInstructions = instructions.map(ix => ({
      programIdIndex: accountKeys.indexOf(ix.programId.toString()),
      accounts: ix.keys.map(meta => accountKeys.indexOf(meta.pubkey.toString())),
      data: bs58.encode(ix.data)
    }))

    for (const ix of compiledInstructions) {
      if (ix.programIdIndex < 0) throw new Error('Assertion failed')

      for (const keyIndex of ix.accounts) {
        if (keyIndex === -1) throw new Error('Assertion failed')
      }
    }

    return new Message({
      header: {
        numRequiredSignatures,
        numReadonlySignedAccounts,
        numReadonlyUnsignedAccounts
      },
      accountKeys,
      recentBlockhash,
      instructions: compiledInstructions
    })
  }

  _compile () {
    const message = this.compileMessage()
    const signedKeys = message.accountKeys.slice(0, message.header.numRequiredSignatures)

    if (this.signatures.length === signedKeys.length) {
      const valid = this.signatures.every((pair, i) => signedKeys[i].equals(pair.publicKey))

      if (valid) {
        return message
      }
    }

    this.signatures = signedKeys.map(publicKey => ({
      signature: null,
      publicKey
    }))

    return message
  }

  serializeMessage () {
    return this._compile().serialize()
  }

  sign (...signers) {
    if (signers.length === 0) {
      throw new Error('No signers')
    }

    const seen = new Set()
    const uniqueSigners = []

    for (const signer of signers) {
      const key = signer.publicKey.toString()

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      uniqueSigners.push(signer)
    }

    this.signatures = uniqueSigners.map(signer => ({
      signature: null,
      publicKey: signer.publicKey
    }))

    const message = this._compile()

    this._partialSign(message, ...uniqueSigners)
  }

  partialSign (...signers) {
    if (signers.length === 0) {
      throw new Error('No signers')
    }

    const seen = new Set()
    const uniqueSigners = []

    for (const signer of signers) {
      const key = signer.publicKey.toString()

      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      uniqueSigners.push(signer)
    }

    const message = this._compile()

    this._partialSign(message, ...uniqueSigners)
  }

  _partialSign (message, ...signers) {
    const signData = message.serialize()

    for (const signer of signers) {
      let signature = null

      if (this.crypto) {
        signature = this.crypto.sign(signData, signer.secretKey)
      } else {
        signature = crypto.sign(signData, signer.secretKey)
      }

      this._addSignature(signer.publicKey, toBuffer(signature))
    }
  }

  addSignature (pubkey, signature) {
    this._compile() // Ensure signatures array is populated
    this._addSignature(pubkey, signature)
  }

  _addSignature (pubkey, signature) {
    if (signature.length !== 64) {
      throw new Error('Assertion failed')
    }

    const index = this.signatures.findIndex(sigpair => pubkey.equals(sigpair.publicKey))

    if (index < 0) {
      throw new Error('Unknown signer: ' + pubkey.toString())
    }

    this.signatures[index].signature = Buffer.from(signature)
  }

  verifySignatures (requireAllSignatures = true) {
    const signatureErrors = this._getMessageSignednessErrors(this.serializeMessage(), requireAllSignatures)

    return !signatureErrors
  }

  _getMessageSignednessErrors (message, requireAllSignatures) {
    const errors = {}

    for (const { signature, publicKey } of this.signatures) {
      if (signature === null) {
        if (requireAllSignatures) {
          (errors.missing ||= []).push(publicKey)
        }
      } else {
        if (!crypto.verify(signature, message, publicKey.toBytes())) {
          (errors.invalid ||= []).push(publicKey)
        }
      }
    }

    return errors.invalid || errors.missing ? errors : undefined
  }

  serialize (config) {
    const { requireAllSignatures, verifySignatures } = Object.assign(
      { requireAllSignatures: true, verifySignatures: true },
      config
    )

    const signData = this.serializeMessage()

    if (verifySignatures) {
      const sigErrors = this._getMessageSignednessErrors(signData, requireAllSignatures)

      if (sigErrors) {
        let errorMessage = 'Signature verification failed.'

        if (sigErrors.invalid) {
          errorMessage += `\nInvalid signature for public key${
            sigErrors.invalid.length === 1 ? '' : '(s)'
          } [\`${sigErrors.invalid.map(p => p.toBase58()).join('`, `')}\`].`
        }

        if (sigErrors.missing) {
          errorMessage += `\nMissing signature for public key${
            sigErrors.missing.length === 1 ? '' : '(s)'
          } [\`${sigErrors.missing.map(p => p.toBase58()).join('`, `')}\`].`
        }

        throw new Error(errorMessage)
      }
    }

    return this._serialize(signData)
  }

  _serialize (signData) {
    const signatureCount = shortvec.encodeLength(this.signatures.length)
    const transactionLength = signatureCount.length + this.signatures.length * 64 + signData.length
    const wireTransaction = Buffer.alloc(transactionLength)

    if (this.signatures.length >= 256) {
      throw new Error('Assertion failed')
    }

    Buffer.from(signatureCount).copy(wireTransaction, 0)

    for (let i = 0; i < this.signatures.length; i++) {
      const sig = this.signatures[i]

      if (sig.signature !== null) {
        if (sig.signature.length !== 64) {
          throw new Error('Signature has invalid length')
        }

        Buffer.from(sig.signature).copy(wireTransaction, signatureCount.length + i * 64)
      }
    }

    signData.copy(wireTransaction, signatureCount.length + this.signatures.length * 64)

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

function maybeDefaultModule (mod) {
  return mod.default ? mod.default : mod
}
