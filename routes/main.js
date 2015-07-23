var request = require('request');
var qs = require('querystring');
var cookieParser = require('cookie-parser');
var session = require('express-session');
var pg = require('pg');
var constring = ""
var Queryable = require('../lib/queryable.js');

var SPOTIFY_CLIENT_ID = '';
var SPOTIFY_CLIENT_SECRET = '';
var STARTING_POINTS = 100;
var NUMBER_GENRES = 1373;


module.exports = function(app){

  app.use(cookieParser());
  app.use(session({secret: "", resave: false, saveUninitialized: false }));

  app.get('/', function(req, res){
    console.log();
    res.sendFile('index.html', {root: __dirname + '/../views/'});
  })

  app.get('/login', function(req, res){

    var state = randomString();

    res.cookie('spotify_auth_state', state);

    var redirecturl = "http://" + req.headers.host + '/callback';

    res.redirect('https://accounts.spotify.com/authorize?' +
    qs.stringify({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirecturl,
      state: state,
      scope: 'user-library-read',
    }))

  })

  app.get('/callback', function(req, res){

    var storedState = req.cookies ? req.cookies['spotify_auth_state'] : null;

    if(req.query.error || req.query.state != storedState){
      res.json({error: req.query.error || "Nope"});
    } else {

      //No error, so make the request based on the below parameters.
      var redirecturl = "http://" + req.headers.host + '/callback';

      var requestParams =
      {
        url: 'https://accounts.spotify.com/api/token',
        form: {
          code: req.query.code,
          redirect_uri: redirecturl,
          grant_type: 'authorization_code'
        },
        headers: {
          'Authorization': 'Basic ' + (new Buffer(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64'))
        },
        json: true
      }

      request.post(requestParams, function(error, response, body){
        if(!error && response.statusCode === 200){
          req.session.spotify_access_token = body.access_token;
          req.session.spotify_refresh_token = body.refresh_token;
          req.session.spotify_expiration_time = Math.floor((Date.now() / 1000) + body.expires_in);
        } else{
          var status = response.statusCode || "Timeout";
          console.log("Authentication Failure: " + status + " | " + body);
          for(var k in body){
            console.log(body[k]);
          }
        }
        res.redirect('/');
      })
    }



  })



  app.get('/checkloginstatus', function(req, res){
    var spotify_access = req.session.spotify_access_token || null;
    var spotify_refresh = req.session.spotify_refresh_token || null;
    var spotify_expires = req.session.spotify_expiration_time || null;


    //Check if we have an access token in the session. If it's expired, get a new one.

    if(spotify_access){
      if(spotify_expires < (Date.now() / 1000)){
        if(spotify_refresh){
          requestRefreshedToken(spotify_refresh, function(result){
            if(result.error){
              res.json({
                login: false
              })
              return
            }
          })
        }
      }
    } else {
      res.json({
        login: false
      })
      return
    }


    if(req.session.profile){

      //If we have the profile data this session, we don't need to interact with the API for this request.

      res.json(req.session.profile)

    } else if(spotify_access != null && spotify_refresh != null){

      //Regardless, we should now have a non-expired token, but let's make a request of the API to verify that it is valid.

      var requestParams = {
        url: 'https://api.spotify.com/v1/me',
        headers: {
          'Authorization': 'Bearer ' + spotify_access
        }
      }

      request.get(requestParams, function(error, response, body){

        var profilePicture = body.images ? body.images[0].url : "";

        if(!error && response.statusCode === 200){
          //Since our request is confirmed valid, let's write the goodies to the DB

          var queryable = new Queryable(constring);

          queryable.query('BEGIN', function(){
            process.nextTick(function(){
              var query1 =
                "INSERT INTO users.genreweights(userid, genre, weight) " +
                "SELECT $1, genres.name, $2 FROM music.genres " +
                "WHERE NOT EXISTS (SELECT id FROM users.users WHERE id = $1)";
              var query2 =
                "INSERT INTO users.users(id, email, name, profilepicture, accesstoken, refreshtoken, expirationtime)" +
                " SELECT $1, $2, $3, $4, $5, $6, $7" +
                " WHERE NOT EXISTS ( SELECT id FROM users.users WHERE id = $1)";

              queryable.query(query1,
                [body.id,
                STARTING_POINTS])
              .query(query2,
                [body.id,
                body.email,
                body.display_name,
                profilePicture,
                req.session.spotify_access_token,
                req.session.spotify_refresh_token,
                req.session.spotify_expiration_time])
              .query('COMMIT').end();

            })
          })

          body = JSON.parse(body);
          body['login'] = true;
          req.session.profile = body;
          res.json(body);
        } else {
          res.json({
            login: false
          })
        }
      })
    } else {
      //There was no access token, user needs to log in again.
      res.json({
        login: false
      })
    }
  })
}


function randomString(){

  var rand = (Math.random()).toString(36).substr(2);

  if(rand.length > 5)
    return rand;
  else
    return randomString();
}

function rollback(client, done, err){
  console.log(err);
  client.query('ROLLBACK', function(err){
    return done(err);
  })
}

function requestRefreshedToken(refresh, callback){
  var requestParams = {
    url: 'https://accounts.spotify.com/api/token',
    form: {
      grant_type: 'refresh_token',
      refresh_token: refresh
    },
    headers: {
      'Authorization': 'Basic ' + (new Buffer(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64'))
    }
  }

  request.post(requestParams, function(error, response, body){
    if(!error && response.statusCode === 200){
      return callback({
        access: body.access_token,
        refresh: body.refresh_token,
        expires: Math.floor((Date.now() / 1000) + body.expires_in)
      })
    } else{
      return callback({error:"Authentication Failure: " + response.statusCode + " | " + body});
    }
  })
}
