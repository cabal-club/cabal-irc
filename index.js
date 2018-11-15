const Protocol = require('irc-protocol')
const Cabal = require('cabal-core')
const Swarm = require('cabal-core/swarm.js')

let log = function (...args) {
  let t = new Date()
  let timestamp = [t.getHours(), t.getMinutes(), t.getSeconds()]
    .map(i=> i.toString().padStart(2,'0'))
    .join(':')
  console.log.apply(null,[timestamp, ...args])
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

    if (!storage && key) {
      let homedir = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
      let rootdir = args.dir || (homedir + '/.cabal/archives/')
      storage = rootdir + args.key
    }

    if (key) {
      key = key.replace(/^(cabal|cbl|dat):\/\//).replace(/\//g, '')
      this.cabal = Cabal(storage, key, opts)
    } else {
      this.cabal = Cabal(storage, null)
    }

    this.hostname = opts.hostname || '127.0.0.1'
    this.users = {}
    this.channels = {}
    this.cabal.db.ready(() => {
      if (!key) this.cabal.getLocalKey((err, key) => {
        log(`New cabal instance created, public key:\ncabal://${key}`)
      })
      this._onopen.bind(this)
    })
  }

  quit () {
    if (this.swarm) this.swarm.destroy()
  }

  _onopen () {
    this.swarm = Swarm(this.cabal)
    log('joined swarm')
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
    let channel = message.parameters[0]
    user.socket.write(`:${this.hostname} ` + channel + '+ns\r\n')
  }

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
  }
}
