const test = require('brittle')
const dotenv = require('dotenv')
const SOL = require('./index.js')

dotenv.config({ path: require('os').homedir() + '/.env' })

test('basic', async function (t) {
  const rpc = new SOL.RPC({ commitment: 'processed' })
  const user = new SOL.Keypair(process.env.WALLET_SECRET_KEY)

  const latest = await rpc.getLatestBlockhash()

  const ixTransfer = SOL.SystemProgram.transfer({
    fromPubkey: user.publicKey,
    toPubkey: user.publicKey,
    lamports: 0.0001337 * 1e9
  })

  const tx = SOL.sign(ixTransfer, { unitPrice: 0, signers: [user], recentBlockhash: latest.blockhash })

  t.comment(SOL.signature(tx))

  const signature = await rpc.sendTransaction(tx, { confirmed: true })

  console.log(signature)
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

test('sol balance change', async function (t) {
  const sol = new SOL()

  const signature = 'cwmoaZdjHtAWnuhUa9T8ykgn3SAQRRRdJEfAfminnmRxqugA9wEpQ4gQosDs4MnUyMXqVbviFgbYc71jHNJGAYy'
  const account = 'J7UjDnNnvsBMY1c1JiAzwVjGnFaqdSZHYpmpHfMwDncg'

  const balance = await sol.balanceFromTransaction(signature, account)

  t.alike(balance, { pre: 271287074n, post: 21207074n, diff: -250080000n })
})

test('get holders', async function (t) {
  const sol = new SOL()

  console.log(await sol.holders('2fWkVf417bfxEgUemymkYNagXVitnmNxvq7dhUwnpump'))
})
