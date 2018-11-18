const Protocol = require('irc-protocol')
const Cabal = require('cabal-core')
const Swarm = require('cabal-core/swarm.js')
const {promisify} = require('util')

// Expose all IRC numerics as lookup maps:
// Cmd with format:         { command: number }
const Cmd = ((numerics) => {
  return Object.keys(numerics)
  .reduce((hash, code) => {
    hash[numerics[code]] = parseInt(code)
    return hash
  }, {})
})(require('irc-protocol/numerics'))

class CabalIRC {
  constructor (storage, key, opts) {
    if (!opts) opts = {}
    debug('Initializing core @', storage, 'with key:', key)
    this.cabal = Cabal(storage, key, opts)
    this.joinedChannels = []
    this.hostname = opts.hostname || '127.0.0.1'
    this._user = null
    debug('Waiting for cabal.db.ready')
    this.cabal.db.feed((feed) => {
      debug('ready received')
      if (!key) {
        this.cabal.getLocalKey((err, key) => {
          log('Multifeed public key:')
          log(`\t\x1b[34mcabal://${key}\x1b[0m\n`)
          this._onopen(opts)
        })
      } else {
        this._onopen(opts)
      }
    })
  }

  // Before IRC client disconnects
  quit () {
    this.joinedChannels = []
    this._user.socket.end()
  }
  _write (data) {
    if (this._user && this._user.socket.writable) {
      this._user.socket.write(data)
    }
  }

  // Joins the swarm and registers cabal event handlers
  _onopen (opts) {
    if (!opts.disableSwarm) {
      debug('Joining swarm')
      this.swarm = Swarm(this.cabal)
    } else debug('Running offline-mode, not joining the swarm')

    this.cabal.on('peer-added', peer => log('CAB:peer_added', peer))
    this.cabal.on('peer-dropped', peer => log('CAB:peer_dropped', peer))

    // Register handler for new channels.
    this.cabal.channels.events.on('add', channel => this._onChannelAdd(channel))
    // Register handler for new messages
    this.cabal.messages.events.on('message', msg => this._onMessageAdd(msg))
    // Register handler for topic changes
    // this.cabal.topics.events.on('update', msg => this._onTopicUpdate)
  }

  // Unused, topics seem to be emitted as regular messages on the cabal.message view.
  _onTopicUpdate (msg) {
    let topic = msg.value.content.topic
  }

  _onChannelAdd (channel) {
    if (this._user) this._joinChannel(this._user)
  }

  // cabal on 'message' event handler
  _onMessageAdd (msg) {
    // Don't echo our own newly-published mmessages
    // (that's what recap takes care of)
    if (msg.key !== this.cabal.key) this._echoMessage(msg)
  }

  // Writes a message to IRC client.
  _echoMessage (message) {
    if (!this._user) return

    if (['chat/text', 'chat/topic'].indexOf(message.value.type) === -1) {
      console.log('Unsupported message received', message)
      return
    }
    let channel = message.value.content.channel
    // use internal joinedChannels register to figure out if this channel is previously
    // known to the irc-client;
    return Promise.resolve(this.joinedChannels.indexOf(channel) !== -1)
      .then((isKnown) => { //  if not then send them a join before the message.
        if (!isKnown) return this._joinChannel(channel)
      })
      .then(() => { // WHOIS core
        return new Promise((resolve, reject) => {
          this.cabal.users.get(message.key, (err, res) => {
            if (!err) {
              resolve(res)
            } else if(err && err.type === 'NotFoundError') {
              // I think this error is caused when trying to look up
              // user-info for a core that has never registered a nickname.
              // Either way, if a lookup fails, it's handeled in next chain-link.
              resolve()
            } else {
              log("Failed looking up user:\n", err)
            }
          })
        })
      })
    .then(uinfo => { // Extract Nickname.
      if (uinfo) {
        return uinfo.name
      } else {
        return message.key.slice(0,10) // Gain some readability at the cost of entropy.
      }
    })
    .then(from => { // Write to socket.
      if (message.value.type === 'chat/text') {
        this._write(`:${from}!cabalist@${this.hostname} PRIVMSG #${channel} :${message.value.content.text}\r\n`)
      } else if (message.value.type === 'chat/topic') {
        this._write(`:${from}!cabalist@${this.hostname} TOPIC #${channel} :${message.value.content.text}\r\n`)
      }
    })
    .catch(err => {
      log("Failed writing message to client:\n",err)
    })
  }

  /* Sends the 'join' channel commands to the client
   * and a complete list of all connected users. */
  _joinChannel (channel) {
    return new Promise((resolve, reject) => {
      this.cabal.topics.get(channel, (err, topic) => {
        if (err && err.type === 'NotFoundError') {
          topic = ''
        } else if (err) throw err

        this.cabal.users.getAll((err, users)=>{
          if (err) {
            log('Failed fetchng userlist\n', err)
            return reject(err)
          }

          // Some irc-clients rejoin on reconnection faster than
          // our _forceJoin causing duplicate channel listings.
          if (this.joinedChannels.indexOf(channel) !== -1) return resolve(false)

          this._write(`:${this._user.nick}!cabalist@${this.hostname} JOIN #${channel} \r\n`)
          this._write(`:${this.hostname} ${Cmd.RPL_TOPIC} ${this._user.nick} #${channel} :${topic}\r\n`)

          // TODO: filter online
          let nicks = Object.values(users)
            .map(u => u.name || u.key.slice(0,10))
            .join(' ')

          this._write(`:${this.hostname} ${Cmd.RPL_NAMREPLY} ${this._user.nick} = #${channel} :${nicks} \r\n`)
          this._write(`:${this.hostname} ${Cmd.RPL_ENDOFNAMES} ${this._user.nick} #${channel} :End of /NAMES list.\r\n`)
          resolve(true)
        })
      })
    })
      .then((joined) => { // Mark channel as joined.
        if (joined) this.joinedChannels.push(channel)
        return joined
      })
      .catch(err => log(`Failed joining channel ${channel}\n`, err))
  }

  // Forces connected client to join all available channels since from what
  // I can see, cabal does not support subscription to individual channels yet.
  _forceJoin () {
    return promisify(this.cabal.channels.get)()
      .then(channels => {
        return channels.reduce((chain, channel) => {
          return chain.then(() => {
            return this._joinChannel(channel)
          })
        }, Promise.resolve())
      })
      .catch(err => log('Failed during _forceJoin\n', err))
  }

  _recapMessages () {
    return promisify(this.cabal.channels.get)()
      .then(channels => {
        // TODO: Move this opt, better place if useful
        const mLimit = 100
        let messages = []

        channels.forEach(channel => {
          // TODO: Add relative filter to limit the amount
          // of data that the recap will send.
          // Or limit to message count but then we'll have to use
          // the let messages = []; and messages.unshift() pattern
          // again if we want support m-count limits.


          let mio = this.cabal.messages.read(channel, {
            reverse: mLimit > 0 // (Count the limit from the newest messages)
          })

          mio.on('data', message => {
            if(mLimit > 0 && messages.length < mLimit) {
              messages.unshift(message)
            } else {
              this._echoMessage(message)
            }
          })

          mio.on('end', () => {
            messages.forEach(m => this._echoMessage(m))
            log('Recamp complete for', channel)
            // TODO: maybe send a 'recap #channel complete from [DATE]' - message
            // to client. I haven't figured out if there is a way to pass the real
            // timestamps in the irc-protocol.
          })
        })
      })
      .catch(err => log("Failed recapping messages:\n", err))
  }

  // Identity change and also Step 1 of IRC handshake
  nick ([nick]) {
    this.cabal.publishNick(nick, (err) => {
      if (err) {
        log('Failed to publish nick\n', err)
        this.write(`:${this.hostname} ${Cmd.ERR_NICKNAMEINUSE} ${this._user.nick} ${nick} :${err.type}`)
      } else {
        // Nick-change successfull.
        this._write(`:${this._user.nick}!cabalist@${this.hostname} NICK :${nick}\r\n`)
        // So the nick-change message must specify :(old-nick!idstring) NICK :(new-nick)
        // Thus were updating the _user object only after we've sent the command.
        this._user.nick = nick
      }
    })
  }

  // Step 2 of IRC handshake
  user (parameters) {
    this._user.username = parameters[0]
    this._user.realname = parameters[3]
    // Send welcome
    this._write(`:${this.hostname} ${Cmd.WELCOME} ${this._user.nick} :Welcome to cabal!\r\n`)
    // Send motd
    this._write(`:${this.hostname} ${Cmd.RPL_MOTDSTART} ${this._user.nick} :- ${this.hostname} Message of the day - \r\n`)
    // TODO: use a plaintext file instead and loop-send each line.
    this._write(`:${this.hostname} ${Cmd.RPL_MOTD} ${this._user.nick} :- Cabal-irc gateway                       -\r\n`)
    this._write(`:${this.hostname} ${Cmd.RPL_MOTD} ${this._user.nick} :- Enjoy using your favourite IRC-software -\r\n`)
    this._write(`:${this.hostname} ${Cmd.RPL_MOTD} ${this._user.nick} :- on the decentralized Cabal network      -\r\n`)
    this._write(`:${this.hostname} ${Cmd.RPL_ENDOFMOTD} ${this._user.nick} :End of MOTD command\r\n`)
    this._forceJoin()
      .then(() => new Promise(done => setTimeout(done, 1000))) // Let the client catch it's breath before recap.
      .then(() => this._recapMessages())
  }

  ping (parameters) {
    this._write(`:${this.hostname} PONG ${this.hostname} :` + parameters[0] + '\r\n')
  }

  part (message) {
    log(message)
  }

  privmsg ([channel, text]) {
    channel = channel.replace(/^#/,'')
    this.cabal.publish({
      type: 'chat/text',
      content: { text, channel }
    },{}, (err, message) => {
      if (err) log("Failed publishing message", err)
    })
  }


  whois (parameters) {
    let nick = parameters[0]
    return
    let target = this.users[nick]
    if (!target) {
      this._write(`:${this.hostname} ${Cmd.ERR_NOSUCHNICK} ` + this._user.nick + ` ` + nick + ` :No such nick/channel\r\n`)
      return
    }
    this._write(`:${this.hostname} ${Cmd.RPL_WHOISUSER} ` + this._user.nick + ` ` + target.nick + ` ` + target.username + ` fakeaddr * :` + target.realname + `\r\n`)
    this._write(`:${this.hostname} ${Cmd.RPL_ENDOFWHOIS} ` + this._user.nick + ` :End of WHOIS list\r\n`)
  }

  mode (parameters) {
    // Pacifier/Dummy always returns +ns modes to the client.
    let channel = parameters[0]
    this._write(`:${this.hostname} ${Cmd.RPL_UMODEIS} #${channel} +ns\r\n`)
  }


  list (parameters) {
    this.cabal.channels.get((err, channels) => {
      this._write(`:${this.hostname} ${Cmd.RPL_LISTSTART} ${this._user.nick} Channel :Users  Name\r\n`)
      channels
        .map(ch => ({name: ch, users: '-1', topic: ''}))
        .forEach(channel => {
        this._write(`:${this.hostname} ${Cmd.RPL_LIST} ${this._user.nick} #${channel.name} ${channel.users} :${channel.topic}\r\n`)
      })
      this._write(`:${this.hostname} ${Cmd.RPL_LISTEND} ${this._user.nick} :End of /LIST"\r\n`)
    })
  }
  cap (parameters) {
    // We do not provide any extended capabilities that i know of.
    // responding as instructed in:
    this._write(`CAP * LIST :`)
  }

  join ([channels]) {
    channels.split(',')
    .map(c => c.replace(/^#/,''))
    .reduce((chain, channel) => {
      return chain.then(() => this._joinChannel(channel))
    }, Promise.resolve())
  }

  topic ([channel, topic]) {
    channel = channel.replace(/^#/, '')
    this.cabal.publishChannelTopic(channel, topic, (err) => {
      if (err) throw err
      this._write(`:${this.hostname} ${Cmd.RPL_TOPIC} ${this._user.nick} #${channel} :${topic}\r\n`)
    })
  }

  // The incoming connection handler
  listen (socket) {
    this.cabal.users.get(this.cabal.key, (err, nick) => {
      if(err && err.type !== 'NotFoundError') {
        log("Failed looking up user:\n", err)
      }
      const user = {
        name: socket.remoteAddress + ':' + socket.remotePort,
        socket,
        nick: nick ? nick.name : this.cabal.key.slice(0, 10)
      }
      user.username = user.nick
      user.realname = user.nick

      // If a user is already connected,
      // then disconnect that previous one and
      // set the new one as active.
      if (this._user) {
        this.quit()
      }

      this._user = user

      let parser = new Protocol.Parser()
      socket.pipe(parser)
      parser.on('readable', () => {
        let message
        while ((message = parser.read()) !== null) {
          let cmd = message.command.toLowerCase()
          // log(message)
          let fn = this[cmd]
          if (!fn) this.notImplemented(message)
          else fn.apply(this, [message.parameters])
        }
      })
    })
  }

  notImplemented (message) {
    console.error('not implemented', message.command, message.parameters)
    // Produces garbage
    // user.socket.write(`:${this.hostname} ${Cmd.ERR_UNKNOWNCOMMAND} ${cmd} :Command not implemented"\r\n`)
  }
}

module.exports = CabalIRC

// methodize the logging.
let log = function (...args) {
  let t = new Date()
  let timestamp = [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map(i=> i.toString().padStart(2,'0'))
    .join(':')
  console.log.apply(null,[timestamp, ...args])
}

let debug = function (...args) {
  if (process.env['DEBUG']) {
    console.debug.apply(null, ['DEBUG:',...args])
  }
}
