//////////////////////////////////////////
// Prey Control Panel Driver
// Written by Tomas Pollak
// (c) 2011, Fork Ltd. http://forkhq.com
// Licensed under the GPLv3
//////////////////////////////////////////

"use strict";

var fs         = require('fs'),
    util       = require('util'),
    path       = require('path'),
    Emitter    = require('events').EventEmitter,
    common     = require('./../../common'),
    hooks      = require('./../../hooks'),
    dispatcher = require('./../../dispatcher'),
    request    = require('./request'),
    parser     = require('./response_parser'),
    logger     = common.logger;

var ControlPanelDriver = function(options) {

  var self = this;
  this.name = 'control-panel';
  this.events = {};
  this.interval = {};
  this.active_reports = {};
  this.config = options;
  this.cached_response_file = common.system.tempfile_path('last-response.xml');
  this.missing_status_code = 404;

  this.log = function(str){
    logger.info("[driver] " + str);
  };

  this.load = function(callback){
    this.check_keys(function(err){
      if (err) {
        return self.unload() || callback(err);
      }

      self.log("Control Panel keys in place.");
      self.set_urls();
      self.load_hooks();
      self.start();
      callback(null, self); // OK
    });
  };

  this.load_hooks = function(){
    hooks.on('event', function(name, data){
      if (name === 'all_actions_returned')
        self.send_events();
      else if(data)
        self.events[name] = data;
    });

    hooks.on('data', function(name, data){
      //console.log("Got data from " + name);
      self.send_data(name, data, function(err, response){

        if (err && self.active_reports[name])
          self.cancel_report(name);
      });
    });

    hooks.on('trigger', this.start);
  };

  this.unload = function(err){
    if(err) logger.error(err);
    hooks.removeAllListeners();
    this.emit('unload', err);
  };

  this.set_urls = function(){
    var base_url = 'https://' + this.config.host + '/devices/' + this.config.device_key;
    var request_format = '.xml';
    this.endpoints = {
      device: {
        url: base_url + request_format,
        method: 'put'
      },
      events: {
        url: base_url + '/events' + request_format,
        method: 'put'
      },
      location: {
        url: base_url + '/reports' + request_format,
        method: 'post'
      }
    };
  };

  this.start = function(){

    if (common.program.connection_found)
      self.fetch();
    else
      self.check_cached_response();
  };

  this.fetch = function(){

    var opts = {},
        urls = [this.endpoints.device.url];

    opts.report_status = false;
    opts.proxy_url     = config.get('proxy_url');
    opts.user_agent    = common.user_agent;

    request.make(urls, opts, function(err, resp, body){
      if (err) return self.unload(err);

      self.response_status = resp.statusCode;
      self.process(body, false);
    });
  };

  this.check_cached_response = function(){
    fs.readFile(this.cached_response_file, function(err, data){
      if (err) return self.unload(new Error("Cached response not found."));

      logger.notice("Cached response file found! Processing...");
      self.process(data.toString(), true);
    });

  };

  this.marked_as_missing = function(requested){
    try {
      return requested.missing; // from instructions
    } catch(e) {
      return this.response_status === this.missing_status_code;
    }
  },

  this.process = function(response_body, offline){
    parser.parse(response_body, this.config, function(err, requested){

      if (err || !requested)
        return logger.error(_error(err || 'Got empty instruction set.'));

      if (!offline && requested.offline_actions){
        fs.writeFile(self.cached_response_file, response_body, function(err){
          if (err) logger.error(err);
          else self.log('Stored cached version instruction set.');
        });
      }

//     var status_msg = this.marked_as_missing() ? "HOLY SHMOLY, DEVICE IS MISSING!" : "Device not missing. Sweet.";
 //    logger.info(status_msg, 'bold');

      try {
        var report_url = requested.endpoints.report.control_panel.url;
        self.endpoints.location.url = report_url;
      } catch(e) { }

      self.check_active_reports(requested.reports);
      self.emit_requested(requested);
    });
  };

  this.cancel_report = function(report_name){
    // this.log('Cancelling ' + report_name + ' report.');
    this.emit('cancel', report_name);
    delete this.active_reports[report_name];
  };

  this.check_active_reports = function(reports){
  // cancel reports that were turned off
    for (var report_name in this.active_reports){
      if (!reports[report_name]) {
        this.cancel_report(report_name);
      }
    }

  // and add to active the ones that were requested
    for (report_name in reports){
      var rep = reports[report_name];
      if (rep.interval) // persistent report requested
        this.active_reports[report_name] = rep.interval;
    }
  };

  this.send_data = function(key, data, callback){
    if (Object.keys(data).length === 0) return;
    self.log("Sending " + key + " data...");
    // console.log(JSON.stringify(data, null, 2))
    var endpoint = this.endpoints[key] ? this.endpoints[key] : this.endpoints.device;

    var options = {
      url: endpoint.url,
      method: endpoint.method,
      username: this.config.api_key,
      password: 'x'
    };
    dispatcher.send('http', data, options, callback);
  };

  this.send_events = function(){
    this.send_data('events', {events: this.events});
    this.events = {};
  };

 this.emit_requested = function(requested){
    this.log("Processing requested instructions...");

    for (var setting in requested.settings)
      this.emit('set', setting, requested.settings[setting]);

    for (var data in requested.data)
      this.emit('get', data, requested.data[data]);

    for (var report in requested.reports)
      this.emit('report', report, requested.reports[report]);

    if (requested.actions && Object.keys(requested.actions).length > 0)
      this.emit('actions', requested.actions);

    for (var driver in requested.drivers)
      this.emit('driver', driver, requested.drivers[driver]);
  };

  this.check_keys = function(callback){
    if (this.config.device_key === ""){
      logger.warn("Device key not present.");
      if (this.config.api_key === "")
        callback(_error("No API key found. Please set up your account."));
      else
        this.register_device(callback);
    } else {
      callback();
    }
  };

  this.register_device = function(cb){
    logger.info("Attaching device to your account...");
    var register = require('./register');

    register({api_key: this.config.api_key}, function(err, data){
      if (err || !data.device_key)
        return cb(err || new Error("Couldn't register this device. Try again in a sec."));

      logger.info("Device succesfully created. Key: " + data.device_key);
      self.config.device_key = data.device_key;

      common.config.update('control-panel', {device_key: data.device_key}, cb);
    });

  };

  this.run_setup = function(callback){
    console.log('Please configure your account by running: ');
    console.log(' $ bin/config account setup\n\n');
    process.exit(1);
  };

};

util.inherits(ControlPanelDriver, Emitter);

var instance;

exports.load = function(options, callback){
  instance = new ControlPanelDriver(options);
  instance.load(callback);
};

exports.unload = function(){
  instance.unload();
};