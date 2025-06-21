module.exports = class SolanaRecentBlockhash {
  constructor (rpc) {
    this.rpc = rpc
    this.interval = null

    this.recentBlockhash = null

    this.opened = false
    this.opening = this.ready()
    this.opening.then(() => {
      this.opened = true
    })
    this.opening.catch(noop)
  }

  async ready () {
    if (this.opening) return this.opening

    const latest = await this.rpc.getLatestBlockhash()

    this.recentBlockhash = latest.blockhash

    this.interval = setInterval(this._onInterval.bind(this), 15000)
  }

  async close () {
    if (this.opened === false) await this.opening.catch(noop)

    clearInterval(this.interval)
  }

  toString () {
    return this.recentBlockhash
  }

  toJSON () {
    return this.recentBlockhash
  }

  async _onInterval () {
    try {
      const latest = await this.rpc.getLatestBlockhash()

      this.recentBlockhash = latest.blockhash
    } catch (err) {
      console.error(err)
    }
  }
}

function noop () {}
