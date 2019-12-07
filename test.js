const net = require('net')
const irc = require('irc-upd')
const CabalIRC = require('.')
const test = require('tape')
const {promisify} = require('util')

var tapSpec = require('tap-spec');

test.createStream()
  .pipe(tapSpec())
  .pipe(process.stdout);

const bnc = new CabalIRC(null, {disableSwarm: true})

const server = net.createServer(function (socket) {
  bnc.listen(socket)
})

test ('Seed the feed', t => {
  t.plan(0)
  seedFeed(bnc).then(t.end())
})
const port = 30000 + Math.floor(Math.random()*1000)
const host = '127.0.0.1'
const nickname = 'joebob'
const channels = ['#default']
function spawnClient () {
  return new irc.Client(host, nickname, {
    channels,
    port
  })
}

server.listen(port, host, () => {

  test ('forced join', t => {
    t.end()
  })


  test('Whois', function (t) {
    t.plan(3)
    let client = spawnClient()
    client.on('whois', (info) => {
      t.equal(info.nick, nickname)
      t.equal(info.user, "~cabalist")
      t.ok(info.host.match(/^[0-9a-f]{64}$/), 'host is a 64-char hex-string (pub key)')
      client.disconnect()
      t.end()
    })
    client.whois(nickname)
  })

  test ('message recap', t => {
    t.plan(6)
    let client = spawnClient()
    let i = 0
    client.on('message', (info, to, msg) => {
      t.comment(`${from}, ${to}, ${msg}`)
      t.equal(from, bnc.cabal.key)
      t.equal(to, seedMessages[i].content.channel)
      t.equal(msg, seedMessages[i].content.text)
      i++
      if (i == 2) {
        client.disconnect()
        t.end()
      }
    })
    client.say('!recap')
  })


  test ('Server sends MOTD', t => {
    t.plan(1)
    let client = spawnClient()
    client.on('motd', motd => {
      t.ok(motd, 'MOTD received')
      client.disconnect()
      t.end()
    })
  })

  test ('List channels', t => {
    t.plan(1)
    let client = spawnClient()
    client.list()
    client.on('channellist', list => {
      t.ok(list, 'channel list received')
      client.disconnect()
      t.end()
    })
  })


  test('Send Message', function (t) {
    t.plan(2)
    let client = spawnClient()
    client.on('message', (to, from, message) => {
      t.equal(to, '#default')
      t.equal(message, 'Im a bot!')
      client.disconnect()
      t.end()
    })
    client.say('#default', 'Im a bot!')
  })

  test('quit', function (t) {
    server.close()
    t.end()
  })
})

const seedMessages = [
  {
    type: 'chat/text',
    content: {
      text: 'hello world',
      channel: 'channelA'
    }
  },
  {
    type: 'chat/text',
    content: {
      text: 'and now you\'ll forever be part of history',
      channel: 'channelB'
    }
  }
]

function seedFeed (bnc, cb) {
  return new Promise((resolve) => {
    resolve()
  }).then(() => { // Inject the seedMessages
    return seedMessages.reduce((p, message) => {
      return p.then(() => {
        return new Promise((resolve) => {
          bnc.cabal.publish(message, null ,resolve)
        })
      })
    }, Promise.resolve())
  }).catch(err => {
    throw err
  })
}
