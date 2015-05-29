var crypto = require('crypto'),
Promise = require('bluebird');
request = Promise.promisifyAll(require('request'));

module.exports = exports = function() {
	/**
	 * Tutum API driver for the HAProxy load balancer
	 */
	var Tutum = function(options) {
		this._api = process.env.TUTUM_SERVICE_API_URL;
		if(!this._api) {
			throw new Error('The Tutum API URL was not specified for this service.');
		}

		this._callbacks = {
			onConfigure: []
		};

		this._frontends = null;
		this._result = null;

		this.getAvailableServices();
		this._watch();
	};

	/**
	 * Add a callback for when the configuration file is generated or reloaded
	 * @param  {Function} callback
	 */
	Tutum.prototype.onConfigure = function(callback) {
		this._callbacks.onConfigure.push(callback);
	};

	/**
	 * Get the available services that can be added to the load balancer
	 */
	Tutum.prototype.getAvailableServices = function() {
		return request.getAsync(this._api)
			.spread(function(response, data) {
				return JSON.parse(data);
			})
			.then(function(json) {
				var links = json.linked_to_service.map(function(service) {
					return service.name;
				});

				return json.calculated_envvars
					.map(function(env) {
						for(var i = 0; i < links.length; i++) {
							if(env.key.indexOf(links[i]) == 0) {
								env.link = links[i];
							}
						}

						return env;
					})
					.filter(function(env) {
						return !!env.link && env.key.match(/PORT\_([\d]+)\_(?:TCP|UDP)\_/);
					})
					.reduce(function(reduction, env) {
						if(!reduction.hasOwnProperty(env.link)) {
							reduction[env.link] = {};
						}

						// Port this service is exposing
						matches = env.key.match(/PORT\_([\d]+)\_(?:TCP|UDP)\_/);
						var port = matches[1];
						if(!reduction[env.link].hasOwnProperty(port)) {
							reduction[env.link][port] = {};
						}

						// Instance of the Docker container
						var instRegex = new RegExp('^' + env.link.replace(/\_/g, '\_') + '\_([A-Z0-9]+)\_PORT');
						var matches = env.key.match(instRegex);
						if(!matches) {
							return reduction;
						}

						var instance = matches[1];
						if(!reduction[env.link][port].hasOwnProperty(instance)) {
							reduction[env.link][port][instance] = {};
						}

						if(env.key.match(/PORT\_[\d]+\_(?:TCP|UDP)\_ADDR/) != null) {
							reduction[env.link][port][instance].host = env.value;
						} else if(env.key.match(/PORT\_[\d]+\_(?:TCP|UDP)\_PORT/) != null) {
							reduction[env.link][port][instance].port = parseInt(env.value, 10);
						}

						return reduction;
					}, {});
			});
	};

	/**
	 * Load the new available services and see if they have changed. If so, then we can go ahead
	 * and signal that the HAProxy configuration must be reloaded.
	 */
	Tutum.prototype._watch = function() {
		var self = this;
		this._watchTimeout = null;

		Promise.resolve(this._frontends)
			.then(function(frontends) {
				// If the frontends haven't been loaded from the save file yet, then we can go
				// ahead and skip this check.
				if(!frontends) {
					return [null, null];
				}

				return [frontends, self.configure.call(self, frontends, true)];
			})
			.spread(function(frontends, result) {
				var json = JSON.stringify(result);

				if(result != null && json != self._result) {
					console.log('Tutum backend services changed. Regenerating the configuration file.');

					self.configure.call(self, frontends);
				}
			})
			.finally(function() {
				self._watchTimeout = setTimeout(self._watch.bind(self), 30 * 1000);
			});
	};

	/**
	 * Reconfigure the frontends and backends and return the new service and server values
	 * for the specified Ids
	 */
	Tutum.prototype.configure = function(frontends, verifyOnly) {
		var self = this;

		return this.getAvailableServices()
			.then(function(services) {
				return frontends.map(function(frontend) {
					if(!services.hasOwnProperty(frontend.service.id)) {
						return null;
					}

					if(!services[frontend.service.id].hasOwnProperty(frontend.service.port)) {
						return null;
					}

					var s = services[frontend.service.id][frontend.service.port];
					var servers = [];
					for(var id in s) {
						servers.push({
							id: id,
							host: s[id].host,
							port: s[id].port
						});
					}

					var hash = crypto.createHash('sha1').update(JSON.stringify(frontend)).digest('hex');

					return {
						id: hash,
						domain: frontend.frontend.domain,
						healthcheck: frontend.frontend.healthcheck,

						servers: servers
					};
				});
			})
			.then(function(config) {
				if(verifyOnly !== true) {
					self._frontends = frontends;
					self._result = JSON.stringify(config);

					self._callbacks.onConfigure.forEach(function(callback) {
						callback(config);
					});
				}

				return config;
			});
	};

	/**
	 * Destroy this driver and unload anything that needs to be unloaded
	 */
	Tutum.prototype.destroy = function() {
		if(this._watchTimeout) {
			clearTimeout(this._watchTimeout);
		}
	};

	return Tutum;
};

exports['@singleton'] = true;
exports['@require'] = [];