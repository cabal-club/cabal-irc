const net = require('net')
const ram = require('random-access-memory')
const irc = require('irc-upd')
const CabalIRC = require('.')
const test = require('tape')

var tapSpec = require('tap-spec');

test.createStream()
  .pipe(tapSpec())
  .pipe(process.stdout);

const cabal = new CabalIRC(ram)
const server = net.createServer(function (socket) {
  cabal.listen(socket)
})

const port = 6667
const host = '127.0.0.1'
const nickname = 'joebob'
const channels = ['#default']

server.listen(port, host, function () {
  const client = new irc.Client(host, nickname)
  // Forward IRC-server errors
  client.addListener('error', message => {throw new Error(message)})

  test ('Server sends MOTD', t => {
    t.plan(1)
    client.on('motd', motd => {
      t.ok(motd, 'MOTD received')
      t.end()
    })
  })

  test ('List channels', t => {
    t.plan(1)
    client.list()
    client.on('channellist', list => {
      console.log('RECV, list:', list)
      t.ok(list, 'channel list received')
      t.end()
    })
  })

  test('Join channel #default', t => {
    t.plan(0)

    t.end()
  })

  test('join and welcome', function (t) {
    client.say('#default', 'Im a bot!')
    t.end()
  })

  test('quit', function (t) {
    server.close()
    client.disconnect()
    t.end()
  })
})
