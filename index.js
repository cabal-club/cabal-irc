const Protocol = require('irc-protocol')
const Cabal = require('cabal-core')
const Swarm = require('cabal-core/swarm.js')
const {promisify} = require('util')

let log = function (...args) {
  let t = new Date()
  let timestamp = [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map(i=> i.toString().padStart(2,'0'))
    .join(':')
  console.log.apply(null,[timestamp, ...args])
}

let debug = function (...args) {
  if (true || process.env['DEBUG']) {
    console.debug.apply(null, ['DEBUG:',...args])
  }
}

// Expose all IRC numerics as lookup maps:
// Cmd with format:         { command: number }
const Cmd = ((numerics) => {
  return Object.keys(numerics)
  .reduce((hash, code) => {
    hash[numerics[code]] = parseInt(code)
    return hash
  }, {})
})(require('irc-protocol/numerics'))

module.exports = class CabalIRC {
  constructor (storage, key, opts) {
    if (!opts) opts = {}
    debug('Initializing core @', storage, 'with key:', key)
    this.cabal = Cabal(storage, key, opts)

    this.hostname = opts.hostname || '127.0.0.1'
    this.users = {}
    this.channels = {}
    debug('Waiting for cabal.db.ready')
    this.cabal.db.ready(() => {
      debug('ready received')
      if (!key) this.cabal.getLocalKey((err, key) => {
        log(`New cabal instance created, public key:\ncabal://${key}`)
      })
      this._onopen()
    })
  }

  // Leaves the swarm
  quit () {
    if (this.swarm) this.swarm.destroy()
  }

  // Joins the swarm and registers cabal event handlers
  _onopen () {
    debug('Setting up swarm')
    this.swarm = Swarm(this.cabal)
    log('Joined swarm')
    this.cabal.on('peer-added', peer => log('CAB:peer_added', peer))
    this.cabal.on('peer-dropped', peer => log('CAB:peer_dropped', peer))

    // Register handler for new channels.
    this.cabal.channels.events.on('add', channel => this._channelAdd(channel))
    // Register handler for new messages
    this.cabal.messages.events.on('message', msg => this._messageAdd(msg))
  }

  _channelAdd (channel) {
    debug('CAB:channel_add', channel)
    // This is a bit crappy, should probably have
    // better way for sending server initiated comms
    // than picking the first user in the users hash.
    let user = Object.values(users)[0]
    if (user) this._forceJoin(user)
  }
  _messageAdd (msg) {
    debug('CAB:messag_glob', msg)
    // Same problem here as in _channelAdd
    let user = Object.values(users)[0]
    if (user) this._echoMessage(msg)
  }

  // Forces connected client to join
  // all available channels since from what I
  // can see, cabal does not support join/part mechanics.
  _forceJoin (user) {
    return Promise.all([
      promisify(this.cabal.users.getAll)(),
      promisify(this.cabal.channels.get)()
    ])
      .then(([users, channels]) =>  {
        channels.forEach(channel => {
          user.socket.write(`:${user.nick} JOIN ${channel} \r\n`)
          user.socket.write(`:${this.hostname} ${Cmd.RPL_TOPIC} ${user.nick} ${channel} :TODO TOPIC\r\n`)
          let nicks = Object.values(users)
            .map(u => u.name || u.key.substr(0,8))
            .join(' ')
          user.socket.write(`:${this.hostname} ${Cmd.RPL_NAMREPLY} ${user.nick} @ ${channel} :${nicks} \r\n`)
          user.socket.write(`:${this.hostname} ${Cmd.RPL_ENDOFNAMES} ${user.nick} ${channel} :End of /NAMES list.\r\n`)
        })
      })
      .catch(err => log(err))
  }
  _recapMessages (user) {
    return promisify(this.cabal.channels.get)()
      .then(channels => {
        channels.forEach(channel => {
          // TODO: grab the message parser from cabal project.
          // no point reinventing the wheel.
          let mio = this.cabal.messages.read(channel)
          debugger
          mio.on('data', message => {
            debugger
            this._echoMessage(user, message)
          })
        })
      })
      .catch(err => log(err))
  }

  user (user, message) {
    delete this.users[user.nick]
    user.username = message.parameters[0]
    user.realname = message.parameters[3]
    this.users[user.nick] = this.users
    // Send motd
    user.socket.write(`:${this.hostname} ${Cmd.RPL_MOTDSTART} ${user.nick} :- ${this.hostname} Message of the day - \r\n`)
    // TODO: use a plaintext file instead and loop-send each line.
    user.socket.write(`:${this.hostname} ${Cmd.RPL_MOTD} ${user.nick} :- Welcome to cabal-irc gateway            -\r\n`)
    user.socket.write(`:${this.hostname} ${Cmd.RPL_MOTD} ${user.nick} :- Enjoy using your favourite IRC-software -\r\n`)
    user.socket.write(`:${this.hostname} ${Cmd.RPL_MOTD} ${user.nick} :- on the decentralized Cabal network      -\r\n`)
    user.socket.write(`:${this.hostname} ${Cmd.RPL_ENDOFMOTD} ${user.nick} :End of MOTD command\r\n`)
    this._forceJoin(user)
      .then(() => this._recapMessages(user))
  }

  nick (user, message) {
    delete this.users[user.nick]
    user.nick = message.parameters[0]
    this.users[user.nick] = user
    user.socket.write(`:${this.hostname} ${Cmd.WELCOME} ${user.nick} :Welcome to cabal!\r\n`)
  }

  ping (user, message) {
    user.socket.write(`:${this.hostname} PONG ${this.hostname} :` + message.parameters[0] + '\r\n')
  }

  part (user, message) {
    log(message)
  }

  privmsg (user, message) {
    /*this.cabal.publish({
      type: 'chat/text',
        content: {
          text: 'hello world',
            channel: 'cabal-dev'
        }
    })*/
    log(message)
  }

  welcome (user, message) {
    log(message)
  }

  whois (user, message) {
    let nick = message.parameters[0]
    let target = this.users[nick]
    if (!target) {
      user.socket.write(`:${this.hostname} ${Cmd.ERR_NOSUCHNICK} ` + user.nick + ` ` + nick + ` :No such nick/channel\r\n`)
      return
    }
    user.socket.write(`:${this.hostname} ${Cmd.RPL_WHOISUSER} ` + user.nick + ` ` + target.nick + ` ` + target.username + ` fakeaddr * :` + target.realname + `\r\n`)
    user.socket.write(`:${this.hostname} ${Cmd.RPL_ENDOFWHOIS} ` + user.nick + ` :End of WHOIS list\r\n`)
  }

  mode (user, message) {
    // Pacifier/Dummy always returns +ns modes to the client.
    let channel = message.parameters[0]
    user.socket.write(`:${this.hostname} ${Cmd.RPL_UMODEIS} ${channel} +ns\r\n`)
  }

  // Dropped internal channel-objects, using
  // cabal-views directly, see _forceJoin()
  // for new operation.
  /*
  join (user, message) {
    let channel = message.parameters[0]
    let {channels, hostname} = this

    if (!channels[channel]) {
      channels[channel] = {users: []}
    }
    channels[channel].users.push(user.nick)
    user.socket.write(`:${user.nick} JOIN ${channel} \r\n`)
    user.socket.write(`:${hostname} ${channel} :stock welcome message\r\n`)
    let nicks = channels[channel].users
      .map(function (nick) {
        return nick
      })
      .join(' ')
    user.socket.write(`:${hostname} ${Cmd.RPL_NAMREPLY} ${user.nick} @ ${channel} :${nicks} \r\n`)
    user.socket.write(`:${hostname} ${Cmd.RPL_ENDOFNAMES} ${user.nick} ${channel} :End of /NAMES list.\r\n`)
  }
*/

  list (user, message) {
    this.cabal.channels.get((err, channels) => {
      //let channels = [{name: '#default', users: 7, topic: 'the cabal-club'}] // Chanlist dummy

      user.socket.write(`:${this.hostname} ${Cmd.RPL_LISTSTART} ${user.nick} Channel :Users  Name\r\n`)
      channels
        .map(ch => ({name: ch, users: '-1', topic: ''}))
        .forEach(channel => {
        user.socket.write(`:${this.hostname} ${Cmd.RPL_LIST} ${user.nick} ${channel.name} ${channel.users} :${channel.topic}\r\n`)
      })
      user.socket.write(`:${this.hostname} ${Cmd.RPL_LISTEND} ${user.nick} :End of /LIST"\r\n`)
    })
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
    this.users[user] = user

    let parser = new Protocol.Parser()
    socket.pipe(parser)
    parser.on('readable', () => {
      // Are we guaranteed to always recieve an intact irc-message on parser.read()?
      // In what situation does the while-loop run twice, and if it does what
      // will the message be?
      let message
      while ((message = parser.read()) !== null) {
        let cmd = message.command.toLowerCase()
        log(message)
        let fn = this[cmd]
        if (!fn) this.notImplemented(user, cmd)
        else fn.apply(this, [user, message])
      }
    })
  }

  notImplemented (user, cmd) {
    console.error('not implemented', cmd)
    // Produces garbage
    // user.socket.write(`:${this.hostname} ${Cmd.ERR_UNKNOWNCOMMAND} ${cmd} :Command not implemented"\r\n`)
  }
}
