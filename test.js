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
