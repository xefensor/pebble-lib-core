'use strict';

var wire = require('./complication-data');
var STATUS = {EMPTY:0, LOADING:1, READY:2, UNAVAILABLE:3, DENIED:4, UNSUPPORTED:5, DISABLED:6, EXPIRED:7};
var NAMES = ['empty','loading','ready','unavailable','denied','unsupported','disabled','expired'];
var DEFAULT_CACHE_KEY = 'watchface-core-complications-v1';
var REFRESH = 30 * 60000;
var MAX_AGE = 7200;
var MAX_EPOCH = 4294967295;
var VISIBLE_SLOTS = 2;

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { return typeof value === 'number' && isFinite(value); }
function identifier(value) { return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value); }
function textOf(property) { return object(property) && object(property.shortText) ? property.shortText.text : null; }
function codeOf(error) {
  return error && typeof error.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code) ? error.code : 'UNKNOWN';
}
function messageOf(error) {
  if (!error || typeof error.message !== 'string') { return ''; }
  var text = error.message.replace(/[\x00-\x1f\x7f-\x9f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g, ' ')
    .replace(/ +/g, ' ').trim();
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var character = text[i];
    var code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      character += text[++i];
    } else if (code >= 0xd800 && code <= 0xdfff) { character = '\ufffd'; }
    if (out.length + character.length > 180) { break; }
    out += character;
  }
  return out;
}
function bytesOf(value, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) { return null; }
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = [];
  for (var i = 0; i < value.length; i += 4) {
    var a = alphabet.indexOf(value[i]);
    var b = alphabet.indexOf(value[i + 1]);
    var c = value[i + 2] === '=' ? 0 : alphabet.indexOf(value[i + 2]);
    var d = value[i + 3] === '=' ? 0 : alphabet.indexOf(value[i + 3]);
    if (value[i + 2] === '=' && (b & 15) || value[i + 3] === '=' && value[i + 2] !== '=' && (c & 3)) { return null; }
    out.push((a << 2) | (b >> 4));
    if (value[i + 2] !== '=') { out.push(((b & 15) << 4) | (c >> 2)); }
    if (value[i + 3] !== '=') { out.push(((c & 3) << 6) | d); }
  }
  return out.length <= max ? out : null;
}
function bitmapOf(shape, image) {
  if (!object(shape) || !Number.isInteger(shape.width) || !Number.isInteger(shape.height) ||
      shape.width < 1 || shape.width > 24 || shape.height < 1 || shape.height > 24) { return null; }
  var palette = bytesOf(shape.palette, 16);
  var sourcePixels = bytesOf(shape.pixels, 288);
  // Source ImageShape uses tightly packed 4bpp rows. The watch transport has
  // its own four-byte-aligned stride, so copy visible nibbles instead of
  // assuming a square 24px source (where the two strides happen to match).
  var sourceStride = Math.ceil(shape.width / 2);
  var stride = ((shape.width + 7) >> 3) * 4;
  if (!palette || !palette.length || !sourcePixels || sourcePixels.length !== sourceStride * shape.height) { return null; }
  var pixels = [];
  for (var i = 0; i < stride * shape.height; i++) { pixels.push(0); }
  for (var y = 0; y < shape.height; y++) {
    for (var x = 0; x < shape.width; x++) {
      var sourceByte = sourcePixels[y * sourceStride + (x >> 1)];
      var value = x & 1 ? sourceByte & 15 : sourceByte >> 4;
      if (value >= palette.length) { return null; }
      pixels[y * stride + (x >> 1)] |= x & 1 ? value : value << 4;
    }
  }
  return {width:shape.width, height:shape.height, palette:palette, pixels:pixels, image:image};
}
function readingOf(property) {
  if (!object(property)) { return {error:'PROPERTY_UNAVAILABLE', status:STATUS.UNAVAILABLE}; }
  var bitmap = bitmapOf(property.icon, false) || bitmapOf(property.image, true);
  var text = object(property.shortText) ? wire.normalizeText(property.shortText.text) : '';
  var value = {};
  if (!text && object(property.numericValue) && finite(property.numericValue.value) &&
      (property.numericValue.unit === undefined || typeof property.numericValue.unit === 'string' &&
        property.numericValue.unit.length <= 64 && !/[\x00-\x1f\x7f]/.test(property.numericValue.unit))) {
    text = wire.normalizeText(String(property.numericValue.value) +
      (property.numericValue.unit ? ' ' + property.numericValue.unit : ''));
  }
  if (!text && object(property.longText)) { text = wire.normalizeText(property.longText.text); }
  if (text) { value.text = text; }
  else if (object(property.boolean) && typeof property.boolean.value === 'boolean') { value.booleanValue = property.boolean.value; }
  else if (object(property.timestamp) && Number.isInteger(property.timestamp.value) &&
      property.timestamp.value > 0 && property.timestamp.value <= MAX_EPOCH) { value.timestamp = property.timestamp.value; }
  if (bitmap) { value.bitmap = bitmap; }
  if (Object.keys(value).length) { return {value:value, status:STATUS.READY}; }
  return {status:property.series ? STATUS.UNSUPPORTED : STATUS.UNAVAILABLE,
    error:property.series ? 'SERIES_UNSUPPORTED' : 'INVALID_DATA'};
}

function labelOf(slot) {
  return wire.normalizeText(slot.label || slot.property.replace(/_/g,' '),24);
}
function utf8Size(text) {
  var length=0;
  for (var i=0; i<text.length; i++) {
    var point=text.charCodeAt(i);
    if (point>=0xd800 && point<=0xdbff && text.charCodeAt(i+1)>=0xdc00 && text.charCodeAt(i+1)<=0xdfff) { length+=4; i++; }
    else { length+=point<0x80 ? 1 : point<0x800 ? 2 : 3; }
  }
  return length;
}
function semanticOf(slot,property,value) {
  var kind=wire.SEMANTIC_KIND, source=wire.SOURCE_KIND, detail=wire.DETAIL_KIND;
  var result={kind:kind.GENERIC,source:source.OTHER,label:labelOf(slot),detail:detail.NONE,qualifiers:0};
  var weather=slot.category === 'weather' && slot.item === 'location';
  if (weather) { result.source=source.WEATHER; }
  else if (slot.category === 'phone') { result.source=source.PHONE; }
  else if (slot.category === 'music') { result.source=source.MUSIC; }
  else if (slot.category === 'notifications') { result.source=source.NOTIFICATION; }
  var numeric=object(property) && property.numericValue;
  if (object(numeric) && finite(numeric.value) &&
      (numeric.unit === undefined || typeof numeric.unit === 'string' && numeric.unit.length<=64 && !/[\x00-\x1f\x7f]/.test(numeric.unit))) {
    result.value=numeric.value;
    if (numeric.unit) {
      var unit=wire.normalizeText(numeric.unit);
      if (utf8Size(unit)<=16) { result.unit=unit; }
    }
    if (finite(numeric.min) && finite(numeric.max) && numeric.min<=numeric.max) {
      result.min=numeric.min; result.max=numeric.max;
    } else if (numeric.min === undefined && finite(numeric.max)) { result.max=numeric.max; }
    else if (numeric.max === undefined && finite(numeric.min)) { result.min=numeric.min; }
    result.kind=kind.NUMBER;
  } else if (typeof value.booleanValue === 'boolean') {
    result.kind=kind.BOOLEAN; result.value=value.booleanValue ? 1 : 0;
  } else if (Number.isInteger(value.timestamp)) { result.kind=kind.TIMESTAMP; }
  if (weather) {
    var details={temperature:detail.TEMPERATURE,feels_like:detail.FEELS_LIKE,high:detail.HIGH,low:detail.LOW,
      humidity:detail.HUMIDITY,wind_speed:detail.WIND_SPEED,
      wind_direction:detail.WIND_DIRECTION,uv_index:detail.UV,condition:detail.CONDITION,condition_code:detail.CONDITION};
    result.detail=details[slot.property] || detail.NONE;
    if (['temperature','feels_like','high','low'].indexOf(slot.property)>=0) { result.kind=kind.TEMPERATURE; }
    else if (slot.property === 'precipitation' && precipitationStyle(slot,property,value)) {
      result.kind=kind.PRECIPITATION; result.detail=detail.PRECIPITATION;
    }
    else if (slot.property === 'humidity') { result.kind=kind.HUMIDITY; }
    else if (['wind_speed','wind_direction'].indexOf(slot.property)>=0) { result.kind=kind.WIND; }
    else if (slot.property === 'uv_index') { result.kind=kind.UV; }
    else if (slot.property === 'condition' || slot.property === 'condition_code') { result.kind=kind.CONDITION; }
  } else if (slot.category === 'phone' && slot.item === 'phone_state' && slot.property === 'battery_level') {
    result.kind=kind.BATTERY; result.detail=detail.PHONE_BATTERY;
  }
  return result;
}
// Missing values retain only a configured public identity. Do not keep a
// private label, value, image or measurement time merely to explain a failure.
function publicIdentity(slot,semantic) {
  if (!slot || slot.invalid || privateDescriptor(slot) || privateRecord({semantic:semantic})) { return null; }
  var value=semantic || semanticOf(slot,null,{});
  var result={kind:value.kind,source:value.source,detail:value.detail || 0,
    qualifiers:value.qualifiers || 0,label:labelOf(slot)};
  if (typeof value.unit === 'string') { result.unit=value.unit; }
  return result;
}
function observationProperties(slot) {
  if (slot.category !== 'weather' || slot.item !== 'location') { return []; }
  if (slot.property === 'temperature') { return ['observed_at','is_forecast']; }
  if (['feels_like','high','low'].indexOf(slot.property)>=0) { return ['is_forecast']; }
  if (slot.property === 'humidity') { return ['humidity_observed_at']; }
  if (slot.property === 'wind_speed' || slot.property === 'wind_direction') { return ['wind_observed_at']; }
  return [];
}
function observedAt(slot,instance,receivedAt) {
  var properties=object(instance) && instance.properties;
  if (!object(properties)) { return null; }
  var names=observationProperties(slot);
  if (!names.length) { return null; }
  var forecast=properties.is_forecast;
  if (slot.property === 'temperature' && object(forecast) && object(forecast.boolean) && forecast.boolean.value === true) { return null; }
  var observation=properties[names[0]];
  var stamp=object(observation) && object(observation.timestamp) && observation.timestamp.value;
  return Number.isInteger(stamp) && stamp>0 && stamp<=receivedAt ? stamp : null;
}
function privateDescriptor(slot) {
  return slot && (slot.category === 'music' || slot.category === 'notifications');
}
function privateRecord(record) {
  return record && record.semantic && (record.semantic.source === wire.SOURCE_KIND.MUSIC ||
    record.semantic.source === wire.SOURCE_KIND.NOTIFICATION);
}
function persistentSignature(slots,prefix) {
  return (prefix === undefined ? 'two:' : prefix)+JSON.stringify(slots.map(function(slot) {
    if (!privateDescriptor(slot) || !slot.label) { return slot; }
    var copy=Object.assign({},slot); delete copy.label; return copy;
  }));
}

// A percentage alone is not evidence of rain. Only Pebble's standard weather
// precipitation reading may request the droplet presentation, and its text
// must still be a usable probability in the provider's own format.
function precipitationStyle(slot, property, value) {
  if (slot.category !== 'weather' || slot.item !== 'location' || slot.property !== 'precipitation' ||
      !object(property) || !value || typeof value.text !== 'string') { return 0; }
  var match = /^(\d+(?:[.,]\d+)?)\s*%$/.exec(value.text);
  if (!match) { return 0; }
  var shown = Number(match[1].replace(',', '.'));
  if (!finite(shown) || shown < 0 || shown > 100) { return 0; }
  if (property.numericValue !== undefined) {
    var numeric = property.numericValue;
    if (!object(numeric) || !finite(numeric.value) || numeric.value < 0 || numeric.value > 100 || numeric.unit !== '%') { return 0; }
    // Compact text may round a more precise value. Accept only that rounding
    // interval; a contradictory numeric reading must not acquire a rain icon.
    var decimals = (match[1].split(/[.,]/)[1] || '').length;
    if (Math.abs(shown - numeric.value) > 0.5 * Math.pow(10, -decimals) + 1e-10) { return 0; }
  }
  return 1;
}

module.exports = function(options) {
  var cacheKey = typeof options.cacheKey === 'string' && options.cacheKey.length
      ? options.cacheKey : DEFAULT_CACHE_KEY;
  var pebble = options.pebble || {};
  var descriptors = [null,null];
  var records = [null,null];
  var identities = [null,null];
  var states = [0,0];
  var errors = ['',''];
  var messages = ['',''];
  var fromCache = [false,false];
  var hasPreferences = false;
  var signature = '';
  var preferenceGeneration = 0;
  var sourceGeneration = 0;
  var preferenceSubscription = null;
  var subscriptions = [];
  var refreshTimer = null;
  var expiryTimer = null;
  var available = typeof pebble.subscribeToSource === 'function';
  var preferenceError = '';
  var preferenceMessage = '';
  var recoveryTimer = null;
  var recoveryAttempt = 0;
  var pending = null;
  var sending = false;
  var deliveryTimer = null;
  var deliveryGeneration = 0;

  function now() { return Math.floor(options.now() / 1000); }
  function valid(record) {
    return record && Number.isInteger(record.confirmedAt) && record.confirmedAt > 0 && record.confirmedAt <= now() &&
      Number.isInteger(record.validUntil) && now() < record.validUntil && record.validUntil <= MAX_EPOCH &&
      record.validUntil <= record.confirmedAt + MAX_AGE;
  }
  function save() {
    var cacheable=records.map(function(record,i) {
      return privateDescriptor(descriptors[i]) || privateRecord(record) ? null : record;
    });
    try { options.storage.setItem(cacheKey, JSON.stringify({signature:persistentSignature(descriptors), records:cacheable})); } catch (ignored) {}
  }
  function sanitizeStoredCache() {
    try {
      var cached=JSON.parse(options.storage.getItem(cacheKey));
      if (!cached || !Array.isArray(cached.records)) { return; }
      var encoded=typeof cached.signature === 'string' ? cached.signature : '';
      var choices;
      try { choices=JSON.parse(encoded.indexOf('two:') === 0 ? encoded.slice(4) : encoded); } catch (ignored) {}
      var changed=false;
      var safe=cached.records.map(function(record,i) {
        // Legacy cache descriptors still identify music and notification data.
        // Unclassifiable records are discarded rather than retained privately
        // while the preview API or preference permission is unavailable.
        if (record && (!Array.isArray(choices) || !choices[i] || privateDescriptor(choices[i]) || privateRecord(record))) {
          changed=true; return null;
        }
        return record;
      });
      var safeSignature=Array.isArray(choices) ? persistentSignature(choices,encoded.indexOf('two:') === 0 ? 'two:' : '') : cached.signature;
      if (safeSignature !== cached.signature) { changed=true; }
      if (changed) { options.storage.setItem(cacheKey,JSON.stringify({signature:safeSignature,records:safe})); }
    } catch (ignored) {}
  }
  function load() {
    try {
      var cached = JSON.parse(options.storage.getItem(cacheKey));
      if (!cached || cached.signature !== persistentSignature(descriptors) || !Array.isArray(cached.records) || cached.records.length !== VISIBLE_SLOTS) { return; }
      cached.records.forEach(function(record, i) {
        if (descriptors[i] && !descriptors[i].invalid && !privateDescriptor(descriptors[i]) && !privateRecord(record) && valid(record) &&
            wire.packComplications([rendered(record)], now())[7] === STATUS.READY) {
          // Old public caches retain their original values/times, while the
          // current descriptor can supply newly introduced meaning metadata.
          var identified=semanticOf(descriptors[i],null,{});
          record.semantic=Object.assign({},identified,record.semantic || {});
          record.semantic.source=identified.source;
          record.semantic.detail=identified.detail;
          if (identified.kind !== wire.SEMANTIC_KIND.GENERIC) { record.semantic.kind=identified.kind; }
          if (descriptors[i].category === 'weather' && descriptors[i].item === 'location' &&
              descriptors[i].property === 'precipitation' && record.semantic.kind === wire.SEMANTIC_KIND.PRECIPITATION) {
            record.semantic.detail=wire.DETAIL_KIND.PRECIPITATION;
          }
          if (!(record.semantic.qualifiers & wire.QUALIFIERS.FORECAST) && Number.isInteger(record.observedAt) &&
              record.observedAt>0 && record.observedAt<=record.confirmedAt) {
            record.semantic.observedAt=record.observedAt;
          }
          records[i] = record; states[i] = STATUS.READY;
          identities[i]=publicIdentity(descriptors[i],record.semantic);
          fromCache[i]=true;
        }
      });
    } catch (ignored) {}
  }
  function cancelDelivery() {
    deliveryGeneration++;
    if (deliveryTimer !== null) { options.cancelLater(deliveryTimer); }
    deliveryTimer = null; pending = null; sending = false;
  }
  function cancelRecovery() {
    if (recoveryTimer !== null) { options.cancelLater(recoveryTimer); }
    recoveryTimer = null;
    recoveryAttempt = 0;
  }
  function needsRecovery() {
    return available && hasPreferences && descriptors.some(function(slot, i) {
      return slot && !slot.invalid && errors[i] === 'PLUGIN_UNAVAILABLE';
    });
  }
  function scheduleRecovery() {
    if (!needsRecovery()) { cancelRecovery(); return; }
    if (recoveryTimer !== null) { return; }
    var expected = signature;
    var delay = [5000,15000,60000,120000][recoveryAttempt];
    recoveryTimer = options.later(function() {
      recoveryTimer = null;
      if (signature !== expected || !needsRecovery()) { return; }
      recoveryAttempt = Math.min(recoveryAttempt + 1, 3);
      // Re-resolve the same generic sources. Keep the normal thirty-minute
      // preferences refresh independent from this bounded registration retry.
      sources(); publish(); scheduleRecovery();
    }, delay);
  }
  function pump() {
    if (sending || !pending) { return; }
    var payload = pending;
    pending = null; sending = true;
    var generation = deliveryGeneration;
    function attempt(number) {
      if (generation !== deliveryGeneration) { return; }
      var done = false;
      function finish(ok,error) {
        if (done || generation !== deliveryGeneration) { return; }
        done = true;
        options.cancelLater(deliveryTimer); deliveryTimer = null;
        if (!ok && (!error || error.code !== 'SUPERSEDED') && !pending && number < 3) {
          deliveryTimer = options.later(function() { attempt(number + 1); }, number * 1000);
          return;
        }
        sending = false;
        if (!ok && (!error || error.code !== 'SUPERSEDED') && options.log) { options.log('Complication delivery failed'); }
        pump();
      }
      deliveryTimer = options.later(function() { finish(false); }, 10000);
      try { options.send(payload, function() { finish(true); }, function(error) { finish(false,error); }); }
      catch (ignored) { finish(false); }
    }
    attempt(1);
  }
  function rendered(record) {
    var value = Object.assign({}, record, {status:STATUS.READY});
    if (typeof record.booleanValue === 'boolean') {
      var text;
      try { text = options.localizeBoolean && options.localizeBoolean(record.booleanValue, options.getSettings().language); } catch (ignored) {}
      value.text = wire.normalizeText(text) || (record.booleanValue ? 'On' : 'Off');
    }
    return value;
  }
  function publish() {
    if (!hasPreferences && available) { return; }
    var slots = records.map(function(record, i) {
      if (valid(record)) { return rendered(record); }
      if (record) { records[i] = null; states[i] = STATUS.EXPIRED; errors[i] = 'SOURCE_EXPIRED'; messages[i] = ''; }
      var missing={status:states[i]};
      if (states[i] !== STATUS.EMPTY && identities[i]) { missing.semantic=identities[i]; }
      return missing;
    });
    var payload = {};
    payload[options.keys.COMPLICATION_DATA] = wire.packComplications(slots, now());
    if (options.send.supersedesSnapshots && sending) { cancelDelivery(); }
    pending = payload; pump();
  }
  function scheduleExpiry() {
    if (expiryTimer !== null) { options.cancelLater(expiryTimer); }
    expiryTimer = null;
    var end = Infinity;
    records.forEach(function(record) { if (valid(record)) { end = Math.min(end, record.validUntil); } });
    if (end !== Infinity) {
      expiryTimer = options.later(function() { expiryTimer = null; publish(); save(); scheduleExpiry(); },
        Math.max(1, end * 1000 - options.now()));
    }
  }
  function closeSources() {
    sourceGeneration++;
    subscriptions.forEach(function(subscription) { try { if (subscription && subscription.unsubscribe) { subscription.unsubscribe(); } } catch (ignored) {} });
    subscriptions = [];
  }
  function sourceError(group, error) {
    var code = codeOf(error);
    var status = code === 'PERMISSION_DENIED' ? STATUS.DENIED : code === 'PLUGIN_DISABLED' ? STATUS.DISABLED :
      code === 'UNSUPPORTED' || code === 'INVALID_REQUEST' ? STATUS.UNSUPPORTED : STATUS.UNAVAILABLE;
    var terminal = ['PERMISSION_DENIED','PLUGIN_DISABLED','PLUGIN_UNAVAILABLE','SOURCE_UNAVAILABLE','SOURCE_NOT_FOUND','NOT_FOUND','UNSUPPORTED','INVALID_REQUEST'].indexOf(code) >= 0;
    group.slots.forEach(function(i) {
      errors[i] = code;
      messages[i] = messageOf(error);
      if (terminal || !valid(records[i])) { records[i] = null; states[i] = status; fromCache[i]=false; }
    });
    publish(); save(); scheduleExpiry(); scheduleRecovery();
  }
  function sources() {
    closeSources();
    var generation = sourceGeneration;
    var groups = {};
    descriptors.forEach(function(slot, i) {
      if (!slot || slot.invalid) { return; }
      var key = JSON.stringify([slot.category,slot.item]);
      if (!groups[key]) { groups[key] = {category:slot.category,item:slot.item,properties:[],slots:[]}; }
      var group = groups[key];
      group.slots.push(i);
      if (group.properties.indexOf(slot.property) < 0) { group.properties.push(slot.property); }
      observationProperties(slot).forEach(function(name) {
        if (group.properties.indexOf(name)<0) { group.properties.push(name); }
      });
    });
    Object.keys(groups).forEach(function(key) {
      if (generation !== sourceGeneration) { return; }
      var group = groups[key];
      try {
        var handle = pebble.subscribeToSource({category:group.category,item:group.item,properties:group.properties,
          iconPixelSize:{w:24,h:24},onData:function(envelope) {
            if (generation !== sourceGeneration) { return; }
            group.slots.forEach(function(i) { messages[i] = ''; });
            var confirmedAt = now();
            var until = Math.min(confirmedAt + MAX_AGE, MAX_EPOCH);
            var expiry = envelope && envelope.validUntilMs;
            if (expiry !== undefined && expiry !== null) {
              if (!finite(expiry)) {
                group.slots.forEach(function(i) { records[i] = null; states[i] = STATUS.UNAVAILABLE; errors[i] = 'INVALID_EXPIRY'; });
                publish(); save(); scheduleExpiry(); scheduleRecovery(); return;
              }
              until = Math.min(until, Math.floor(expiry / 1000));
            }
            if (!envelope || !Array.isArray(envelope.instances) || until <= confirmedAt) {
              group.slots.forEach(function(i) { records[i] = null; states[i] = STATUS.UNAVAILABLE; errors[i] = 'INVALID_DATA'; });
            } else {
              group.slots.forEach(function(i) {
                var slot = descriptors[i];
                var instance = envelope.instances[slot.index];
                var property = instance && object(instance.properties) && instance.properties[slot.property];
                var parsed = readingOf(property);
                if (parsed.value) {
                  parsed.value.displayKind = precipitationStyle(slot, property, parsed.value);
                  parsed.value.semantic=semanticOf(slot,property,parsed.value);
                  parsed.value.observedAt=observedAt(slot,instance,confirmedAt);
                  if (parsed.value.semantic.kind === wire.SEMANTIC_KIND.TEMPERATURE &&
                      object(instance.properties.is_forecast) && object(instance.properties.is_forecast.boolean) &&
                      instance.properties.is_forecast.boolean.value === true) {
                    parsed.value.semantic.qualifiers=wire.QUALIFIERS.FORECAST;
                    parsed.value.observedAt=null;
                  }
                  if (parsed.value.observedAt !== null) { parsed.value.semantic.observedAt=parsed.value.observedAt; }
                  identities[i]=publicIdentity(slot,parsed.value.semantic);
                }
                states[i] = parsed.status; errors[i] = parsed.error || '';
                fromCache[i]=false;
                records[i] = parsed.value ? Object.assign({}, parsed.value, {confirmedAt:confirmedAt,validUntil:until}) : null;
              });
            }
            publish(); save(); scheduleExpiry(); scheduleRecovery();
          },onError:function(error) { if (generation === sourceGeneration) { sourceError(group,error); } }});
        if (generation === sourceGeneration) { subscriptions.push(handle); }
        else if (handle && handle.unsubscribe) { handle.unsubscribe(); }
      } catch (error) { if (generation === sourceGeneration) { sourceError(group,error); } }
    });
  }
  function preferred(envelope) {
    if (!envelope || !Array.isArray(envelope.instances)) { preferenceError = 'INVALID_DATA'; preferenceMessage = ''; return; }
    var next = [null,null];
    var seen = {};
    envelope.instances.forEach(function(instance) {
      if (!instance || !/^[01]$/.test(instance.instanceId) || typeof instance.instanceId !== 'string') { return; }
      var i = Number(instance.instanceId);
      var p = instance.properties || {};
      var slot = {category:textOf(p.category),item:textOf(p.item),property:textOf(p.property),
        index:object(p.index) && object(p.index.numericValue) ? p.index.numericValue.value : null};
      var label=textOf(p.label);
      if (typeof label === 'string' && label.trim()) { slot.label=wire.normalizeText(label,24); }
      if (seen[i] || !identifier(slot.category) || !identifier(slot.item) || !identifier(slot.property) ||
          !Number.isSafeInteger(slot.index) || slot.index < 0) { slot = {invalid:true}; }
      seen[i] = true; next[i] = slot;
    });
    // The namespace also rejects old five-slot cache records, even if their
    // first two descriptors happen to match the new face's two choices.
    var nextSignature = 'two:' + JSON.stringify(next);
    preferenceError = '';
    preferenceMessage = '';
    if (hasPreferences && nextSignature === signature) { return; }
    var first = !hasPreferences;
    cancelRecovery(); closeSources(); cancelDelivery();
    descriptors = next; signature = nextSignature; hasPreferences = true;
    records = [null,null];
    identities=descriptors.map(function(slot) { return publicIdentity(slot); });
    fromCache = [false,false];
    states = descriptors.map(function(slot) { return !slot ? STATUS.EMPTY : slot.invalid ? STATUS.UNSUPPORTED : STATUS.LOADING; });
    errors = descriptors.map(function(slot) { return slot && slot.invalid ? 'INVALID_PREFERENCE' : ''; });
    messages = ['',''];
    if (first) { load(); }
    publish(); save(); scheduleExpiry(); sources();
  }
  function refresh() {
    available = typeof pebble.subscribeToSource === 'function';
    if (refreshTimer !== null) { options.cancelLater(refreshTimer); }
    if (!available) {
      cancelRecovery();
      preferenceGeneration++;
      try { if (preferenceSubscription && preferenceSubscription.unsubscribe) { preferenceSubscription.unsubscribe(); } } catch (ignored) {}
      preferenceSubscription = null;
      closeSources(); cancelDelivery(); states = [3,3]; records = [null,null]; fromCache = [false,false];
      errors = ['API_UNAVAILABLE','API_UNAVAILABLE'];
      messages = ['',''];
      preferenceError = 'API_UNAVAILABLE'; preferenceMessage = ''; publish(); return;
    }
    var privateCleared=false;
    records.forEach(function(record,i) {
      if (record && (privateDescriptor(descriptors[i]) || privateRecord(record))) {
        records[i]=null; states[i]=STATUS.LOADING; errors[i]=''; messages[i]=''; fromCache[i]=false;
        privateCleared=true;
      }
    });
    if (privateCleared) {
      // Reconnect/refresh requires a new source delivery for private readings.
      // Retain ordinary cached weather with its original receipt timestamp.
      closeSources(); publish(); save(); scheduleExpiry();
    }
    var alreadyConfigured = hasPreferences;
    var previousSourceGeneration = sourceGeneration;
    var generation = ++preferenceGeneration;
    try { if (preferenceSubscription && preferenceSubscription.unsubscribe) { preferenceSubscription.unsubscribe(); } } catch (ignored) {}
    preferenceSubscription = null;
    try {
      var handle = pebble.subscribeToSource({category:'preferences',item:'complications',
        onData:function(envelope) { if (generation === preferenceGeneration) { preferred(envelope); } },
        onError:function(error) {
          if (generation === preferenceGeneration) { preferenceError = codeOf(error); preferenceMessage = messageOf(error); }
        }});
      if (generation === preferenceGeneration) { preferenceSubscription = handle; }
      else if (handle && handle.unsubscribe) { handle.unsubscribe(); }
    } catch (error) { preferenceError = codeOf(error); preferenceMessage = messageOf(error); }
    if (alreadyConfigured && sourceGeneration === previousSourceGeneration) { sources(); publish(); }
    scheduleRecovery();
    refreshTimer = options.later(function() { refreshTimer = null; refresh(); }, REFRESH);
  }
  sanitizeStoredCache();
  return {refresh:refresh,configure:function() { publish(); scheduleExpiry(); },status:function() {
    var firstError = -1;
    for (var i = 0; i < errors.length; i++) { if (errors[i]) { firstError = i; break; } }
    return {available:available,configured:descriptors.filter(function(slot) { return slot; }).length,
      ready:records.filter(valid).length,error:preferenceError || errors.filter(function(error) { return error; })[0] || '',
      message:preferenceError ? preferenceMessage : firstError >= 0 ? messages[firstError] : '',
      slots:descriptors.map(function(slot, i) {
        var record=records[i], received=record && record.confirmedAt || null;
        var observed=record && Number.isInteger(record.observedAt) && record.observedAt>0 && record.observedAt<=now() ? record.observedAt : null;
        var safe=slot && (slot.category === 'weather' && slot.item === 'location' || slot.category === 'phone' && slot.item === 'phone_state');
        return {slot:i+1,category:slot && slot.category || '',item:slot && slot.item || '',
        index:slot && slot.index !== undefined ? slot.index : null,property:slot && slot.property || '',
        label:slot && !slot.invalid ? labelOf(slot) : '',
        text:safe && valid(record) && typeof record.text === 'string' ? record.text : null,
        receivedAt:received,receivedAgeSec:received === null ? null : Math.max(0,now()-received),
        observedAt:observed,observationAgeSec:observed === null ? null : now()-observed,cached:!!fromCache[i],
        status:NAMES[record && !valid(record) ? STATUS.EXPIRED : states[i]],error:errors[i],message:messages[i]}; })};
  }};
};
