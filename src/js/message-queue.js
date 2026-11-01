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
      return name === contextKey || name === 'CONTEXT_DATA' || name === contextRequestKey || name === 'REQUEST_CONTEXT';
    }) && byteArray(payload[contextKey] === undefined ? payload.CONTEXT_DATA : payload[contextKey])) { return 'context'; }
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
