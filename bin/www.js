#!/usr/bin/env node

/**
 * Module dependencies.
 */

var app = require('../app');
var debug = require('debug')('mail2pdfimap:server');
var http = require('http');
var socket = require('../routes/socket.js');
/**
 * Get port from environment and store in Express.
 */

var port = normalizePort(process.env.PORT || '3006');
app.set('port', port);

/**
 * Create HTTP server.
 */

var server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */
var io = require('socket.io')(server);
io.sockets.on('connection', function (client) {
    socket.stuff(client, io);
    console.log('Client connected ip :'+ client.conn.remoteAddress+" at "+new Date());


    client.on('join', function(data) {
       // console.log(data);
        //  client.emit('messages', 'Hello from server');
    });

});
server.listen(port);
server.timeout = 2147483647;//5000*1000*1000;
server.on('error', onError);
server.on('listening', onListening);

/*var io = require('socket.io').listen(server);

io.on('connection', function(client) {
//console.log(JSON.stringify(client));

    socket.stuff(client, io);
    console.log('Client connected ip :'+ client.conn.remoteAddress+" at "+new Date());


    client.on('join', function(data) {
        console.log(data);
      //  client.emit('messages', 'Hello from server');
    });

});*/


/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
    var port = parseInt(val, 10);

    if (isNaN(port)) {
        // named pipe
        return val;
    }

    if (port >= 0) {
        // port number
        return port;
    }

    return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
    if (error.syscall !== 'listen') {
        throw error;
    }

    var bind = typeof port === 'string'
        ? 'Pipe ' + port
        : 'Port ' + port;

    // handle specific listen errors with friendly messages
    switch (error.code) {
        case 'EACCES':
            console.error(bind + ' requires elevated privileges');
            process.exit(1);
            break;
        case 'EADDRINUSE':
            console.error(bind + ' is already in use');
            process.exit(1);
            break;
        default:
            throw error;
    }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
    var addr = server.address();
    var bind = typeof addr === 'string'
        ? 'pipe ' + addr
        : 'port ' + addr.port;
    debug('Listening on ' + bind);
}
