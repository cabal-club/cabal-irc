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
    this.cabal.channels.events.on('add', channel => this._channelAdd(channel))
    // Register handler for new messages
    this.cabal.messages.events.on('message', msg => this._messageAdd(msg))
  }

  _channelAdd (channel) {
    debug('CAB:channel_add', channel)
    if (this._user) this._forceJoin(this._user)
  }

  // cabal on 'message' event handler
  _messageAdd (msg) {
    debug('CAB:messag_glob', msg)
    // TODO: when receiving a message
    // from a new channel we have to send 'join' command to the
    // user.
    this._echoMessage(msg)
  }

  // Writes a message to IRC client.
  _echoMessage (message) {
    if (!this._user) return
    if (message.value.type !== 'chat/text') {
      console.log('Unsupported message received', message)
      return
    }

    return new Promise((resolve, reject) => {
      this.cabal.users.get(message.key, (err, res) => {
        if (!err) {
          resolve(res)
        } else if(err && err.type === 'NotFoundError') {
          // This might be unecessary, but i think you
          // but i think this error is caused when trying to look up
          // user-info for a core that has never registered a nickname.
          // Either way, if a lookup fails, it's handeled in next chain-link.
          resolve()
        } else {
          log("Failed looking up user:\n", err)
        }
      })
    })
    .then(uinfo => {
      if (uinfo) {
        return uinfo.name
      } else {
        return message.key.slice(0,10) // Gain some readability at the cost of entropy.
      }
    })
    .then(from => {
      let channel = message.value.content.channel // What does a cabal private look like?
      let out = `:${from}!cabalist@${this.hostname} PRIVMSG #${channel} :${message.value.content.text}\r\n`
      // log(out)
      this._write(out)
    })
    .catch(err => {
      log("Failed writing message to client:\n",err)
    })
  }

  // Forces connected client to join all available channels since from what
  // I can see, cabal does not support subscription to individual channels yet.
  _forceJoin () {
    return Promise.all([
      // All users are on all channels.
      promisify(this.cabal.users.getAll)(),
      promisify(this.cabal.channels.get)()
    ])
      .then(([users, channels]) =>  {
        channels.forEach(channel => {
          this._write(`:${this._user.nick}!cabalist@${this.hostname} JOIN #${channel} \r\n`)
          this._write(`:${this.hostname} ${Cmd.RPL_TOPIC} ${this._user.nick} #${channel} :TODO TOPIC\r\n`)
          let nicks = Object.values(users)
            .map(u => u.name || u.key.substr(0,8))
            .join(' ')
          this._write(`:${this.hostname} ${Cmd.RPL_NAMREPLY} ${this._user.nick} = #${channel} :${nicks} \r\n`)
          this._write(`:${this.hostname} ${Cmd.RPL_ENDOFNAMES} ${this._user.nick} #${channel} :End of /NAMES list.\r\n`)
        })
      })
      .catch(err => log("Failed joining channel\n", err))
  }

  _recapMessages () {
    return promisify(this.cabal.channels.get)()
      .then(channels => {
        channels.forEach(channel => {
          let mio = this.cabal.messages.read(channel)
          mio.on('data', message => {
            this._echoMessage(message)
          })
        })
      })
      .catch(err => log("Failed recapping messages:\n", err))
  }

  // Identity change and also Step 1 of IRC handshake
  nick (parameters) {
    /*
    user.nick = parameters[0]
    this.users[user.nick] = user
    */
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
      .then(() => new Promise(done => setTimeout(done, 1000)))
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
  // The incoming connection handler
  listen (socket) {
    const user = {
      name: socket.remoteAddress + ':' + socket.remotePort,
      socket,
      nick: 'anonymous_' + Math.floor(Math.random() * 9999)
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
