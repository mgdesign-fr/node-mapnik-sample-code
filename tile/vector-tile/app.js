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
                    
                    // see https://github.com/mapbox/tilelive-bridge/blob/master/index.js
                    /*
                        Simplification works to generalize geometries before encoding into vector tiles.
                        The 'simplify_distance' value works in integer space over a 4096 pixel grid and uses
                        the Douglas–Peucker algorithm.
                        The 4096 results from the path_multiplier used to maintain precision (default of 16)
                        and tile width (default of 256)
                        A simplify_distance of <= 0 disables the DP simplification in mapnik-vector-tile, however
                        be aware that geometries will still end up being generalized based on conversion to integers during encoding.
                        The greater the value the higher the level of generalization.
                        The goal is to simplify enough to reduce the encoded geometry size without noticeable visual impact.
                        A value of 8 is used below maxzoom. This was chosen arbitrarily.
                        A value of 1 is used at maxzoom and above. The idea is that 1 will throw out nearly coincident points while
                        having negligible visual impact even if the tile is overzoomed (but this warrants more testing).
                    */
                    var opts = {};
                    opts.simplify_distance = 8; // not really applicable in this example // z < source._maxzoom ? 8 : 1;
                    // This is the default path_multiplier - it is not recommended to change this
                    opts.path_multiplier = 16;
                
                    // also pass buffer_size in options to be forward compatible with recent node-mapnik
                    // https://github.com/mapnik/node-mapnik/issues/175
                    // NOTE - a 'buffer_size' > 0 will allow to hide polygon edges that are generated by tile clipping
                    opts.buffer_size = 8;
                        
                    map.render(vt, opts, function(err, vt) {
                        process.nextTick(function() {
                            maps.release(stylesheet, map);
                        });
                        if (err) {
                            res.writeHead(500, {
                              'Content-Type': 'text/plain'
                            });
                            res.end(err.message);
                        } else {
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
