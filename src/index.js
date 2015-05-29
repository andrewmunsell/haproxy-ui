var child = require('child_process'),
ejs = require('ejs'),
IoC = require('electrolyte'),
fs = require('fs'),
Promise = require('bluebird');

// HAProxy configuration file path
var path = '/usr/local/etc/haproxy/haproxy.cfg';
var storagePath = '/var/local/haproxy-ui';

// Configure the IoC loader
IoC.loader(IoC.node('src'));

// Prepare the HAProxy template
var template = ejs.compile(fs.readFileSync(__dirname + '/../resources/haproxy.cfg.tmpl', { encoding: 'utf-8' }));

// Get the current driver and start HAProxy
var driverName = process.env.DRIVER;
if(!driverName) {
	throw new Error('The driver was not configured. Please set the DRIVER environmental variable.');
}

var Driver = IoC.create('drivers/' + driverName);
var driver = new Driver();

driver.onConfigure(function(config) {
	fs.writeFileSync(path, template({
		services: config
	}));

	child.spawn('haproxy', ['-f', path, '-p', '$(</var/run/haproxy-private.pid)', '-st', '$(</var/run/haproxy-private.pid)']);
});

var configPath = storagePath + '/config.json';
if(!fs.existsSync(configPath)) {
	console.log('Writing initial configuration file.');
	fs.writeFileSync(configPath, '[]');
}

driver.configure(JSON.parse(fs.readFileSync(configPath)));

// Now, setup the actual app
var express = require('express');
var app = express();

var bodyParser = require('body-parser')

var basicAuth = require('basic-auth');

var auth = function (req, res, next) {
  function unauthorized(res) {
    res.set('WWW-Authenticate', 'Basic realm=Authorization Required');
    return res
    	.status(401)
    	.send('Unauthorized');
  };

  var user = basicAuth(req);

  if (!user || !user.name || !user.pass) {
    return unauthorized(res);
  };

  if (user.name === 'admin' && user.pass === process.env.HAPROXY_UI_PASSWORD && process.env.HAPROXY_UI_PASSWORD) {
    return next();
  } else {
    return unauthorized(res);
  };
};

app.post('/', auth, bodyParser.json(), function (req, res) {
  fs.writeFileSync(configPath, JSON.stringify(req.body));

  res.send('ok');
});

app.listen(process.env.PORT || 3000);