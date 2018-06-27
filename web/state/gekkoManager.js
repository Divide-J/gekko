const _ = require('lodash');
const moment = require('moment');
const promisify = require('tiny-promisify');

const broadcast = require('./cache').get('broadcast');
const Logger = require('./logger');
const pipelineRunner = promisify(require('../../core/workers/pipeline/parent'));
const reduceState = require('./reduceState');

const GekkoManager = function() {
  this.gekkos = {};
  this.loggers = {};

  this.finishedGekkos = {};
}

GekkoManager.prototype.add = function({mode, config}) {
  // set type
  let type;
  if(mode === 'realtime') {
    if(config.market && config.market.type)
      type = config.market.type;
    else
      type = 'watcher';
  } else {
    type = '';
  }

  let logType = type;
  if(logType === 'leech') {
    if(config.trader && config.trader.enabled)
      logType = 'tradebot';
    else
      logType = 'papertrader';
  }

  const now = moment().format('YYYY-MM-DD-HH-mm');
  const n = (Math.random() + '').slice(3);
  const id = `${now}-${logType}-${n}`;

  // make sure we catch events happening inside te gekko instance
  config.childToParent.enabled = true;

  const state = {
    mode,
    config,
    id,
    type,
    logType,
    active: true,
    initialEvents: {},
    latestEvents: {},
    start: moment()
  }

  this.gekkos[id] = state;

  this.loggers[id] = new Logger(logType);

  // start the actual instance
  pipelineRunner(mode, config, this.handleRawEvent(id));

  // after passing API credentials to the actual instance we mask them
  if(logType === 'trader') {
    config.trader.key = '[REDACTED]';
    config.trader.secret = '[REDACTED]';
  }

  return state;
}

GekkoManager.prototype.handleRawEvent = function(id) {
  const logger = this.loggers[id];

  return (err, event) => {
    if(err) {
      return this.handleFatalError(id);
    }

    if(!event || !event.type) {
      return;
    }

    if(event.log) {
      return logger.write(event.log);
    }

    this.handleGekkoEvent(id, event);
  }
}

GekkoManager.prototype.handleGekkoEvent = function(id, event) {
  this.gekkos[id] = reduceState(this.gekkos[id], event);
  broadcast({
    type: 'gekko_update',
    id,
    event
  });
  console.log(this.gekkos[id]);
}


GekkoManager.prototype.handleFatalError = function(id) {
  const state = this.gekkos[id];

  if(!state || state.errored)
    return;

  state.errored = true;
  state.active = false;
  console.error('RECEIVED ERROR IN GEKKO INSTANCE', id);
  console.error(err);
  return broadcast({
    type: 'gekko_error',
    id,
    error: err
  });
}

GekkoManager.prototype.stop = function(id) {
  // todo
}

GekkoManager.prototype.delete = function(id) {
  // todo
}

GekkoManager.prototype.list = function() {
  return this.gekkos;
}

module.exports = GekkoManager;