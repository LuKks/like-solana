# like-solana

Simple Solana for Node.js

```
npm i like-solana
```

Need support? Join the community: https://lucasbarrena.com

## Usage

```js
const SOL = require('like-solana')

const rpc = new SOL.RPC()
const user = new SOL.Keypair('<secret key...>')

const recentBlockhash = (await rpc.getLatestBlockhash()).blockhash

const ixTransfer = SOL.SystemProgram.transfer({
  fromPubkey: user.publicKey,
  toPubkey: user.publicKey,
  lamports: 0.0001337 * 1e9
})

const tx = SOL.sign(ixTransfer, { unitPrice: 0.0001, signers: [user], recentBlockhash })

const signature = await rpc.sendTransaction(tx)

console.log(signature)
```

## API (static)

#### `rpc = new SOL.Keypair([seed])`

Generates or re-create a key pair from a seed.

Seed can be a String (base58), Buffer, or Uint8Array.

Seed can have both secret and public key or just the secret key.

Returns:

```js
{
  publicKey, // PublicKey instance
  secretKey // Uint8Array
}
```

See `solana-crypto` for more detailed documentation on cryptography.

#### `publicKey = new SOL.PublicKey(input)`

Creates a PublicKey instance from an input.

Input can be a String (base58), Buffer, Uint8Array, or PublicKey.

`publicKey.toString()` returns it encoded as base58 string.

See `solana-public-key` for more detailed documentation on public keys and program-derived addresses.

#### `rpc = new SOL.RPC([options])`

Creates a new RPC instance to interact with the network.

Options:

```js
{
  url: 'https://solana-rpc.publicnode.com',
  ws: 'wss://solana-rpc.publicnode.com',
  commitment: 'finalized'
}
```

See `solana-rpc` for more detailed documentation on networking.

#### `tx = SOL.sign(instructions, options)`

Sign a transaction.

Options:

```js
{
  unitLimit: Number,
  unitPrice: Number, // E.g. 0.0001
  tip: Object, // E.g. { account, amount: 0.0001 }
  recentBlockhash: String,
  signers: Array, // Key pairs used to sign
  payer: String // Fee payer, uses first signer by default
}
```

Notice: Not compatible with versioned transactions for now.

#### `txEncoded = SOL.toBase64(transaction)`

Serialize a transaction into base64.

#### `signature = SOL.signature(transaction)`

Get the signature from a transaction (object or base64).

## More

TODO: Missing docs for these

#### `SOL.Transaction`
#### `SOL.TransactionInstruction`

`solana-transaction-instruction`

#### `SOL.SystemProgram`

`solana-system-program`

#### `SOL.ComputeBudgetProgram`

`solana-compute-budget-program`

#### `SOL.TokenProgram`

`solana-token-program`

#### `SOL.SYSTEM_PROGRAM_ID`
#### `SOL.SYSVAR_RENT_PUBKEY`
#### `SOL.NATIVE_MINT`

#### `SOL.TOKEN_PROGRAM_ID`
#### `SOL.ASSOCIATED_TOKEN_PROGRAM_ID`

## License

MIT
