# TODO 
* refactor cabal-irc constructor, move some of the init into a ready function
* only instantiate an irc server connection once `cabal-irc.ready` has fired
    * some kind of racing connection
* diff on cabal-client's update messages
    * because IRC needs to send individual lines for state changes e.g. new user joined
* rewrite the tests for the race condition, new refator
* maybe emit the diff inside cabal-client's update?
