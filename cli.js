#!/usr/bin/env node
const net = require('net')
const argv = require('minimist')(process.argv)
const CabalIRC = require('.')

// Process arguments
let {db, key, host, port} = argv

// Load configuration from environment for docker-friendlyness
if (!key)   key = process.env['CABAL_KEY'] || null
if (!db)    db = process.env['CABAL_DB']
if (!host)  host = process.env['CABAL_HOST'] || '127.0.0.1'
if (!port)  port = process.env['CABAL_PORT'] || 6667

// Strip out URL-components from keystring if availble
// TODO: Might be safer to use `new URL(key).getHost()`
if (key) key = key.replace(/^(cabal|cbl|dat):\/\//,'').replace(/\//g, '')

// If we've been provided a key but not a storage,
// then default storage to ~/.cabal/PUBKEY
if (!db && key) {
  let homedir = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
  let rootdir = homedir + '/.cabal/archives/'
  db = rootdir + key
}else if (!db && !key) {
  process.stderr.write("Please provide --db or --key\n")
  process.exit(1)
}
// Initialize new instance of CabalIRC
const cabal = new CabalIRC(db, key, argv)

// Create and bind tcp-server
var server = net.createServer(function (socket) {
  cabal.listen(socket)
  console.log('CONNECTION', socket.remoteAddress, socket.remotePort)
})

server.listen(6667, '127.0.0.1', function () {
  console.log(`listening on port ${host}:${port}`)
})
