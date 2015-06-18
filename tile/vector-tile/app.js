#!/usr/bin/env node

// This example shows how to use node-mapnik with the
// connect http server to serve map tiles to polymaps
// client. Also logs tile render speed
//
// expected output at zoom 0: http://goo.gl/cyGwo

var mapnik = require('mapnik')
  , mercator = require('../../utils/sphericalmercator')
  , mappool = require('../../utils/pool.js')
  , http = require('http')
  , parseXYZ = require('../../utils/tile.js').parseXYZ
  , zlib = require('zlib')
  ;

// register shapefile plugin
if (mapnik.register_default_input_plugins) mapnik.register_default_input_plugins();

var TMS_SCHEME = false;

// create a pool of 5 maps to manage concurrency under load
var maps = mappool.create_pool(5);

var usage = 'usage: app.js <stylesheet> <port>\ndemo:  app.js ../../stylesheet.xml 8000';

var stylesheet = process.argv[2];

if (!stylesheet) {
   console.log(usage);
   process.exit(1);
}

var port = process.argv[3];

if (!port) {
   console.log(usage);
   process.exit(1);
}

var aquire = function(id,options,callback) {
    methods = {
        create: function(cb) {
                var obj = new mapnik.Map(options.width || 256, options.height || 256);
                obj.load(id, {strict: true},function(err,obj) {
                    if (options.bufferSize) {
                        obj.bufferSize = options.bufferSize;
                    }
                    cb(err,obj);
                });
            },
            destroy: function(obj) {
                delete obj;
            }
    };
    maps.acquire(id,methods,function(err,obj) {
      callback(err, obj);
    });
};


http.createServer(function(req, res) {
    parseXYZ(req, TMS_SCHEME, function(err,params) {
        if (err) {
            res.writeHead(500, {
              'Content-Type': 'text/plain'
            });
            res.end(err.message);
        } else {
            aquire(stylesheet, {}, function(err, map) {
                if (err) {
                    process.nextTick(function() {
                        maps.release(stylesheet, map);
                    });
                    res.writeHead(500, {
                      'Content-Type': 'text/plain'
                    });
                    res.end(err.message);
                } else {
                    // bbox for x,y,z
                    var bbox = mercator.xyz_to_envelope(params.x, params.y, params.z, TMS_SCHEME);
                    map.extent = bbox;
                    // see https://github.com/mapnik/node-mapnik/blob/master/docs/VectorTile.md
                    var vt = new mapnik.VectorTile(params.z, params.x, params.y);
                    map.render(vt, function(err, vt) {
                        process.nextTick(function() {
                            maps.release(stylesheet, map);
                        });
                        if (err) {
                            res.writeHead(500, {
                              'Content-Type': 'text/plain'
                            });
                            res.end(err.message);
                        } else {
                            // see https://github.com/mapbox/tilelive-bridge/blob/master/index.js
                            // TODO simplify & co
                            var buffer = vt.getData();
                            zlib.gzip(buffer, function(err, pbfz) {
                                if (err) {
                                    res.writeHead(500, {
                                      'Content-Type': 'text/plain'
                                    });
                                    res.end(err.message);
                                }
                                else {
                                    res.writeHead(200, {
                                      'Content-Type': 'application/x-protobuf'
                                    , 'Content-Encoding': 'gzip'
                                    , 'Access-Control-Allow-Origin': '*'
                                    });
                                    res.end(pbfz);
                                }
                            });
                        }
                    });
                }
            });
        }
    });

}).listen(port);

console.log('Test server listening on port %d', port);
