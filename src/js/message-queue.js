'use strict';

// Theme settings, complication snapshots and contextual snapshots share one
// AppMessage channel. Serialize them so one source cannot make another busy.
module.exports = function createMessageQueue(options) {
  var pending = [];
  var active = null;
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
      var callback = ok ? entry.success : entry.failure;
      try { if (typeof callback === 'function') { callback(error); } }
      finally { drain(); }
    }
    try { options.send(entry.payload, function() { finish(true); }, function(error) { finish(false, error); }); }
    catch (error) { finish(false, error); }
  }
  return function send(payload, success, failure) {
    if (pending.length >= 16) {
      if (typeof failure === 'function') { failure({code:'BUSY'}); }
      return;
    }
    var copy = {};
    Object.keys(payload).forEach(function(key) {
      copy[key] = Array.isArray(payload[key]) ? payload[key].slice() : payload[key];
    });
    pending.push({payload:copy,success:success,failure:failure});
    drain();
  };
};
