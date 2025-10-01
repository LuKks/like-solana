const fs = require('fs')
const test = require('brittle')
const dotenv = require('dotenv')
const Solanas = require('solanas')
const SOL = require('./index.js')

dotenv.config({ path: require('os').homedir() + '/.env' })

test('basic', async function (t) {
  const rpc = new SOL.RPC()
  const user = new SOL.Keypair(process.env.WALLET_SECRET_KEY)

  const latest = await rpc.getLatestBlockhash()

  const ixTransfer = SOL.SystemProgram.transfer({
    fromPubkey: user.publicKey,
    toPubkey: user.publicKey,
    lamports: 0.0001337 * 1e9
  })

  const tx = SOL.sign(ixTransfer, { signers: [user], recentBlockhash: latest.blockhash })

  t.comment(SOL.signature(tx))

  const signature = await rpc.sendTransaction(tx, { confirmed: true })

  t.is(signature, SOL.signature(tx))
})

test('transact', async function (t) {
  const sol = new SOL({ key: process.env.WALLET_SECRET_KEY })

  const ixTransfer = SOL.SystemProgram.transfer({
    fromPubkey: sol.keyPair.publicKey,
    toPubkey: sol.keyPair.publicKey,
    lamports: 0.0001337 * 1e9
  })

  const signature = await sol.transact(ixTransfer, { confirmed: true })

  t.comment(signature)
})

test('transfer', async function (t) {
  const sol = new SOL({ key: process.env.WALLET_SECRET_KEY })

  const sig = await sol.transfer(sol.keyPair.publicKey, sol.keyPair.publicKey, 0.0001337, { transact: { confirmed: true } })

  t.comment(sig)
})

test('wrap and unwrap WSOL', async function (t) {
  const sol = new SOL({ key: process.env.WALLET_SECRET_KEY })

  const sig1 = await sol.wrap(0.0001337, { transact: { confirmed: true } })

  t.comment(sig1)

  const sig2 = await sol.unwrap({ transact: { confirmed: true } })

  t.comment(sig2)
})

test.skip('safe key pair', async function (t) {
  const secureKey = await fs.promises.readFile('/Users/lucas/.solanas/keys/lucas.xkey', 'utf8')
  const keyPair = await Solanas.open(secureKey)

  t.comment(keyPair.publicKey)

  const sol = new SOL({ keyPair })

  const sig = await sol.transfer(sol.keyPair.publicKey, sol.keyPair.publicKey, 0.0001337, { transact: { confirmed: true } })

  t.comment(sig)
})
