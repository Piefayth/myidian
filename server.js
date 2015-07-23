var SPOTIFY_CLIENT_ID = '';
var SPOTIFY_CLIENT_SECRET = '';
var SPOTIFY_REDIRECT_URI = 'http://localhost:3000/callback';

var express = require('express');
var app = express();
var path = require('path');
var server = require('http').Server(app);

var main = require('./routes/main')(app);
var music = require('./routes/music')(app);


app.use(express.static('public'));

server.listen(3000, function(){
  console.log("Server started on port 3000");
});
