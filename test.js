var net = require('net')
var ram = require('random-access-memory')
var irc = require('irc-upd')
var CabalIRC = require('.')
var test = require('tape')

var cabal = new CabalIRC(ram)
var server = net.createServer(function (socket) {
  cabal.listen(socket)
})

var port = 6667
var host = '127.0.0.1'
var nickname = 'joebob'
var channels = ['#default']

server.listen(port, host, function () {
  var client = new irc.Client(host, nickname, { channels })

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
