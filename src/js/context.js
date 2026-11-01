'use strict';

var wire = require('./complication-data');
var KIND = wire.SEMANTIC_KIND;
var SOURCE = wire.SOURCE_KIND;
var LEASE = 120;
var NOTICE_SUMMARY_LIFE = 3;
var NOTICE_MESSAGE_LIFE = 8;
var NOTICE_QUIET = 3;
var NOTICE_STABLE_MS = 900;
var PAUSED_GRACE = 5;
var HEARTBEAT = 60000;
var MAX_EPOCH = 4294967295;
var DEFINITIONS = {
  music:{category:'music', item:'track', properties:['title','artist','playing','artwork']},
  notifications:{category:'notifications', item:'notification', properties:['name','body','app','package','app_icon']},
  phone:{category:'phone', item:'phone_state', properties:['battery_level']}
};

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { return typeof value === 'number' && isFinite(value); }
function tokenOf(value) {
  return finite(value) && Math.floor(value) === value && value>=2 && value<=2147483647 ? value : null;
}
function textOf(value) {
  if (!object(value)) { return ''; }
  return object(value.shortText) && typeof value.shortText.text === 'string' ? value.shortText.text :
    object(value.longText) && typeof value.longText.text === 'string' ? value.longText.text : '';
}
function clean(value) {
  return wire.normalizeText(typeof value === 'string' ? value.slice(0,4096)
    .replace(/[\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g,' ') : '',128);
}
function codeOf(error) {
  return error && typeof error.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code) ? error.code : 'UNKNOWN';
}
function bytesOf(value, max) {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) { return null; }
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = [];
  for (var i=0; i<value.length; i+=4) {
    var a=alphabet.indexOf(value[i]), b=alphabet.indexOf(value[i+1]);
    var c=value[i+2] === '=' ? 0 : alphabet.indexOf(value[i+2]);
    var d=value[i+3] === '=' ? 0 : alphabet.indexOf(value[i+3]);
    if (value[i+2] === '=' && (b & 15) || value[i+3] === '=' && value[i+2] !== '=' && (c & 3)) { return null; }
    out.push((a << 2) | (b >> 4));
    if (value[i+2] !== '=') { out.push(((b & 15) << 4) | (c >> 2)); }
    if (value[i+3] !== '=') { out.push(((c & 3) << 6) | d); }
  }
  return out.length <= max ? out : null;
}
// The source bitmap has tightly packed rows; the existing watch packet uses
// four-byte aligned rows. Do not assume that every source returns a 24px square.
function bitmapOf(shape,image,maxSize) {
  maxSize=maxSize || 24;
  if (!object(shape) || !Number.isInteger(shape.width) || !Number.isInteger(shape.height) ||
      shape.width<1 || shape.width>maxSize || shape.height<1 || shape.height>maxSize) { return null; }
  var palette=bytesOf(shape.palette,16), source=bytesOf(shape.pixels,Math.ceil(maxSize/2)*maxSize);
  var sourceStride=Math.ceil(shape.width/2), stride=((shape.width+7)>>3)*4;
  if (!palette || !palette.length || !source || source.length !== sourceStride*shape.height) { return null; }
  var pixels=[];
  for (var i=0; i<stride*shape.height; i++) { pixels.push(0); }
  for (var y=0; y<shape.height; y++) {
    for (var x=0; x<shape.width; x++) {
      var pair=source[y*sourceStride+(x>>1)], value=x&1 ? pair&15 : pair>>4;
      if (value>=palette.length) { return null; }
      pixels[y*stride+(x>>1)] |= x&1 ? value : value<<4;
    }
  }
  return {width:shape.width,height:shape.height,palette:palette,pixels:pixels,image:image};
}
function pictureOf(property,maxSize) {
  return object(property) ? bitmapOf(property.image,true,maxSize) || bitmapOf(property.icon,false,maxSize) : null;
}
function keyOf(instance) {
  return object(instance) && typeof instance.instanceId === 'string' && instance.instanceId.length>0 &&
    instance.instanceId.length<=1024 && !/[\x00-\x1f\x7f]/.test(instance.instanceId) ? instance.instanceId : null;
}
function filterNames(value) {
  return (typeof value === 'string' ? value.slice(0,2048) : '').split(',').map(function(name) {
    return name.trim().toLowerCase();
  }).filter(function(name,index,names) { return name && names.indexOf(name) === index; }).slice(0,64);
}
function fingerprintOf(instance) {
  var p=instance.properties;
  // Android conversation notifications often reuse the same notification key.
  // Observe their text too, but exclude late artwork or an unchanged redelivery.
  // Keep only bounded text digests in the baseline, rather than retaining bodies.
  var hash=2166136261, second=5381;
  ['app','name','body'].forEach(function(name) {
    var source=textOf(p[name]);
    var value=(source.slice(0,1024)+'\u001f'+source.slice(-1024))
      .replace(/[\x00-\x1f\x7f-\x9f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,' ')
      .replace(/ +/g,' ').trim();
    value=value.length+':'+value+'\u001f';
    for (var i=0; i<value.length; i++) {
      var point=value.charCodeAt(i);
      hash=Math.imul(hash ^ point,16777619);
      second=((second << 5)+second) ^ point;
    }
  });
  return (hash>>>0).toString(16)+':'+(second>>>0).toString(16);
}

/** Ephemeral context only: sends to the watch, never persists or logs content. */
module.exports = function createContext(options) {
  var pebble=options.pebble || {};
  var groups={};
  Object.keys(DEFINITIONS).forEach(function(name) {
    groups[name]={handle:null,generation:0,error:'',hasData:false,receivedAt:null,recovery:null,attempt:0};
  });
  var settings=null;
  var connected=true;
  var stopped=false;
  var available=typeof pebble.subscribeToSource === 'function';
  var records=[null,null,null,null,null];
  var playing=false;
  var pausedUntil=0;
  var baseline=false;
  var notificationIds=Object.create(null);
  var activeNotice=null;
  var noticeWindowEnd=0, lastNoticeAt=0;
  var burstSequence=0, noticeBurst=0;
  var noticeShownAt=0, pendingNotice=null, noticeUpdateTimer=null;
  var markerNeeded=false, baselineGeneration=0, baselineToken=null;
  var heartbeat=null, expiryTimer=null;
  var pending=false, sending=false, deliveryTimer=null, deliveryGeneration=0;
  var revision=0;

  function now() { return Math.floor(options.now()/1000); }
  function readSettings() {
    var value={};
    try { value=options.getSettings() || {}; } catch (ignored) {}
    return {showMusic:value.showMusic !== false,showNotifications:value.showNotifications === true,
      notificationPreview:value.notificationPreview === true,notificationAppOnly:value.notificationAppOnly === true,
      notificationApps:filterNames(value.notificationApps),
      showStatus:value.showStatus !== false};
  }
  function enabled(name) {
    return settings && (name === 'music' ? settings.showMusic : name === 'phone' ? settings.showStatus : settings.showNotifications);
  }
  function fresh(record) {
    return record && Number.isInteger(record.confirmedAt) && record.confirmedAt>0 && record.confirmedAt<=now() &&
      Number.isInteger(record.validUntil) && now()<record.validUntil && record.validUntil<=MAX_EPOCH;
  }
  function until(envelope, seconds) {
    var end=now()+seconds;
    if (envelope.validUntilMs !== undefined && envelope.validUntilMs !== null) {
      if (!finite(envelope.validUntilMs)) { return 0; }
      end=Math.min(end,Math.floor(envelope.validUntilMs/1000));
    }
    return end>now() && end<=MAX_EPOCH ? end : 0;
  }
  function record(text, bitmap, end, semantic) {
    text=clean(text);
    return (text || bitmap) && end>now() ? {status:2,text:text,bitmap:bitmap || undefined,
      confirmedAt:now(),validUntil:end,semantic:semantic} : null;
  }
  function clearNotice() {
    records[2]=records[3]=null;
    activeNotice=null;
    pendingNotice=null; noticeShownAt=0;
    if (noticeUpdateTimer !== null) { options.cancelLater(noticeUpdateTimer); noticeUpdateTimer=null; }
  }
  function clearGroup(name) {
    if (name === 'music') { records[0]=records[1]=null; playing=false; pausedUntil=0; }
    else if (name === 'phone') { records[4]=null; }
    else { clearNotice(); baseline=false; notificationIds=Object.create(null); noticeWindowEnd=lastNoticeAt=noticeBurst=0; }
  }
  function markBaseline(token, replaceToken) {
    if (replaceToken) {
      var nextToken=tokenOf(token);
      if (nextToken !== baselineToken) { burstSequence=0; }
      baselineToken=nextToken;
    }
    baselineGeneration++;
    markerNeeded=true;
    clearGroup('notifications');
    groups.notifications.hasData=false;
  }
  function currentSlots() {
    return records.map(function(value,i) {
      if (fresh(value)) { return value; }
      if (value) { records[i]=null; }
      return null;
    });
  }
  function payload() {
    var result={};
    var slots=currentSlots();
    if (markerNeeded) {
      // A boundary may itself have been queued before a second reconnect.
      // Boundaries never contain private notification data. A fresh notice is
      // sent only after this baseline's boundary has actually been acknowledged.
      slots[2]=slots[3]=null;
      // Startup may precede the watch's unique launch/reconnect token. An old
      // token must never open that native notification gate, so wait for it.
      if (baselineToken !== null && options.keys.REQUEST_CONTEXT !== undefined) {
        result[options.keys.REQUEST_CONTEXT]=baselineToken;
      }
    }
    result[options.keys.CONTEXT_DATA]=wire.packComplications(slots,now());
    if (options.keys.CONTEXT_STATE !== undefined) {
      // This sidecar travels atomically with its snapshot. It contains no
      // provider identity or content, and is never persisted. The native host
      // must check the session and notification gate before acting on it.
      var session=baselineToken || 0, event=!markerNeeded && slots[2] ? noticeBurst : 0;
      var state=[0,0,0,0,0,0,0,0,slots[0] && !playing ? 1 : 0];
      for (var i=0; i<4; i++) { state[i]=(session >>> (i*8)) & 255; state[i+4]=(event >>> (i*8)) & 255; }
      result[options.keys.CONTEXT_STATE]=state;
    }
    return result;
  }
  function cancelDelivery() {
    deliveryGeneration++;
    if (deliveryTimer !== null) { options.cancelLater(deliveryTimer); }
    deliveryTimer=null; sending=false; pending=false;
  }
  function pump() {
    if (stopped || !connected || sending || !pending) { return; }
    pending=false; sending=true;
    var generation=deliveryGeneration;
    function attempt(number) {
      if (generation !== deliveryGeneration || stopped || !connected) { return; }
      var sentRevision=revision, sentBaselineGeneration=baselineGeneration, sentToken=baselineToken;
      var sentMarker=markerNeeded && sentToken !== null && options.keys.REQUEST_CONTEXT !== undefined, done=false;
      function finish(ok,error) {
        if (done || generation !== deliveryGeneration) { return; }
        done=true;
        // Only this baseline's acknowledged boundary can release its marker.
        // A packet copied into the shared queue before reconnect cannot do so.
        if (ok && sentMarker && sentBaselineGeneration === baselineGeneration && sentToken === baselineToken) {
          markerNeeded=false;
          if (fresh(records[2])) { pending=true; }
        }
        if (deliveryTimer !== null) { options.cancelLater(deliveryTimer); }
        deliveryTimer=null;
        if (!ok && (!error || error.code !== 'SUPERSEDED') && !pending && revision === sentRevision && number<3) {
          deliveryTimer=options.later(function() { deliveryTimer=null; attempt(number+1); },number*1000);
          return;
        }
        sending=false;
        pump();
      }
      // The shared transport can wait behind another bounded transfer. Its
      // own watchdog owns a stuck native send; leave room for that queue here.
      deliveryTimer=options.later(function() { finish(false); },45000);
      try { options.send(payload(),function() { finish(true); },function(error) { finish(false,error); }); }
      catch (ignored) { finish(false); }
    }
    attempt(1);
  }
  function publish() {
    revision++;
    if (options.send.supersedesSnapshots && sending) { cancelDelivery(); }
    pending=true;
    pump();
    scheduleExpiry();
  }
  function scheduleExpiry() {
    if (expiryTimer !== null) { options.cancelLater(expiryTimer); }
    expiryTimer=null;
    var end=Infinity;
    records.forEach(function(value) { if (fresh(value)) { end=Math.min(end,value.validUntil); } });
    if (end !== Infinity && !stopped) {
      expiryTimer=options.later(function() {
        expiryTimer=null;
        if (!fresh(records[2])) { clearNotice(); }
        currentSlots(); publish();
      },Math.max(1,end*1000-options.now()));
    }
  }
  function cancelRecovery(name, reset) {
    var group=groups[name];
    if (group.recovery !== null) { options.cancelLater(group.recovery); }
    group.recovery=null;
    if (reset) { group.attempt=0; }
  }
  function recover(name) {
    var group=groups[name];
    if (stopped || !connected || !enabled(name) || !available ||
        ['PLUGIN_UNAVAILABLE','TIMEOUT','UNKNOWN'].indexOf(group.error)<0) { cancelRecovery(name,true); return; }
    if (group.recovery !== null) { return; }
    var generation=group.generation;
    group.recovery=options.later(function() {
      group.recovery=null;
      if (generation !== group.generation || stopped || !connected || !enabled(name)) { return; }
      group.attempt=Math.min(group.attempt+1,3);
      bind(name); recover(name);
    },[5000,15000,60000,120000][group.attempt]);
  }
  function sourceError(name,error) {
    groups[name].error=codeOf(error);
    groups[name].hasData=false;
    clearGroup(name);
    publish(); recover(name);
  }
  function sourceData(name,envelope) {
    if (!object(envelope) || !Array.isArray(envelope.instances) || envelope.instances.length>512) {
      sourceError(name,{code:'INVALID_DATA'}); return;
    }
    groups[name].error=''; groups[name].hasData=true; cancelRecovery(name,true);
    var valid;
    if (name === 'music') { valid=musicData(envelope); }
    else if (name === 'phone') { valid=phoneData(envelope); }
    else { valid=notificationData(envelope); }
    if (valid === false) { sourceError(name,{code:'INVALID_DATA'}); return; }
    groups[name].receivedAt=now();
    if (valid !== 'deferred') { publish(); }
  }
  function musicData(envelope) {
    if (!envelope.instances.length) { clearGroup('music'); return; }
    var instance=envelope.instances[0], p=object(instance) && instance.properties;
    var isPlaying=object(p) && object(p.playing) && object(p.playing.boolean) ? p.playing.boolean.value : null;
    var title=object(p) ? clean(textOf(p.title)) : '';
    var end=until(envelope,LEASE);
    if (typeof isPlaying !== 'boolean' || !title || !end) { return false; }
    if (isPlaying) { playing=true; pausedUntil=0; }
    else {
      if (playing) { pausedUntil=now()+PAUSED_GRACE; }
      playing=false;
      if (!pausedUntil || now()>=pausedUntil) { clearGroup('music'); return; }
      end=Math.min(end,pausedUntil);
    }
    records[0]=record(title,pictureOf(p.artwork,40),end,{kind:KIND.GENERIC,source:SOURCE.MUSIC});
    records[1]=record(textOf(p.artist),null,end,{kind:KIND.GENERIC,source:SOURCE.MUSIC});
  }
  function phoneData(envelope) {
    if (!envelope.instances.length) { records[4]=null; return; }
    var instance=envelope.instances[0], p=object(instance) && instance.properties;
    var property=object(p) && p.battery_level;
    var numeric=object(property) && property.numericValue;
    var level=object(numeric) && numeric.value;
    var end=until(envelope,LEASE);
    if (!object(p) || property !== undefined && (!object(numeric) || !finite(level) || level<0 || level>100 ||
        numeric.unit !== undefined && numeric.unit !== '%') || !end) { return false; }
    records[4]=finite(level) && level>=0 && level<=15 &&
      (numeric.unit === undefined || numeric.unit === '%') && end ? record(Math.round(level)+'%',null,end,
        {kind:KIND.BATTERY,source:SOURCE.PHONE,detail:wire.DETAIL_KIND.PHONE_BATTERY,value:level,min:0,max:100,unit:'%'}) : null;
  }
  function notificationData(envelope) {
    var incoming=Object.create(null), candidates=[], activeInstance=null, deferred=false;
    envelope.instances.forEach(function(instance) {
      var id=keyOf(instance);
      if (id === null || incoming[id]) { return; }
      incoming[id]=object(instance.properties) ? fingerprintOf(instance) : 'invalid';
      if (id === activeNotice) { activeInstance=instance; }
      if (baseline && notificationIds[id] !== incoming[id] && object(instance.properties)) { candidates.push(instance); }
    });
    if (envelope.instances.length && !Object.keys(incoming).length) { return false; }
    if (activeNotice && !incoming[activeNotice]) { clearNotice(); }
    if (pendingNotice && !incoming[pendingNotice.id]) {
      pendingNotice=null;
      if (noticeUpdateTimer !== null) { options.cancelLater(noticeUpdateTimer); noticeUpdateTimer=null; }
    }
    // Late artwork is not a new notice and must not renew its original lease.
    if (activeInstance && fresh(records[2]) && notificationIds[activeNotice] === incoming[activeNotice]) {
      var refreshedIcon=pictureOf(activeInstance.properties.app_icon,24);
      if (refreshedIcon) { records[2].bitmap=refreshedIcon; }
    }
    // First delivery is a snapshot of the existing phone shade, not a new
    // notification. Reconnects, errors and settings changes establish it again.
    notificationIds=incoming;
    if (!baseline) { baseline=true; return; }
    var availableEnd=until(envelope,NOTICE_MESSAGE_LIFE);
    if (!availableEnd) { clearNotice(); return; }
    for (var i=0; i<candidates.length; i++) {
      var instance=candidates[i], p=instance.properties;
      var app=textOf(p.app), packageName=textOf(p.package);
      var allowed=!settings.notificationApps.length || settings.notificationApps.indexOf(app.trim().toLowerCase())>=0 ||
        settings.notificationApps.indexOf(packageName.trim().toLowerCase())>=0;
      if (!allowed) { continue; }
      var title=clean(textOf(p.name)), appTitle=wire.normalizeText(clean(app),24);
      var heading=settings.notificationAppOnly ? clean(app) || clean(packageName) : title || clean(app);
      if (!heading) { continue; }
      var body=settings.notificationPreview && !settings.notificationAppOnly ? clean(textOf(p.body)) : '';
      var end=Math.min(availableEnd,now()+(body ? NOTICE_MESSAGE_LIFE : NOTICE_SUMMARY_LIFE));
      var received=now();
      if (received>=noticeWindowEnd) {
        var quiet=lastNoticeAt === 0 || received-lastNoticeAt>=NOTICE_QUIET;
        lastNoticeAt=received;
        // A continuous burst gets one bounded interruption, not another
        // lifetime on every message. New arrivals still advance the baseline,
        // and a later independent burst can start after a short quiet gap.
        if (!quiet) { break; }
        noticeWindowEnd=end;
        burstSequence=(burstSequence+1)>>>0 || 1;
        noticeBurst=burstSequence;
      } else { lastNoticeAt=received; }
      end=Math.min(end,noticeWindowEnd);
      var next={id:keyOf(instance),title:record(heading,pictureOf(p.app_icon,24),end,
        {kind:KIND.GENERIC,source:SOURCE.NOTIFICATION,label:settings.notificationAppOnly ? '' : appTitle}),
        body:body ? record(body,null,end,{kind:KIND.GENERIC,source:SOURCE.NOTIFICATION}) : null};
      // A stable reading interval must never postpone a source redaction.
      var removesPrivateText=fresh(records[3]) && !next.body ||
        !title && fresh(records[2]) && records[2].text !== heading;
      if (!removesPrivateText && fresh(records[2]) && options.now()<noticeShownAt+NOTICE_STABLE_MS) {
        pendingNotice=next; deferred=true;
        if (noticeUpdateTimer === null) {
          noticeUpdateTimer=options.later(function() {
            noticeUpdateTimer=null;
            var pending=pendingNotice; pendingNotice=null;
            if (!pending || stopped || !connected || !baseline || !enabled('notifications') || !fresh(pending.title)) { return; }
            records[2]=pending.title; records[3]=pending.body; activeNotice=pending.id;
            noticeShownAt=options.now(); publish();
          },Math.max(1,noticeShownAt+NOTICE_STABLE_MS-options.now()));
        }
      } else {
        if (noticeUpdateTimer !== null) { options.cancelLater(noticeUpdateTimer); noticeUpdateTimer=null; }
        pendingNotice=null;
        records[2]=next.title; records[3]=next.body; activeNotice=next.id;
        noticeShownAt=options.now();
      }
      break; // The native source orders instances newest first.
    }
    return deferred ? 'deferred' : undefined;
  }
  function close(name) {
    var group=groups[name];
    group.generation++;
    if (group.handle && typeof group.handle.unsubscribe === 'function') {
      try { group.handle.unsubscribe(); } catch (ignored) {}
    }
    group.handle=null;
    cancelRecovery(name,false);
  }
  function updateAvailability() {
    var current=typeof pebble.subscribeToSource === 'function';
    if (current === available) { return false; }
    available=current;
    markBaseline();
    // The phone can enable or disable the preview API while PKJS remains
    // loaded. Neither old handles nor an old notification baseline survive it.
    Object.keys(groups).forEach(function(name) {
      close(name); clearGroup(name);
      groups[name].error=''; groups[name].hasData=false; groups[name].receivedAt=null; groups[name].attempt=0;
    });
    return true;
  }
  function bind(name) {
    close(name);
    if (!connected || stopped || !available || !enabled(name)) { return; }
    var group=groups[name], generation=group.generation, definition=DEFINITIONS[name];
    var request={category:definition.category,item:definition.item,properties:definition.properties.slice(),
      onData:function(envelope) { if (generation === group.generation && !stopped && connected) { sourceData(name,envelope); } },
      onError:function(error) { if (generation === group.generation && !stopped && connected) { sourceError(name,error); } }};
    if (name !== 'phone') { request.iconPixelSize=name === 'music' ? {w:40,h:40} : {w:24,h:24}; }
    try {
      var handle=pebble.subscribeToSource(request);
      if (generation === group.generation && !stopped && connected) { group.handle=handle; }
      else if (handle && typeof handle.unsubscribe === 'function') { handle.unsubscribe(); }
    } catch (error) { if (generation === group.generation) { sourceError(name,error); } }
  }
  function scheduleHeartbeat() {
    if (heartbeat !== null) { options.cancelLater(heartbeat); }
    heartbeat=null;
    if (!stopped && connected && available && (enabled('music') || enabled('phone'))) {
      heartbeat=options.later(function() {
        heartbeat=null;
        // Native sources expose current state immediately on subscription.
        // Rebinding renews a lease only when that authoritative delivery occurs.
        var changed=updateAvailability();
        if (enabled('music')) { bind('music'); }
        if (enabled('phone')) { bind('phone'); }
        if (changed && available && enabled('notifications')) { bind('notifications'); }
        if (changed) { publish(); }
        scheduleHeartbeat();
      },HEARTBEAT);
    }
  }
  function configure() {
    if (stopped) { return; }
    var availabilityChanged=updateAvailability();
    var previous=settings;
    settings=readSettings();
    Object.keys(groups).forEach(function(name) {
      var changed=availabilityChanged || !previous || name === 'music' && previous.showMusic !== settings.showMusic ||
        name === 'phone' && previous.showStatus !== settings.showStatus || name === 'notifications' &&
        (previous.showNotifications !== settings.showNotifications || previous.notificationPreview !== settings.notificationPreview ||
          previous.notificationAppOnly !== settings.notificationAppOnly ||
          JSON.stringify(previous.notificationApps) !== JSON.stringify(settings.notificationApps));
      if (changed) { clearGroup(name); groups[name].error=''; groups[name].hasData=false; groups[name].receivedAt=null; groups[name].attempt=0; bind(name); }
    });
    publish(); scheduleHeartbeat();
  }
  function refresh(rebaseline, token) {
    if (stopped) { return; }
    // Set the boundary before configure/bind can synchronously publish data.
    if (rebaseline) { markBaseline(token,true); }
    if (!settings) { configure(); return; }
    updateAvailability();
    if (rebaseline) { bind('notifications'); }
    else if (enabled('notifications') && !groups.notifications.handle) { bind('notifications'); }
    if (enabled('music')) { bind('music'); }
    if (enabled('phone')) { bind('phone'); }
    publish(); scheduleHeartbeat();
  }
  function connectionChanged(value, token) {
    if (stopped || typeof value !== 'boolean') { return; }
    if (!value) {
      connected=false;
      baselineToken=null;
      Object.keys(groups).forEach(function(name) { close(name); clearGroup(name); groups[name].error=''; groups[name].hasData=false; groups[name].receivedAt=null; groups[name].attempt=0; });
      cancelDelivery();
      if (heartbeat !== null) { options.cancelLater(heartbeat); }
      if (expiryTimer !== null) { options.cancelLater(expiryTimer); }
      heartbeat=expiryTimer=null;
    } else { connected=true; refresh(true,token); }
  }
  return {refresh:refresh,configure:configure,connectionChanged:connectionChanged,
    status:function() {
      var sources={}, sourceStates={}, error='';
      Object.keys(groups).forEach(function(name) { sources[name]=groups[name].error; });
      Object.keys(groups).some(function(name) { if (enabled(name) && groups[name].error) { error=groups[name].error; return true; } return false; });
      if (!available && Object.keys(groups).some(enabled)) { error='API_UNAVAILABLE'; }
      var ready=!!settings && connected && (available || !Object.keys(groups).some(enabled)) &&
        Object.keys(groups).every(function(name) { return !enabled(name) || groups[name].hasData; });
      Object.keys(groups).forEach(function(name) {
        var group=groups[name], state='ready', message=group.error;
        if (!enabled(name)) { state='off'; message=''; }
        else if (!connected || !available) { state='unavailable'; message=!connected ? 'DISCONNECTED' : 'API_UNAVAILABLE'; }
        else if (group.error) { state=group.error === 'PERMISSION_DENIED' ? 'denied' : 'unavailable'; }
        else if (!group.hasData) { state='waiting'; }
        else if (name === 'music') {
          if (fresh(records[0])) { state=playing ? 'playing' : 'paused'; }
          else if (playing) { state='unavailable'; message='SOURCE_EXPIRED'; }
          else { state='idle'; }
        } else if (name === 'phone' && group.receivedAt !== null && now()-group.receivedAt>=LEASE) {
          state='unavailable'; message='SOURCE_EXPIRED';
        } else if (name === 'notifications' && !fresh(records[2])) { state='idle'; }
        sourceStates[name]={state:state,message:message,receivedAt:group.receivedAt,
          receivedAgeSec:group.receivedAt === null ? null : Math.max(0,now()-group.receivedAt),
          observedAt:null,observationAgeSec:null};
      });
      return {available:available,connected:connected,ready:ready,error:error,music:!!fresh(records[0]),notification:!!fresh(records[2]),
        phoneBattery:!!fresh(records[4]),sources:sources,sourceStates:sourceStates};
    },
    stop:function() {
      Object.keys(groups).forEach(function(name) { close(name); clearGroup(name); });
      stopped=true; cancelDelivery();
      if (heartbeat !== null) { options.cancelLater(heartbeat); }
      if (expiryTimer !== null) { options.cancelLater(expiryTimer); }
      heartbeat=expiryTimer=null;
    }};
};
