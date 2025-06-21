// Based on https://github.com/solana-foundation/solana-web3.js/tree/maintenance/v1.x/src/message

const PublicKey = require('solana-public-key')
const BufferLayout = require('@solana/buffer-layout')
const bs58 = maybeDefaultModule(require('bs58'))

const shortvec = require('./short-vector-encoding.js')

const PACKET_DATA_SIZE = 1280 - 40 - 8 // IPv6 minimum MTU - headers

module.exports = class Message {
  constructor (opts = {}) {
    this.header = opts.header
    this.accountKeys = opts.accountKeys.map(account => new PublicKey(account))
    this.recentBlockhash = opts.recentBlockhash
    this.instructions = opts.instructions
  }

  get version () {
    return 'legacy'
  }

  get staticAccountKeys () {
    return this.accountKeys
  }

  get compiledInstructions () {
    return this.instructions.map(ix => ({
      programIdIndex: ix.programIdIndex,
      accountKeyIndexes: ix.accounts,
      data: bs58.decode(ix.data)
    }))
  }

  get addressTableLookups () {
    return []
  }

  getAccountKeys () {
    return new MessageAccountKeys(this.staticAccountKeys)
  }

  static compile (args) {
    const compiledKeys = CompiledKeys.compile(args.instructions, args.payerKey)
    const [header, staticAccountKeys] = compiledKeys.getMessageComponents()
    const accountKeys = new MessageAccountKeys(staticAccountKeys)
    const instructions = accountKeys.compileInstructions(args.instructions)

    return new Message({
      header,
      accountKeys: staticAccountKeys,
      recentBlockhash: args.recentBlockhash,
      instructions: instructions.map(ix => ({
        programIdIndex: ix.programIdIndex,
        accounts: ix.accountKeyIndexes,
        data: bs58.encode(ix.data)
      }))
    })
  }

  isAccountSigner (index) {
    return index < this.header.numRequiredSignatures
  }

  isAccountWritable (index) {
    const numSignedAccounts = this.header.numRequiredSignatures

    if (index >= this.header.numRequiredSignatures) {
      const unsignedAccountIndex = index - numSignedAccounts
      const numUnsignedAccounts = this.accountKeys.length - numSignedAccounts
      const numWritableUnsignedAccounts = numUnsignedAccounts - this.header.numReadonlyUnsignedAccounts

      return unsignedAccountIndex < numWritableUnsignedAccounts
    }

    const numWritableSignedAccounts = numSignedAccounts - this.header.numReadonlySignedAccounts

    return index < numWritableSignedAccounts
  }

  isProgramId (index) {
    for (const ix of this.instructions) {
      if (index === ix.programIdIndex) {
        return true
      }
    }

    return false
  }

  programIds () {
    const programs = []

    for (const ix of this.instructions) {
      programs.push(this.accountKeys[ix.programIdIndex])
    }

    return programs
  }

  nonProgramIds () {
    return this.accountKeys.filter((_, i) => !this.isProgramId(i))
  }

  serialize () {
    const numKeys = this.accountKeys.length
    const keyCount = shortvec.encodeLength(numKeys)

    const instructions = this.instructions.map(ix => {
      const data = Array.from(bs58.decode(ix.data))

      const keyIndicesCount = shortvec.encodeLength(ix.accounts.length)
      const dataCount = shortvec.encodeLength(data.length)

      return {
        programIdIndex: ix.programIdIndex,
        keyIndicesCount: Buffer.from(keyIndicesCount),
        keyIndices: ix.accounts,
        dataLength: Buffer.from(dataCount),
        data
      }
    })

    const instructionCount = shortvec.encodeLength(instructions.length)

    let instructionBuffer = Buffer.alloc(PACKET_DATA_SIZE)
    Buffer.from(instructionCount).copy(instructionBuffer)

    let instructionBufferLength = instructionCount.length

    for (const ix of instructions) {
      const instructionLayout = BufferLayout.struct([
        BufferLayout.u8('programIdIndex'),
        BufferLayout.blob(ix.keyIndicesCount.length, 'keyIndicesCount'),
        BufferLayout.seq(BufferLayout.u8('keyIndex'), ix.keyIndices.length, 'keyIndices'),
        BufferLayout.blob(ix.dataLength.length, 'dataLength'),
        BufferLayout.seq(BufferLayout.u8('userdatum'), ix.data.length, 'data')
      ])

      const length = instructionLayout.encode(ix, instructionBuffer, instructionBufferLength)

      instructionBufferLength += length
    }

    instructionBuffer = instructionBuffer.slice(0, instructionBufferLength)

    const signDataLayout = BufferLayout.struct([
      BufferLayout.blob(1, 'numRequiredSignatures'),
      BufferLayout.blob(1, 'numReadonlySignedAccounts'),
      BufferLayout.blob(1, 'numReadonlyUnsignedAccounts'),
      BufferLayout.blob(keyCount.length, 'keyCount'),
      BufferLayout.seq(BufferLayout.blob(32, 'key'), numKeys, 'keys'),
      BufferLayout.blob(32, 'recentBlockhash')
    ])

    const transaction = {
      numRequiredSignatures: Buffer.from([this.header.numRequiredSignatures]),
      numReadonlySignedAccounts: Buffer.from([this.header.numReadonlySignedAccounts]),
      numReadonlyUnsignedAccounts: Buffer.from([this.header.numReadonlyUnsignedAccounts]),
      keyCount: Buffer.from(keyCount),
      keys: this.accountKeys.map(key => key.toBuffer()),
      recentBlockhash: bs58.decode(this.recentBlockhash)
    }

    const signData = Buffer.alloc(2048)
    const length = signDataLayout.encode(transaction, signData)

    instructionBuffer.copy(signData, length)

    return signData.slice(0, length + instructionBuffer.length)
  }
}

class MessageAccountKeys {
  constructor (staticAccountKeys, accountKeysFromLookups) {
    this.staticAccountKeys = staticAccountKeys
    this.accountKeysFromLookups = accountKeysFromLookups || null
  }

  keySegments () {
    const keySegments = [this.staticAccountKeys]

    if (this.accountKeysFromLookups) {
      keySegments.push(this.accountKeysFromLookups.writable)
      keySegments.push(this.accountKeysFromLookups.readonly)
    }

    return keySegments
  }

  get (index) {
    for (const keySegment of this.keySegments()) {
      if (index < keySegment.length) {
        return keySegment[index]
      }

      index -= keySegment.length
    }

    return null
  }

  get length () {
    return this.keySegments().flat().length
  }

  compileInstructions (instructions) {
    const U8_MAX = 255

    if (this.length > U8_MAX + 1) {
      throw new Error('Account index overflow encountered during compilation')
    }

    const keyIndexMap = new Map()
    const keySegments = this.keySegments().flat()

    for (let i = 0; i < keySegments.length; i++) {
      keyIndexMap.set(keySegments[i].toBase58(), i)
    }

    return instructions.map(ix => {
      return {
        programIdIndex: findKeyIndex(ix.programId),
        accountKeyIndexes: ix.keys.map(meta => findKeyIndex(meta.pubkey)),
        data: ix.data
      }
    })

    function findKeyIndex (key) {
      const keyIndex = keyIndexMap.get(key.toBase58())

      if (keyIndex === undefined) {
        throw new Error('Encountered an unknown instruction account key during compilation')
      }

      return keyIndex
    }
  }
}

class CompiledKeys {
  constructor (payer, keyMetaMap) {
    this.payer = payer
    this.keyMetaMap = keyMetaMap
  }

  static compile (instructions, payer) {
    const keyMetaMap = new Map()

    const payerKeyMeta = getOrInsertDefault(payer)

    payerKeyMeta.isSigner = true
    payerKeyMeta.isWritable = true

    for (const ix of instructions) {
      const keyMetaProgram = getOrInsertDefault(ix.programId)

      keyMetaProgram.isInvoked = true

      for (const accountMeta of ix.keys) {
        const keyMeta = getOrInsertDefault(accountMeta.pubkey)

        keyMeta.isSigner ||= accountMeta.isSigner
        keyMeta.isWritable ||= accountMeta.isWritable
      }
    }

    return new CompiledKeys(payer, keyMetaMap)

    function getOrInsertDefault (pubkey) {
      const address = pubkey.toBase58()

      let keyMeta = keyMetaMap.get(address)

      if (keyMeta === undefined) {
        keyMeta = {
          isSigner: false,
          isWritable: false,
          isInvoked: false
        }

        keyMetaMap.set(address, keyMeta)
      }

      return keyMeta
    }
  }

  getMessageComponents () {
    const mapEntries = [...this.keyMetaMap.entries()]

    if (mapEntries.length > 256) {
      throw new Error('Max static account keys length exceeded')
    }

    const writableSigners = mapEntries.filter(([, meta]) => meta.isSigner && meta.isWritable)
    const readonlySigners = mapEntries.filter(([, meta]) => meta.isSigner && !meta.isWritable)
    const writableNonSigners = mapEntries.filter(([, meta]) => !meta.isSigner && meta.isWritable)
    const readonlyNonSigners = mapEntries.filter(([, meta]) => !meta.isSigner && !meta.isWritable)

    const header = {
      numRequiredSignatures: writableSigners.length + readonlySigners.length,
      numReadonlySignedAccounts: readonlySigners.length,
      numReadonlyUnsignedAccounts: readonlyNonSigners.length
    }

    if (writableSigners.length <= 0) {
      throw new Error('Expected at least one writable signer key')
    }

    const [payerAddress] = writableSigners[0]

    if (payerAddress !== this.payer.toBase58()) {
      throw new Error('Expected first writable signer key to be the fee payer')
    }

    const staticAccountKeys = [
      ...writableSigners.map(([address]) => new PublicKey(address)),
      ...readonlySigners.map(([address]) => new PublicKey(address)),
      ...writableNonSigners.map(([address]) => new PublicKey(address)),
      ...readonlyNonSigners.map(([address]) => new PublicKey(address))
    ]

    return [header, staticAccountKeys]
  }
}

function maybeDefaultModule (mod) {
  return mod.default ? mod.default : mod
}
