'use strict';

// Theme settings, complication snapshots and contextual snapshots share one
// AppMessage channel. Serialize them so one source cannot make another busy.
module.exports = function createMessageQueue(options) {
  var pending = [];
  var active = null;
  var keys=options.keys || {};
  function named(name,fallback) { return String(keys[name] === undefined ? fallback : keys[name]); }
  var complicationKey=named('COMPLICATION_DATA',10021), contextKey=named('CONTEXT_DATA',10023);
  var contextRequestKey=named('REQUEST_CONTEXT',10024);
  var contextStateKey=named('CONTEXT_STATE',10025);
  // A host can register another bounded snapshot channel without giving the
  // queue ownership of its protocol. Its data and session/event sidecars stay
  // one dictionary; unlisted fields (including settings) retain FIFO order.
  function aliases(key) {
    if ((typeof key !== 'string' && typeof key !== 'number') || String(key) === '' ||
        (typeof key === 'number' && (!isFinite(key) || key<0 || key>4294967295 || key%1))) {
      throw new TypeError('A snapshot key must be a message-key name or number');
    }
    var values=[String(key)];
    if (Object.prototype.hasOwnProperty.call(keys,key)) {
      var mapped=String(keys[key]);
      if (values.indexOf(mapped)<0) { values.push(mapped); }
    }
    return values;
  }
  var declarations=options.snapshotChannels === undefined ? [] : options.snapshotChannels;
  if (!Array.isArray(declarations) || declarations.length>16) {
    throw new TypeError('snapshotChannels must be an array of at most 16 channels');
  }
  var channelNames=['complications','context'], dataNames=[];
  var extensions=declarations.map(function(spec) {
    if (!spec || typeof spec.name !== 'string' || !spec.name || channelNames.indexOf(spec.name)>=0 ||
        !Array.isArray(spec.sidecarKeys === undefined ? [] : spec.sidecarKeys)) {
      throw new TypeError('A snapshot channel needs a unique name and sidecar key array');
    }
    var data=aliases(spec.dataKey), allowed=data.slice();
    var reserved=[complicationKey,contextKey,'COMPLICATION_DATA','CONTEXT_DATA'];
    if (data.some(function(key) { return reserved.indexOf(key)>=0 || dataNames.indexOf(key)>=0; })) {
      throw new TypeError('Snapshot data keys must identify a distinct channel');
    }
    (spec.sidecarKeys || []).forEach(function(key) {
      aliases(key).forEach(function(value) { if (allowed.indexOf(value)<0) { allowed.push(value); } });
    });
    channelNames.push(spec.name);dataNames=dataNames.concat(data);
    return {name:spec.name,data:data,allowed:allowed};
  });
  function byteArray(value) {
    return Array.isArray(value) || Object.prototype.toString.call(value) === '[object Uint8Array]';
  }
  function channel(payload) {
    var names=Object.keys(payload);
    var comp=names.indexOf(complicationKey)>=0 || names.indexOf('COMPLICATION_DATA')>=0;
    var context=names.indexOf(contextKey)>=0 || names.indexOf('CONTEXT_DATA')>=0;
    if (comp && !context && names.every(function(name) { return name === complicationKey || name === 'COMPLICATION_DATA'; }) &&
        names.every(function(name) { return byteArray(payload[name]); })) { return 'complications'; }
    if (context && !comp && names.every(function(name) {
      return name === contextKey || name === 'CONTEXT_DATA' || name === contextRequestKey || name === 'REQUEST_CONTEXT' ||
        name === contextStateKey || name === 'CONTEXT_STATE';
    }) && byteArray(payload[contextKey] === undefined ? payload.CONTEXT_DATA : payload[contextKey])) { return 'context'; }
    for (var i=0;i<extensions.length;i++) {
      var spec=extensions[i];
      var present=names.filter(function(name) { return spec.data.indexOf(name)>=0; });
      if (present.length === 1 && byteArray(payload[present[0]]) && names.every(function(name) {
        return spec.allowed.indexOf(name)>=0;
      })) { return spec.name; }
    }
    // Mixed payloads may contain user settings; they always retain FIFO order.
    return '';
  }
  function settle(entry,ok,error) {
    if (entry.settled) { return; }
    entry.settled=true;
    var callback=ok ? entry.success : entry.failure;
    if (typeof callback === 'function') { callback(error); }
  }
  function drain() {
    if (active || !pending.length) { return; }
    var entry = pending.shift();
    active = entry;
    var done = false;
    var timer = options.later(function() { finish(false, {code:'TIMEOUT'}); }, 15000);
    function finish(ok, error) {
      if (done) { return; }
      done = true;
      options.cancelLater(timer);
      if (active === entry) { active = null; }
      try { settle(entry,ok,error); }
      finally { drain(); }
    }
    try { options.send(entry.payload, function() { finish(true); }, function(error) { finish(false, error); }); }
    catch (error) { finish(false, error); }
  }
  var send=function(payload, success, failure) {
    var copy = {};
    Object.keys(payload).forEach(function(key) {
      copy[key] = byteArray(payload[key]) ? Array.prototype.slice.call(payload[key]) : payload[key];
    });
    var entry={payload:copy,success:success,failure:failure,channel:channel(copy),settled:false};
    var replace=-1;
    if (entry.channel) {
      for (var i=0; i<pending.length; i++) { if (pending[i].channel === entry.channel) { replace=i; break; } }
    }
    if (replace>=0) {
      var obsolete=pending.splice(replace,1)[0];
      // The latest snapshot takes its actual submission position relative to
      // settings. Superseded entries fail explicitly; they never receive ACKs.
      pending.push(entry);
      try { settle(obsolete,false,{code:'SUPERSEDED'}); }
      finally { drain(); }
      return;
    } else {
      if (pending.length >= 16) { settle(entry,false,{code:'BUSY'}); return; }
      pending.push(entry);
    }
    drain();
  };
  // Coordinators can publish a replacement immediately instead of retaining
  // stale copied bytes behind the shared transport's active settings transfer.
  send.supersedesSnapshots=true;
  return send;
};
