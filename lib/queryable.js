var pg = require('pg');

//
// Queryable
// Implements "queries" as a queue, guaranteeing they are executed in the order
// that they are submitted.
//

var Queryable = function(constring){
  this.constring = constring;
  this.queries = [];
  this.executing = false;
}

//
// Initiates the node-postgres connection.
//

Queryable.prototype.connect = function(){
  pg.connect(this.constring, this.handleConnection.bind(this));
}

//
// Callback for the node-postgres connection.
// Noteably assigns "begun" to indicate that the connection is now available
// and calls next() to process a query if one was pushed onto the queue
// before the connection had completed.
//

Queryable.prototype.handleConnection = function(err, client, done){
  if(err) {
    return console.log("No client available.");
  }
  this.client = client;
  this.done = done;
  this.begun = true;
  this.connecting = false;
  this.next();
}

//
// Pushes a new query into the queue.
// Notably will configure the second parameter to be the callback if query
// is called with the parameters (query, callback).
// Also note that callback is optional and is assigned a default value if missing
//

Queryable.prototype.query = function(query, data, callback){

  if(typeof(data) === "function"){
    callback = data;
    data = [];
  }

  callback = callback || function(){};

  this.queries.push({query: query, data: data, callback: callback});
  if(!this.begun && !this.connecting){
    this.connecting = true;
    this.connect();
  } else if(this.begun && !this.executing) {
    this.next();
  }
  return this;
}

//
// Processes a given query, or releases the node-postgres client to the pool.
// On resolution or error, invokes a callback or rollback respectively.
//

Queryable.prototype.execute = function(queryObj){

  this.executing = true;

  if(queryObj.query == 'DONE'){
    this.done();
    return queryObj.callback();
  }

  this.client.query(queryObj.query, queryObj.data, function(err, result){
    //console.log("EXECUTED: " + queryObj.query);
    if(err) {
      console.log(err);
      return this.rollback(err);
    }
    if(queryObj.callback){
      queryObj.callback(err, result);
    }
    this.next();
  }.bind(this))
}

//
// Executes the next query in the queue, if any.
//

Queryable.prototype.next = function(){
  if(this.queries.length > 0){
    this.execute(this.queries.shift());
  } else {
    this.executing = false;
  }
}

//
// Per the node-postgres documentation, rolls back any changes made on error.
// Immediately invokes "done()"
//

Queryable.prototype.rollback = function(err){
  console.log(err);
  this.client.query('ROLLBACK', function(err){
    this.executing = false;
    if(this.done)
      return this.done(err);
  })
}

//
// Completes any queries remaining in the queue, then invokes "done()"
//

Queryable.prototype.end = function(callback){
  callback = callback || function(){};
  this.queries.push({query: 'DONE', callback: callback});
}


module.exports = Queryable;
