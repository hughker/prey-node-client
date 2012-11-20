
/**
 * Get identifying keys from config file.
 **/
var get_keys = function(callback) {
  var common = _ns('common'),
      conf = common.config;

  callback({device:conf.get('control-panel','device_key'),api:conf.get('control-panel','api_key')});
};

/**
 * Must be called after initialize_installation.
 **/
var check_keys = function(callback) {
  get_keys(function(keys) {
    if(!keys.device) {
      _tr("Device key not present.");
    }

    if(!keys.api)
      return callback(_error("No API key found."));

    callback(null,keys);
  });
};

/**
 * Parameters that are specified in the gui (or whereever) are handled separately to the
 * other command line options so they may be handled in bulk.
 **/
var make_parameters = function(commander) {
  Object.keys(config_keys).forEach(function(key) {
    commander.option('--'+key+' <'+key+'>','');
  });
} ;

/**
 * Get a command line parameter value, and apply it's modifier.
 **/
var get_parameter_value = function(key) {
  var val = commander[key];
  if (val) {
    if(config_keys[key]) {
      // have a value modifer ...
      val = (config_keys[key])(val);
    }
  }
  return val;
};

/**
 * The commander object should hold all of the options that have been set by the user.
 * The keys are config_keys.
 **/
var update_config = function(installDir,callback) {

  Object.keys(config_keys).forEach(function(key) {
    var val = get_parameter_value(key);
    if (val) {
      // the modifier can set the param to null if it shouldn't be saved for
       // some reason
       config.set(key,val,true); // force option setting
    }
  });

  config.save(function(err) {
    if (err) return callback(_error(err));

    _tr('saved config ...');
    callback(null);
  });
};

/**
 * Make sure the prey.conf exists in the etc dir.
 **/
var check_config_file = function(callback) {
  var
    conf_dir = (platform === 'windows') ? _install_dir : '/etc/prey',
    conf_file = conf_dir + '/prey.conf';

  fs.exists(conf_file,function(exists) {
    if (!exists) {
      _tr(conf_file +' not found, copying default ...');
      utils.cp(_install_dir+'/current/prey.conf.default',conf_file,function(err) {
        if (err) return callback(_error(err));

        _tr('default prey.conf copied');
        callback(null);
      });
    } else {
      _tr('config file exists '+conf_file);
      callback(null);
    }
  });
};