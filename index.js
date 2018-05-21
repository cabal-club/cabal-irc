var Protocol = require('irc-protocol')
var Cabal = require('cabal-node')
var Swarm = require('cabal-node/swarm')

module.exports = class CabalIRC {
  constructor (storage, key, opts) {
    if (!opts) opts = {}
    this.channels = {}
    this.cabal = Cabal(storage, key, opts)
    this.hostname = opts.hostname || '127.0.0.1'
    this.users = {}
    this.channels = {}
    this.cabal.db.ready(this._onopen.bind(this))
  }

  quit () {
    if (this.swarm) this.swarm.destroy()
  }

  _onopen () {
    this.swarm = Swarm(this.cabal)
    console.log('joined swarm')
  }

  user (user, message) {
    delete this.users[user.nick]
    user.username = message.parameters[0]
    user.realname = message.parameters[3]
    this.users[user.nick] = this.users
    user.socket.write(`:${this.hostname} 375 ${user.nick} :- 127.0.0.1 Message of the day - \n`)
    user.socket.write(`:${this.hostname} 372 ${user.nick} :- whoo\n`)
    user.socket.write(`:${this.hostname} 376 ${user.nick} :End of MOTD command\n`)
  }

  nick (user, message) {
    delete this.users[user.nick]
    user.nick = message.parameters[0]
    this.users[user.nick] = user
    user.socket.write(`:${this.hostname} 001 ${user.nick} :Welcome to cabal!\n`)
  }

  ping (user, message) {
    user.socket.write(`:${this.hostname} PONG ${this.hostname} :` + message.parameters[0] + '\n')
  }

  part (user, message) {
    console.log(message)
  }

  privmsg (user, message) {
    console.log(message)
  }

  welcome (user, message) {
    console.log(message)
  }

  whois (user, message) {
    var nick = message.parameters[0]
    var target = this.users[nick]
    if (!target) {
      user.socket.write(`:${this.hostname} 401 ` + user.nick + ` ` + nick + ` :No such nick/channel\n`)
      return
    }
    user.socket.write(`:${this.hostname} 311 ` + user.nick + ` ` + target.nick + ` ` + target.username + ` fakeaddr * :` + target.realname + `\n`)
    user.socket.write(`:${this.hostname} 318 ` + user.nick + ` :End of WHOIS list\n`)
  }

  mode (user, message) {
    var channel = message.parameters[0]
    user.socket.write(`:${this.hostname} ` + channel + '+ns\n')
  }

  join (user, message) {
    var channel = message.parameters[0]
    var channels = this.channels
    var hostname = this.hostname
    if (!channels[channel]) {
      channels[channel] = {users: []}
    }
    channels[channel].users.push(user.nick)
    user.socket.write(`:${user.nick} JOIN ${channel} \n`)
    user.socket.write(`:${hostname} ${channel} :stock welcome message\n`)
    var nicks = channels[channel].users
      .map(function (nick) {
        return nick
      })
      .join(' ')
    user.socket.write(`:${hostname} 353 ${user.nick} @ ${channel} :${nicks} \n`)
    user.socket.write(`:${hostname} 366 ${user.nick} ${channel} :End of /NAMES list.\n`)
  }

  listen (socket) {
    var self = this
    var user = {
      name: socket.remoteAddress + ':' + socket.remotePort,
      socket: socket,
      nick: 'anonymous_' + Math.floor(Math.random() * 9999)
    }

    user.username = user.nick
    user.realname = user.nick
    this.users[user] = user

    var parser = new Protocol.Parser()
    socket.pipe(parser)
    parser.on('readable', function () {
      var message
      while ((message = parser.read()) !== null) {
        var cmd = message.command.toLowerCase()
        console.log(message)
        var fn = self[cmd]
        if (!fn) self.notImplemented(user, cmd)
        else fn.bind(self)(user, message)
      }
    })
  }

  notImplemented (user, cmd) {
    console.error('not implemented', cmd)
  }
}
