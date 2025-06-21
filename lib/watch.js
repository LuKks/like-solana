const EventParser = require('solana-event-parser')
const Borsh = require('borsh-encoding')

module.exports = class SolanaWatch {
  constructor (rpc, subscribe, callback, programs) {
    this.rpc = rpc
    this.subscribe = subscribe
    this.callback = callback
    this.programs = programs || []
    this.eventParsers = []

    // TODO: Improve solana-event-parser to parse multiple programs at the same time
    for (const program of this.programs) {
      this.eventParsers.push(new EventParser(new Borsh(program.idl), program.address))
    }

    this.queue = []
    this.isQueueProcessing = false

    this.closing = false

    this.rpc.socket.on('message', this._onMessage.bind(this))
    this.rpc.socket.on('disconnect', this._onDisconnect.bind(this))
  }

  async close () {
    if (this.closing) {
      return
    }

    this.closing = true

    await this.rpc.disconnect()
  }

  async connect () {
    if (this.closing) {
      return
    }

    await this.rpc.connect()

    if (this.subscribe.logs) {
      for (const mentions of this.subscribe.logs) {
        await this.rpc.logsSubscribe(mentions.toString())
      }
    }

    // TODO
    /* if (this.subscribe.block) {
      let id = null

      for await (const backoff of retry({ max: 5 })) {
        try {
          // TODO: Add to RPC like logsSubscribe
          id = await this.rpc.send('blockSubscribe', [
            this.subscribe.block === 'all'
              ? 'all'
              : {
                  mentionsAccountOrProgram: this.subscribe.block
                },
            {
              commitment: 'confirmed',
              encoding: 'jsonParsed',
              transactionDetails: 'full',
              maxSupportedTransactionVersion: 0,
              showRewards: true
            }
          ])
        } catch (err) {
          if (err.code === -32602) {
            await backoff(err)
            continue
          }

          throw err
        }

        if (!id) {
          await backoff(new Error('Failed to subscribe'))
          continue
        }

        break
      }
    } */
  }

  async _onDisconnect () {
    if (this.closing) {
      return
    }

    // TODO
    console.error('Reconnecting...')

    this.connect().catch(console.error)
  }

  _onMessage (data) {
    if (data && data.method === 'logsNotification') {
      this._addLogToQueue(data).catch(console.error)
    }

    if (data && data.method === 'blockNotification') {
      this._addLogToQueue(data).catch(console.error)
    }
  }

  async _addLogToQueue (data) {
    this.queue.push({ method: data.method, slot: data.params.result.context.slot, value: data.params.result.value })

    if (this.isQueueProcessing) {
      return
    }

    this.isQueueProcessing = true

    while (this.queue.length) {
      const item = this.queue.shift()

      if (item.method === 'logsNotification') {
        await this._onLog(item.value, item.slot).catch(console.error)
      }
    }

    this.isQueueProcessing = false
  }

  async _onLog (value) {
    if (value.err) {
      return
    }

    const events = []

    for (const eventParser of this.eventParsers) {
      const parsed = eventParser.parse(value.logs)

      for (const evt of parsed) {
        events.push(evt)
      }
    }

    try {
      await this.callback(events, value)
    } catch (err) {
      console.error(err)
    }
  }
}
