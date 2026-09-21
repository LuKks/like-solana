// Based on https://github.com/solana-foundation/solana-web3.js/tree/maintenance/v1.x/src/message

const PublicKey = require('solana-public-key')
const BufferLayout = require('@solana/buffer-layout')
const bs58 = maybeDefaultModule(require('bs58'))

const shortvec = require('./short-vector-encoding.js')
const { CompiledKeys, MessageAccountKeys } = require('./message.js')

const PACKET_DATA_SIZE = 1280 - 40 - 8 // IPv6 minimum MTU - headers
const MESSAGE_VERSION_0_PREFIX = 1 << 7

module.exports = class MessageV0 {
  constructor (opts = {}) {
    this.header = opts.header
    this.staticAccountKeys = opts.staticAccountKeys.map(account => new PublicKey(account))
    this.recentBlockhash = opts.recentBlockhash
    this.instructions = opts.instructions
    this.addressTableLookups = opts.addressTableLookups || []
  }

  get version () {
    return 0
  }

  get numAccountKeysFromLookups () {
    let count = 0

    for (const lookup of this.addressTableLookups) {
      count += lookup.readonlyIndexes.length + lookup.writableIndexes.length
    }

    return count
  }

  get compiledInstructions () {
    return this.instructions.map(ix => ({
      programIdIndex: ix.programIdIndex,
      accountKeyIndexes: ix.accounts,
      data: bs58.decode(ix.data)
    }))
  }

  getAccountKeys (lookupTable) {
    let accountKeysFromLookups = null

    if (lookupTable) {
      accountKeysFromLookups = this.resolveAddressTableLookups(lookupTable)
    } else if (this.addressTableLookups.length > 0) {
      throw new Error('Failed to get account keys because address table lookups were not resolved')
    }

    return new MessageAccountKeys(this.staticAccountKeys, accountKeysFromLookups)
  }

  isAccountSigner (index) {
    return index < this.header.numRequiredSignatures
  }

  isAccountWritable (index) {
    const numSignedAccounts = this.header.numRequiredSignatures
    const numStaticAccountKeys = this.staticAccountKeys.length

    if (index >= numStaticAccountKeys) {
      const lookupAccountKeysIndex = index - numStaticAccountKeys
      const numWritableLookupAccountKeys = this.addressTableLookups.reduce((count, lookup) => count + lookup.writableIndexes.length, 0)

      return lookupAccountKeysIndex < numWritableLookupAccountKeys
    }

    if (index >= numSignedAccounts) {
      const unsignedAccountIndex = index - numSignedAccounts
      const numUnsignedAccounts = numStaticAccountKeys - numSignedAccounts
      const numWritableUnsignedAccounts = numUnsignedAccounts - this.header.numReadonlyUnsignedAccounts

      return unsignedAccountIndex < numWritableUnsignedAccounts
    }

    const numWritableSignedAccounts = numSignedAccounts - this.header.numReadonlySignedAccounts

    return index < numWritableSignedAccounts
  }

  resolveAddressTableLookups (lookupTable) {
    const accountKeysFromLookups = {
      writable: [],
      readonly: []
    }

    for (const tableLookup of this.addressTableLookups) {
      const tableAccount = lookupTable.find(account => account.key.equals(tableLookup.accountKey))

      if (!tableAccount) {
        throw new Error('Failed to find address lookup table account for table key ' + tableLookup.accountKey.toBase58())
      }

      for (const index of tableLookup.writableIndexes) {
        if (index < tableAccount.state.addresses.length) {
          accountKeysFromLookups.writable.push(tableAccount.state.addresses[index])
        } else {
          throw new Error('Failed to find address for index ' + index + ' in address lookup table ' + tableLookup.accountKey.toBase58())
        }
      }

      for (const index of tableLookup.readonlyIndexes) {
        if (index < tableAccount.state.addresses.length) {
          accountKeysFromLookups.readonly.push(tableAccount.state.addresses[index])
        } else {
          throw new Error('Failed to find address for index ' + index + ' in address lookup table ' + tableLookup.accountKey.toBase58())
        }
      }
    }

    return accountKeysFromLookups
  }

  static compile (args) {
    const compiledKeys = CompiledKeys.compile(args.instructions, args.payerKey)

    const addressTableLookups = []
    const accountKeysFromLookups = {
      writable: [],
      readonly: []
    }

    const lookupTableAccounts = args.lookupTable || []

    for (const lookupTable of Array.isArray(lookupTableAccounts) ? lookupTableAccounts : [lookupTableAccounts]) {
      const extractResult = compiledKeys.extractTableLookup(lookupTable)

      if (extractResult !== null) {
        const [addressTableLookup, keysFromLookup] = extractResult

        addressTableLookups.push(addressTableLookup)
        accountKeysFromLookups.writable.push(...keysFromLookup.writable)
        accountKeysFromLookups.readonly.push(...keysFromLookup.readonly)
      }
    }

    const [header, staticAccountKeys] = compiledKeys.getMessageComponents()
    const accountKeys = new MessageAccountKeys(staticAccountKeys, accountKeysFromLookups)
    const instructions = accountKeys.compileInstructions(args.instructions)

    return new MessageV0({
      header,
      staticAccountKeys,
      recentBlockhash: args.recentBlockhash,
      instructions: instructions.map(ix => ({
        programIdIndex: ix.programIdIndex,
        accounts: ix.accountKeyIndexes,
        data: bs58.encode(ix.data)
      })),
      addressTableLookups
    })
  }

  serialize () {
    const numKeys = this.staticAccountKeys.length
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

    const lookups = this.addressTableLookups.map(lookup => {
      const writableIndexesCount = shortvec.encodeLength(lookup.writableIndexes.length)
      const readonlyIndexesCount = shortvec.encodeLength(lookup.readonlyIndexes.length)

      return {
        accountKey: lookup.accountKey.toBuffer(),
        writableIndexesCount: Buffer.from(writableIndexesCount),
        writableIndexes: lookup.writableIndexes,
        readonlyIndexesCount: Buffer.from(readonlyIndexesCount),
        readonlyIndexes: lookup.readonlyIndexes
      }
    })

    const lookupCount = shortvec.encodeLength(lookups.length)

    let lookupBuffer = Buffer.alloc(PACKET_DATA_SIZE)

    let lookupBufferLength = 0

    for (const lookup of lookups) {
      const lookupLayout = BufferLayout.struct([
        BufferLayout.blob(32, 'accountKey'),
        BufferLayout.blob(lookup.writableIndexesCount.length, 'writableIndexesCount'),
        BufferLayout.seq(BufferLayout.u8('writableIndex'), lookup.writableIndexes.length, 'writableIndexes'),
        BufferLayout.blob(lookup.readonlyIndexesCount.length, 'readonlyIndexesCount'),
        BufferLayout.seq(BufferLayout.u8('readonlyIndex'), lookup.readonlyIndexes.length, 'readonlyIndexes')
      ])

      const length = lookupLayout.encode(lookup, lookupBuffer, lookupBufferLength)

      lookupBufferLength += length
    }

    lookupBuffer = lookupBuffer.slice(0, lookupBufferLength)

    const messageLayout = BufferLayout.struct([
      BufferLayout.u8('prefix'),
      BufferLayout.struct([
        BufferLayout.u8('numRequiredSignatures'),
        BufferLayout.u8('numReadonlySignedAccounts'),
        BufferLayout.u8('numReadonlyUnsignedAccounts')
      ], 'header'),
      BufferLayout.blob(keyCount.length, 'keyCount'),
      BufferLayout.seq(BufferLayout.blob(32, 'key'), numKeys, 'keys'),
      BufferLayout.blob(32, 'recentBlockhash'),
      BufferLayout.blob(instructionBuffer.length, 'instructions'),
      BufferLayout.blob(lookupCount.length, 'lookupCount'),
      BufferLayout.blob(lookupBuffer.length, 'lookups')
    ])

    const message = {
      prefix: MESSAGE_VERSION_0_PREFIX,
      header: {
        numRequiredSignatures: this.header.numRequiredSignatures,
        numReadonlySignedAccounts: this.header.numReadonlySignedAccounts,
        numReadonlyUnsignedAccounts: this.header.numReadonlyUnsignedAccounts
      },
      keyCount: Buffer.from(keyCount),
      keys: this.staticAccountKeys.map(key => key.toBuffer()),
      recentBlockhash: bs58.decode(this.recentBlockhash),
      instructions: instructionBuffer,
      lookupCount: Buffer.from(lookupCount),
      lookups: lookupBuffer
    }

    const signData = Buffer.alloc(2048)
    const length = messageLayout.encode(message, signData)

    return signData.slice(0, length)
  }
}

function maybeDefaultModule (mod) {
  return mod.default ? mod.default : mod
}
