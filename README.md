# cabal-irc

This is an cabal-irc-bouncer, It let's you connect to
the cabal p2p network using whichever irc-client you prefer.

Usage:


cabal-irc [key|dbpath]

Fore more help run

cabal-irc --help

(readme is work in progress, we don't actually have an `cabal-irc` executable
right now.
just clone this project and run `node cli.js` to figure out how it works)


# Implemented IRC-commads
Current status

| Command   | Status   | Note                                                       |
| --------- | -------- | ---------------------------------------------------------- |
| PRIVMSG   | done     | /say , /me , /describe                                     |
| JOIN      | done     | /join  - aesthetic; you are always joined to all channels  |
| PART      | done     | /part  - aesthetic; same as join.                          |
| TOPIC     | done     | /topic - controls cabal-channel topic                      |
| LIST      | done     | /list  - lists all available channels.                     |
| NICK      | done     | /nick  - works as usual..                                  |
| QUIT      | done     | /quit  - Do we want it to publish the quit-message?        |
| ERROR     | done     |                                                            |
| PING      | done     |                                                            |
| USER      | done     |                                                            |
| MODE      | done     | Always returns mode `+nsv`                                 |
| CAP       | done     | Always returns empty list                                  |
| WHOIS     | done     | TODO: can be improved with idle-time and signon-timestamp  |
| add more  | todo     | Is there other IRC commands worth to translate to cabal?   |


