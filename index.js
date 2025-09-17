const crypto = require('solana-crypto')
const PublicKey = require('solana-public-key')
const RPC = require('solana-rpc')
const Decimal = require('decimal.js')
const bs58 = maybeDefaultModule(require('bs58'))

const Transaction = require('./lib/transaction.js')
const TransactionInstruction = require('solana-transaction-instruction')

const SystemProgram = require('solana-system-program')
const ComputeBudgetProgram = require('solana-compute-budget-program')
const TokenProgram = require('solana-token-program')

const RecentBlockhash = require('./lib/recent-blockhash.js')
const Watch = require('./lib/watch.js')

module.exports = class Solana {
  constructor (opts = {}) {
    // Compat options, was just internal usage will be removed sooner or later
    if (opts && opts.socket) {
      opts = { rpc: opts }
    }

    this.rpc = opts.rpc || new RPC()
    this.keyPair = opts.keyPair || new crypto.Keypair(opts.key)
    this.recentBlockhash = opts.recentBlockhash || null
  }

  static Keypair = crypto.Keypair
  static PublicKey = PublicKey

  static RPC = RPC

  // Compat
  static Connection = RPC
  static clusterApiUrl = RPC.clusterApiUrl

  static Transaction = Transaction
  static TransactionInstruction = TransactionInstruction

  static SystemProgram = SystemProgram
  static ComputeBudgetProgram = ComputeBudgetProgram
  static TokenProgram = TokenProgram

  static SYSTEM_PROGRAM_ID = SystemProgram.SYSTEM_PROGRAM_ID
  static SYSVAR_RENT_PUBKEY = new PublicKey('SysvarRent111111111111111111111111111111111')
  static NATIVE_MINT = new PublicKey('So11111111111111111111111111111111111111112')

  static TOKEN_PROGRAM_ID = TokenProgram.TOKEN_PROGRAM_ID
  static ASSOCIATED_TOKEN_PROGRAM_ID = TokenProgram.ASSOCIATED_TOKEN_PROGRAM_ID

  static LAMPORTS_PER_SOL = 1e9

  static RecentBlockhash = RecentBlockhash
  static Watch = Watch

  static sign (transaction, opts = {}) {
    const tx = new Transaction()

    const payer = new PublicKey(opts.payer || opts.signers[0].publicKey)

    if (opts.unitLimit) {
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: opts.unitLimit }))
    }

    if (opts.unitPrice) {
      tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.ceil(opts.unitPrice * 1e9) }))
    }

    const txs = Array.isArray(transaction) ? transaction : [transaction]

    for (const t of txs) {
      tx.add(t)
    }

    if (opts.tip || opts.jitoTip) {
      // TODO: Remove jitoTip later, compat for now
      const tip = opts.tip || opts.jitoTip

      tx.add(SystemProgram.transfer({
        fromPubkey: payer,
        toPubkey: new PublicKey(tip.account),
        lamports: Math.ceil(tip.amount * 1e9)
      }))
    }

    if (opts.legacy !== false) {
      tx.feePayer = payer
      tx.recentBlockhash = typeof opts.recentBlockhash === 'string' ? opts.recentBlockhash : opts.recentBlockhash.toString()
    } else {
      throw new Error('Versioned transaction not supported')

      // TODO
      /* const messageV0 = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: opts.recentBlockhash,
        instructions: tx.instructions
      }).compileToV0Message()

      tx = new VersionedTransaction(messageV0) */
    }

    // TODO
    const signers = []

    for (const t of txs) {
      if (t.signers) {
        signers.push(...t.signers)
      }
    }

    if (opts.signers) {
      signers.push(...opts.signers)
    }

    if (opts.legacy !== false) {
      tx.sign(...signers)
    } else {
      throw new Error('Versioned transaction not supported')

      // TODO
      // tx.sign(signers)
    }

    return tx
  }

  // Compat, remove later
  static toAmount (units, decimals) {
    return toAmount(units, decimals)
  }

  static toFormat (units, decimals) {
    return toAmount(units, decimals)
  }

  static toUnits (amount, decimals) {
    return toUnits(amount, decimals)
  }

  static toBase64 (transaction) {
    const serializedTransaction = transaction.serialize()
    const encodedTransaction = Buffer.from(serializedTransaction).toString('base64')

    return encodedTransaction
  }

  static signature (transaction) {
    const encoded = maybeEncodeTransaction(transaction)

    return bs58.encode(Buffer.from(encoded, 'base64').slice(1, 65))
  }

  async getBalance (owner) {
    return this.rpc.getBalance(owner)
  }

  async getTokenBalance (owner, tokenAddress) {
    const associatedUser = TokenProgram.getAssociatedTokenAddressSync(new PublicKey(tokenAddress), new PublicKey(owner), false)
    let tokenAccount = null

    try {
      tokenAccount = await TokenProgram.getAccount(this.rpc, associatedUser)
    } catch (err) {
      if (err.toString().includes('TokenAccountNotFoundError')) {
        return 0n
      }

      throw err
    }

    return tokenAccount.amount
  }

  async getTokens (owner, opts = {}) {
    const tokenAccounts = await this.rpc.getTokenAccountsByOwner(owner, {
      programId: opts.programId || TokenProgram.TOKEN_PROGRAM_ID
    }, { encoding: 'jsonParsed' })

    return tokenAccounts.map(acc => {
      return {
        mint: acc.account.data.parsed.info.mint,
        amount: BigInt(acc.account.data.parsed.info.tokenAmount.amount),
        decimals: acc.account.data.parsed.info.tokenAmount.decimals
      }
    }).filter(token => token.amount > 0n)
  }

  async transfer (from, to, units) {
    from = new PublicKey(from)
    to = new PublicKey(to)

    if (units === Infinity) {
      const balance = await this.rpc.getBalance(from)
      const lamports = BigInt(balance) - 5000n

      if (lamports <= 0) {
        throw new Error('Balance is not enough for transfer')
      }

      units = lamports
    } else {
      units = normalizeLamports(units)
    }

    // TODO: Should transact by default

    return SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: units
    })
  }

  async transact (tx, opts = {}) {
    const recentBlockhash = opts.recentBlockhash || this.recentBlockhash || (await this.rpc.getLatestBlockhash()).blockhash
    const signers = opts.signers || (Array.isArray(opts.keyPair) ? opts.keyPair : [opts.keyPair || this.keyPair])

    const signed = Solana.sign(tx, {
      unitPrice: opts.unitPrice || 0,
      payer: opts.payer || null,
      signers,
      recentBlockhash
    })

    const signature = await this.rpc.sendTransaction(signed, {
      confirmed: opts.confirmed,
      finalized: opts.finalized
    })

    return signature
  }

  async balanceFromTransaction (signature, account) {
    const tx = await this.rpc.getTransaction(signature)

    if (tx.version !== 'legacy') {
      throw new Error('Versioned transaction not supported')
    }

    const accountIndex = tx.transaction.message.accountKeys.findIndex(accountKey => {
      if (typeof accountKey === 'object' && accountKey && accountKey.pubkey) {
        return accountKey.pubkey === account.toString()
      }

      return accountKey === account.toString()
    })

    if (accountIndex === -1) {
      throw new Error('Account not found')
    }

    const preTokenBalance = tx.meta.preTokenBalances.find(pre => pre.owner.toString() === account.toString() && pre.mint.toString() === Solana.NATIVE_MINT.toString())
    const postTokenBalance = tx.meta.postTokenBalances.find(post => post.owner.toString() === account.toString() && post.mint.toString() === Solana.NATIVE_MINT.toString())

    return {
      pre: BigInt(tx.meta.preBalances[accountIndex]),
      post: BigInt(tx.meta.postBalances[accountIndex]),
      diff: BigInt(tx.meta.postBalances[accountIndex] - tx.meta.preBalances[accountIndex]),

      preWrap: BigInt(preTokenBalance.uiTokenAmount.amount),
      postWrap: BigInt(postTokenBalance.uiTokenAmount.amount),
      diffWrap: BigInt(postTokenBalance.uiTokenAmount.amount) - BigInt(preTokenBalance.uiTokenAmount.amount)
    }
  }

  async holders (mint) {
    const programAccounts = await this.rpc.request('getProgramAccounts', [
      TokenProgram.TOKEN_PROGRAM_ID,
      {
        dataSlice: { offset: 64, length: 8 },
        filters: [
          { dataSize: 165 },
          { memcmp: { offset: 0, bytes: mint.toString() } }
        ],
        encoding: 'jsonParsed'
      }
    ])

    const accounts = programAccounts.map(acc => {
      return {
        owner: acc.account.data.parsed.info.owner,
        amount: BigInt(acc.account.data.parsed.info.tokenAmount.amount),
        decimals: acc.account.data.parsed.info.tokenAmount.decimals
      }
    }).filter(account => account.amount > 0n)

    return accounts
  }
}

function toAmount (units, decimals) {
  const d = new Decimal(units.toString())
  const amount = d.div(10 ** decimals)

  return amount.toFixed(amount.dp())
}

function toUnits (amount, decimals) {
  const d = new Decimal(amount)
  const units = d.mul(10 ** decimals)

  return units.toFixed(0)
}

function normalizeLamports (lamports) {
  if (typeof lamports === 'number') return BigInt((lamports * 1e9).toFixed(0))
  if (typeof lamports !== 'bigint') return BigInt(lamports)
  return lamports
}

function maybeEncodeTransaction (tx) {
  if (typeof tx === 'object' && tx && tx.serialize) {
    const serialized = tx.serialize()
    const encoded = Buffer.from(serialized).toString('base64')

    return encoded
  }

  return tx
}

function maybeDefaultModule (mod) {
  return mod.default ? mod.default : mod
}
