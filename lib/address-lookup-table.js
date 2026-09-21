// Based on https://github.com/solana-foundation/solana-web3.js/tree/maintenance/v1.x/src/programs/address-lookup-table

const PublicKey = require('solana-public-key')

// The serialized size of lookup table metadata
const LOOKUP_TABLE_META_SIZE = 56

module.exports = class AddressLookupTableAccount {
  constructor (opts = {}) {
    this.key = opts.key
    this.state = opts.state
  }

  isActive () {
    return this.state.deactivationSlot === 18446744073709551615n
  }

  static async load (rpc, address) {
    const account = await rpc.getAccountInfo(address.toString())

    if (!account) {
      throw new Error('Address lookup table not found: ' + address.toString())
    }

    return new AddressLookupTableAccount({
      key: new PublicKey(address),
      state: this.deserialize(account.data)
    })
  }

  static deserialize (accountData) {
    if (accountData.length < LOOKUP_TABLE_META_SIZE) {
      throw new Error('lookup table is invalid')
    }

    const typeIndex = accountData.readUInt32LE(0)

    if (typeIndex !== 1) {
      throw new Error('lookup table is invalid')
    }

    const authorityOption = accountData.readUInt8(21)
    const authorityStart = 22

    const serializedAddressesLength = accountData.length - LOOKUP_TABLE_META_SIZE

    if (serializedAddressesLength < 0 || serializedAddressesLength % 32 !== 0) {
      throw new Error('lookup table is invalid')
    }

    const numSerializedAddresses = serializedAddressesLength / 32
    const addresses = []

    for (let i = 0; i < numSerializedAddresses; i++) {
      const start = LOOKUP_TABLE_META_SIZE + i * 32
      const end = start + 32

      addresses.push(new PublicKey(accountData.slice(start, end)))
    }

    return {
      deactivationSlot: accountData.readBigUInt64LE(4),
      lastExtendedSlot: Number(accountData.readBigUInt64LE(12)),
      lastExtendedSlotStartIndex: accountData.readUInt8(20),
      authority: authorityOption !== 0 ? new PublicKey(accountData.slice(authorityStart, authorityStart + 32)) : null,
      addresses
    }
  }
}
