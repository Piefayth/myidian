var request = require('request');
var pg = require('pg');
var constring = ""
var Queryable = require('../lib/queryable.js');
var bodyParser = require('body-parser');
var strategy = require('../util/strategy')();

var SPOTIFY_CLIENT_ID = '';
var SPOTIFY_CLIENT_SECRET = '';
var ECHONEST_API_KEY = '';
var STARTING_POINTS = 100;
var NUMBER_GENRES = 1373;
var POSITIVE_GENRE_INFLUENCE = 10000;
var NEGATIVE_GENRE_INFLUENCE = 10000;


module.exports = function(app){

  app.get('/choice', function(req, res){

    var numArtists = 3;
    var tracklist = [];

    //Get numArtists, each from their own random genre.

    strategy.selectGenresByWeight(3, req.session.profile.id, function(genres){
    genres.forEach(function(genre){
      console.log(genre);
        getArtistsFromGenre(genre.genre, 20, function(artists){
          getTopSpotifyTracks(artists, req, function(tracks){
            if(tracks == "NO_TRACKS_FOUND"){
              res.json({err: "No tracks"});
              return;
            }
            nextTrack = tracks[getRandomInt(0, tracks.length-1)];
            if(nextTrack){
              nextTrack.genre = genre.genre;
            }
            tracklist.push(nextTrack);
            if(tracklist.length >= numArtists){
              writeTrackToDatabase(nextTrack, true);
              res.json(tracklist);
            }
            else {
              writeTrackToDatabase(nextTrack);
            }
          })
        })
      })
    })
  })

  app.post('/select', bodyParser.urlencoded({extended: true}), function(req, res){

    var track = req.body;
    updateGenreWeights([track], req, 1);
    res.end();

  })

  app.post('/refresh', bodyParser.json(), function(req, res){

    var tracks = req.body;

    if(tracks){
      updateGenreWeights(tracks, req, -1);
    }

    res.end();

  })
}

function updateGenreWeights(tracks, req, modifier){

  modifier = modifier || 1;

  var queryable = new Queryable(constring);

  //Create a temp table to merge into the weights table.
  var query0 =
  "CREATE TEMPORARY TABLE weightupdate (genre text, userid text, weight numeric(20,19)) ON COMMIT DROP;"

  //Populate the temp table with the chosen value
  var query1 =
  "INSERT INTO weightupdate VALUES ($1, $2, $3)";

  //Update "everything else"
  var query2 =
  "UPDATE users.genreweights SET weight = users.genreweights.weight - $1 " +
  "WHERE genreweights.userid = $2 AND genreweights.genre NOT IN (SELECT genre FROM weightupdate w WHERE w.userid = $2)";

  //Update from the temp table.
  var query3 =
  "UPDATE users.genreweights g SET weight = g.weight + w.weight " +
  "FROM weightupdate w WHERE w.genre = g.genre AND w.userid = $1 AND g.userid = $1";


  queryable.query('BEGIN')
  .query(query0)

  tracks.forEach(function(track){
    queryable.query(query1, [track.genre, req.session.profile.id, modifier*POSITIVE_GENRE_INFLUENCE/NUMBER_GENRES])

    getSimilarGenres(track.genre, function(similargenres){

      similargenres.forEach(function(genre){
        queryable.query(query1, [genre.name, req.session.profile.id, (modifier*0.5*POSITIVE_GENRE_INFLUENCE)/NUMBER_GENRES])
      })

      queryable.query(query2, [ ((NEGATIVE_GENRE_INFLUENCE + ((0.5*NEGATIVE_GENRE_INFLUENCE) * similargenres.length * modifier))/NUMBER_GENRES)/NUMBER_GENRES, req.session.profile.id])
      .query(query3, [req.session.profile.id])
      .query('COMMIT').end();
    }, queryable)
  })

  if(tracks.length = 1){
    var query4 = "INSERT INTO users.choices (userid, choice) VALUES ($1, $2)";
    queryable.query(query4, [req.session.profile.id, tracks[0].trackId]);
  }
}

function getSimilarGenres(genre, callback, queryable){

  var query = "SELECT * FROM music.similar_genres WHERE genre = $1";

  queryable.query(query, [genre], function(err, result){
    if(result){
      var similargenres = [];
      result.rows.forEach(function(genre){
        similargenres.push({name: genre.similarto, similarity: genre.similarity})
      })
      callback(similargenres)
    } else {
      var requestParams = {
        url: 'https://developer.echonest.com/api/v4/genre/similar',
        qs: {
          api_key: ECHONEST_API_KEY,
          name: genre
        }
      }

      request.get(requestParams, function(err, response, body){
        if(!err && response.statusCode == 200){
          var similar = JSON.parse(body).response;

          similar.genres.forEach(function(similargenre){
            var query =
            "INSERT INTO music.similar_genres (genre, similarto, similarity) " +
            "SELECT $1::text, $2::text, $3 WHERE " +
            "NOT EXISTS (SELECT genre FROM music.similar_genres WHERE genre = $1::text and similarto = $2::text)";
            console.log(similargenre.name + " | " + similargenre.similarity);
            queryable.query(query, [genre, similargenre.name, similargenre.similarity]);
          })
          queryable.query('COMMIT').end(function(){
            return callback(similar.genres);
          });

        } else {
          return callback();
        }
      })
    }
  })

}

function getGenres(allGenres, start, callback){

  var requestParams = {
    url: 'https://developer.echonest.com/api/v4/genre/list',
    qs: {
      api_key: ECHONEST_API_KEY,
      start: start
    }
  }

  request.get(requestParams, function(error, response, body){
    if(!error && response.statusCode === 200){
      var body = JSON.parse(body);
      var genres = body.response.genres;

      genres.forEach(function(genre){
        allGenres.push(genre.name);
      })

      if(allGenres.length < body.response.total){
        getGenres(allGenres, allGenres.length, callback);
      } else {
        return callback(allGenres);
      }

    } else {
      console.log(body + " | " + response.statusCode);
      return 'error';
    }
  })
}

function getArtistsFromGenre(genre, num, callback){


  //Check DB for artists. Update it if they are out of date or missing
  var query = 'SELECT * FROM music.artists a JOIN music.artist_genre ag ON (a.spotifyid = ag.artist_id) where ag.genre_name = $1 and a.hotness > 0.4';
  var queryable = new Queryable(constring);

  queryable.query(query, [genre], function(err, result){
    if(result.rows.length < 1){
      getOrUpdateArtists(false, function(){
        queryable.query(query, [genre], function(err, result){
          queryable.end();
          return callback(getRandomArtists(result.rows));
        })
      })
    } else {
      var date = new Date(result.rows[0].updated);
      //This list is out of date. Pass our function isUpdate = true so it knows to delete the old records.
      if (date > new Date((new Date()).valueOf() + 1000*3600*24)){
        console.log('list out of date');
        getOrUpdateArtists(true, function(){
          queryable.query(query, [genre], function(err, result){
            queryable.end();
            return callback(getRandomArtists(result.rows));
          })
        })
      } else {
        //This genre was cached in the DB, so we can go ahead and pick num artists
        queryable.end();
        return callback(getRandomArtists(result.rows));
      }
    }
  })

  //Selects num artists from the result.
  function getRandomArtists(rows){
    var res = [];
    for(var i = 0; i < num; i++){
      res.push(rows[Math.floor(Math.random() * rows.length)]);
    }
    return res;
  }


  //If the DBdoesn't have artists or the artists need updated, query a fresh list for the genre
  function getOrUpdateArtists(isUpdate, callback){
    var allArtists = [];
    var query;

    requestArtists(0, allArtists, function(){

      var queryable = new Queryable(constring);
      queryable.query('BEGIN', function(){
        if(isUpdate){
          process.nextTick(function(){
            query = 'DELETE FROM music.artists a JOIN music.artist_genre ag ON (a.spotifyid = ag.artist_id) WHERE ag.genre_name = $1';
            queryable.query(query, [genre]);
          })
        }

        //Create a temporary table to be merged into the artists table and the artist_genre junction table.
        //Populate it with data from echonest.

        query = "CREATE TEMPORARY TABLE newartists(name text, spotifyid text, genre text, hotness numeric(7,6)) ON COMMIT DROP";
        process.nextTick(function(){
          queryable.query(query, function(err){
            allArtists.forEach(function(artist){
              query = "INSERT INTO newartists(name, spotifyid, genre, hotness) VALUES ($1, $2, $3, $4)";
              queryable.query(query, [artist.name, artist.foreign_ids[0].foreign_id, genre, artist.hotttnesss]);
            })
            query =
            "LOCK TABLE music.artists IN EXCLUSIVE MODE; " +
            "INSERT INTO music.artists (name, spotifyid, hotness) SELECT newartists.name, newartists.spotifyid, newartists.hotness " +
                "FROM newartists LEFT OUTER JOIN music.artists ON (artists.spotifyid = newartists.spotifyid) " +
                "WHERE artists.spotifyid IS NULL; " +
            "INSERT INTO music.artist_genre SELECT newartists.genre, newartists.spotifyid " +
                "FROM newartists LEFT OUTER JOIN music.artist_genre ON (artist_genre.artist_id = newartists.spotifyid) " +
                "WHERE artist_genre.artist_id IS NULL;";
            queryable.query(query).query('COMMIT', function(){
              return callback();
            }).end();
          })
        })
      })
    })
  }


  //Recursive function that gets the full list of artists for the given genre from Echonest
  function requestArtists(start, allArtists, callback){
    var requestParams = {
      url: 'https://developer.echonest.com/api/v4/artist/search',
      qs: {
        api_key: ECHONEST_API_KEY,
        genre: genre,
        results: 100,
        bucket: ['id:spotify', 'hotttnesss', 'artist_location'],
        start: start,
        limit: true
      },
      qsStringifyOptions: { indices: false }
    }

    console.log("requests starting at: " + start);

    request.get(requestParams, function(error, response, body){
      if(!error && response.statusCode === 200){
        var body = JSON.parse(body);
        var artists = body.response.artists;
        if(artists.length > 0){
          artists.forEach(function(artist){
              allArtists.push(artist);
          })
          start += 100;
          requestArtists(start, allArtists, callback);
        } else {
          return callback();
        }
      } else {
        console.log(error);
        console.log(body);
        console.log(response.statusCode);
      }
    })
  }
}

function getTopSpotifyTracks(artists, req, callback){


  var spotify_access = req.session.spotify_access_token;
  var spotify_refresh = req.session.spotify_refresh_token;
  var spotify_expires = req.session.spotify_expiration_time;

  if(spotify_expires < (Date.now() / 1000)){
    requestRefreshedToken(spotify_refresh, function(res){
      req.session.spotify_access_token = res.access;
      req.session.spotify_refresh_token = res.refresh;
      req.session.spotify_expiration_time = res.expires;
      getTopSpotifyTracks(artists, req, callback);
    })
  } else {
    var artist = artists[0];
    if(!artist)
      return callback("NO_TRACKS_FOUND");

    var artistid = trimSpotifyID(artist.spotifyid);

    var requestParams = {
      url: 'https://api.spotify.com/v1/artists/' + artistid + '/top-tracks',
      qs: {
        country: "US"
      },
      headers: {
        'Authorization': 'Bearer ' + spotify_access
      }
    }

    request.get(requestParams, function(err, response, body){

      var tracks = [];
      body = JSON.parse(body);
      if(body.tracks){
        body.tracks.forEach(function(track){
          if(track.popularity > 10){
            if(track.album && track.album.images && track.album.images[1])
              var album = track.album.images[1].url;
            else
              var album = "somedefaultimage";

            tracks.push({
              fullTrackURL: track.external_urls.spotify,
              trackId: track.id,
              title: track.name,
              popularity: track.popularity,
              previewTrackURL: track.preview_url,
              albumArt: album,
              artist: track.artists[0].name,
              artistId: track.artists[0].id
            })
          }
        })
      } else {
        return callback(err);
      }

      if(tracks.length > 0)
        return callback(tracks)
      else{
        var removed = artists.shift();
        console.log("Removing " + removed);

        if(artists.length == 0){
          callback("NO_TRACKS_FOUND");
        } else {
          getTopSpotifyTracks(artists, req, callback);
        }
      }
    })
  }



}

function writeTrackToDatabase(track, commit){
  if(track){
    var queryable = new Queryable(constring);
    var query =
      "INSERT INTO music.tmp_songs VALUES ($1, $2, $3, $4, $5, $6, $7, $8)";
    var artistId = "spotify:artist:" + track.artistId;
    var params = [track.trackId, artistId, track.title, track.fullTrackURL, track.previewTrackURL, track.popularity, track.albumArt, track.genre];
    queryable.query(query, params).query('COMMIT').end(function(){
      if(commit){
        commitTemporaryTrackTable();
      }
    })
  }
}
function commitTemporaryTrackTable(){
  var queryable = new Queryable(constring);

  //Check if the artist we pulled didn't get pulled in our genre search. Collabs will do this a lot.
  var query3 =
    "INSERT INTO music.artists (spotifyid) SELECT artistid FROM music.tmp_songs " +
    "WHERE artistid NOT IN (SELECT spotifyid FROM music.artists WHERE artistid = spotifyid)";

  //Insert the appropriate artist/genre relation.
  var query4 =
    "INSERT INTO music.artist_genre SELECT t.genre, t.artistid FROM music.tmp_songs t " +
    "WHERE t.artistid NOT IN (SELECT artist_id FROM music.artist_genre WHERE artist_id = artistid)";

  //Merge the tmp_songs table to the real one.
  var query1 =
    "LOCK TABLE music.songs IN EXCLUSIVE MODE; " +
    "INSERT INTO music.songs SELECT t.spotifyid, t.artistid, t.songname, t.fullsongurl, t.previewsongurl, t.popularity, t.albumarturl, t.genre FROM music.tmp_songs t " +
    "LEFT OUTER JOIN music.songs ON (songs.spotifyid = t.spotifyid) " +
    "WHERE songs.spotifyid IS NULL AND t.artistid IN (SELECT spotifyid FROM music.artists WHERE spotifyid = t.artistid)"

  //Remove the temporary entries.
  var query2 =
      "DELETE FROM music.tmp_songs WHERE tmp_songs.spotifyid in (SELECT spotifyid FROM music.songs WHERE spotifyid = tmp_songs.spotifyid)";

  process.nextTick(function(){
      queryable.query(query3).query(query4).query(query1).query(query2).query('COMMIT').end();
  })
}

function trimSpotifyID(id){
  return id.replace(/.*:.*:/g, '');
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
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
