#!/usr/bin/env node
const net = require('net')
const argv = require('minimist')(process.argv)
const CabalIRC = require('.')

// Process arguments
let {key, host, port} = argv

// Load configuration from environment for docker-friendlyness
if (!key)   key = process.env['CABAL_KEY'] || null
if (!host)  host = process.env['CABAL_HOST'] || '127.0.0.1'
if (!port)  port = process.env['CABAL_PORT'] || 6667

// If we've been provided a key but not a storage,
// then default storage to ~/.cabal/PUBKEY
if (!key) {
  process.stderr.write("Please a --key\n")
  process.exit(1)
}

// Initialize new instance of CabalIRC
const cabal = new CabalIRC(key, argv)

// Create and bind tcp-server
var server = net.createServer(function (socket) {
  cabal.listen(socket)
  console.log('Irc client-connected', socket.remoteAddress, socket.remotePort)
})

server.listen(6667, '127.0.0.1', function () {
  console.log(`listening on port ${host}:${port}`)
})
