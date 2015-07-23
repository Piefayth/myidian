var constring = "postgres://postgres:joemamma@localhost/myidian"
var Queryable = require('../lib/queryable.js');
var seedrandom = require('seedrandom');

module.exports = function(){
  return {

    selectGenresByWeight: function(num, userid, callback){
      console.log('engage strategy');
      var genres = [];
      var queryable = new Queryable(constring);
      var query1 = "SELECT SUM(weight) FROM users.genreweights WHERE userid = $1";
      var query2 = "SELECT * FROM users.genreweights WHERE userid = $1";

      queryable.query(query1, [userid], function(err, result){
        var sum = result.rows[0].sum;

        queryable.query(query2, [userid], function(err, result2){
          for(var i = 0; i < num; i++){
            genres.push(getOneWeightedResult(result2.rows, sum))
          }
          return callback(genres);
        }).end();
      })
    }

  }
}

function getOneWeightedResult(rows, sum){
  var rand = seedrandom()() * sum;

  var pos = 0;

  while(sum > rand){
    sum -= rows[pos].weight;
    pos++;
  }
  return rows[pos];
}
