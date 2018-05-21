#!/usr/bin/env node

var net = require('net')
var argv = require('minimist')(process.argv)
var cabal = require('.')(argv.db, argv.key, argv)

var server = net.createServer(function (socket) {
  cabal.listen(socket)
  console.log('CONNECTION', socket.remoteAddress, socket.remotePort)
})

server.listen(6667, '127.0.0.1', function () {
  console.log('listening on port 6667')
})
