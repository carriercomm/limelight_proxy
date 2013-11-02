var http = require("http");
var needle = require("needle");
var crypto = require("crypto");
var url = require("url");
var _ = require("underscore");
var request = require("request");
var nconf = require('nconf');

// Load the configurations.
nconf.argv().file({ file: 'config.json' });

/**
 * Authenticate a Limelight request.
 *
 * @param type
 * @param url
 * @param params
 */
var authenticate_request = function($http_verb, $resource_url, $params) {
  $params = $params ? $params : {};
  var $url = $resource_url + '?';
  var $parsed_url = url.parse($resource_url);
  var $str_to_sign = $http_verb + '|' + $parsed_url.host + '|' + $parsed_url.pathname + '|';
  $str_to_sign = $str_to_sign.toLowerCase();
  if (!$params.hasOwnProperty('expires')) {
    $params.expires = Math.floor(new Date().getTime() / 1000) + 300;
  }
  $params.access_key = nconf.get('access_key');

  // Get all the keys in an array.
  var keys = [], key = '', len = 0, i = 0;
  for (key in $params) {
    if ($params.hasOwnProperty(key)) {
      keys.push(key);
    }
  }

  // Sort the keys...
  keys.sort();
  len = keys.length;

  // Iterate through all of the sorted keys.
  for (i = 0; i < len; i++) {
    key = keys[i];
    $str_to_sign += key + '=' + $params[key] + '&';
    $url += encodeURIComponent(key) + '=' + encodeURIComponent($params[key]) + '&';
  }

  $str_to_sign = $str_to_sign.substring(0, $str_to_sign.length - 1);
  var $signature = crypto.createHmac("SHA256", nconf.get('secret')).update($str_to_sign).digest('base64');
  $url += 'signature=' + encodeURIComponent($signature);
  return $url;
};

/**
 * Create a proxy server.
 */
http.createServer(function (req, res) {

  // Create the limelight request base.
  var base = 'http://api.video.limelight.com/rest/organizations/' + nconf.get('organization') + '/media/';

  // Get the media id from the request.
  var result = req.url.match(/\/([0-9a-zA-Z]+)(\.[^/]+)?$/i);
  if (result.length > 1) {
    var mediaId = result[1];

    // Get the encodings from this media.
    var signed_url = authenticate_request("GET", base + mediaId + '/encodings.json');
    needle.get(signed_url, function (error, response, info) {

      // Check to make sure the request is valid.
      if (!error && response.statusCode == 200) {

        // Locate the media with the largest size.
        var largest = null;
        _.each(info.encodings, function(encoding) {
          if (!largest || (encoding.size_in_bytes > largest.size_in_bytes)) {
            largest = encoding;
          }
        });

        // For videos, we need to get the download URL...
        if (info.media_type == 'Video') {

          // Get the download url for this media.
          var downloadRequest = authenticate_request("POST", base + mediaId + '/download_url');
          needle.post(downloadRequest, {quality: 'hd'}, function(error, response, downloadURL) {

            // Pipe this media to the response.
            request.get(downloadURL).pipe(res);
          });
        }
        else if (info.media_type == 'Audio') {

          // For audio, pipe the media url to the response.
          request.get(info.url).pipe(res);
        }
        else {
          res.writeHead(400, {'Content-Type': 'text/plain'});
          res.end('Unknown media type.');
        }
      }
      else {
        res.writeHead(response.statusCode, {'Content-Type': 'text/plain'});
        res.end(info);
      }
    });
  }
  else {
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Media Not Found');
  }
}).listen(nconf.get('port'));