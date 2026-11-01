'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const createComplications=require('../src/js/complications');
const createQueue=require('../src/js/message-queue');
const NOW=1791893700000;
const KEY=10021;
const preference=(slot,category='test',item='reading',index=0,property='value')=>({instanceId:String(slot),properties:{
  category:{shortText:{text:category}},item:{shortText:{text:item}},property:{shortText:{text:property}},index:{numericValue:{value:index}}
}});
const envelope=(property,extra={})=>({pluginUuid:'native-resolved-provider',instances:[{instanceId:'irrelevant-name',properties:{value:property}}],...extra});
function decode(bytes) {
  const buffer=Buffer.from(bytes);
  const header=buffer[0]>=4 ? 56 : buffer[0]===3 ? 52 : 20;
  let at=6;
  return Array.from({length:5},()=>{
    const result={flags:buffer[at],status:buffer[at+1],displayKind:buffer[at+5],confirmedAt:buffer.readUInt32LE(at+6),
      validUntil:buffer.readUInt32LE(at+10),timestamp:buffer.readUInt32LE(at+16)};
    const length=buffer[at+2];
    const pixelBytes=buffer.readUInt16LE(at+14);
    const unitLength=header>=52 ? buffer[at+22] : 0, labelLength=header>=52 ? buffer[at+23] : 0;
    result.text=buffer.subarray(at+header,at+header+length).toString('utf8');
    if(header>=52) result.semantic={kind:buffer[at+20],source:buffer[at+24],
      value:buffer[at+21]&1 ? buffer.readDoubleLE(at+28) : undefined,
      min:buffer[at+21]&2 ? buffer.readDoubleLE(at+36) : undefined,
      max:buffer[at+21]&4 ? buffer.readDoubleLE(at+44) : undefined,
      unit:buffer.subarray(at+header+length,at+header+length+unitLength).toString('utf8'),
      label:buffer.subarray(at+header+length+unitLength,at+header+length+unitLength+labelLength).toString('utf8')};
    if(header===56) Object.assign(result.semantic,{detail:buffer[at+25],qualifiers:buffer[at+26],observedAt:buffer.readUInt32LE(at+52)});
    at+=header+length+unitLength+labelLength+(result.flags&2?16+pixelBytes:0);
    return result;
  });
}
function fixture(overrides={}) {
  let now=NOW;
  let sequence=0;
  let hold=false;
  const values=overrides.values||new Map();
  const timers=new Map();
  const subscriptions=[];
  const deliveries=[];
  const callbacks=[];
  const logs=[];
  const settings={language:'en',use12Hour:false};
  const pebble={subscribeToSource:request=>{
    const handle={request,closed:false,unsubscribe(){this.closed=true;}};
    subscriptions.push(handle);
    if(overrides.subscribe) overrides.subscribe(request,handle);
    return handle;
  }};
  const options={pebble,keys:{COMPLICATION_DATA:KEY},storage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},
    now:()=>now,later:(fn,delay)=>{const id=++sequence;timers.set(id,{at:now+delay,fn});return id;},cancelLater:id=>timers.delete(id),
    getSettings:()=>settings,localizeBoolean:(value,language)=>language==='cs'?(value?'Zapnuto':'Vypnuto'):(value?'On':'Off'),log:message=>logs.push(message),
    send:(payload,success,failure)=>{deliveries.push(payload);callbacks.push({success,failure});if(!hold)success();}
  };
  if(overrides.queue) options.send=createQueue({send:options.send,keys:options.keys,later:options.later,cancelLater:options.cancelLater});
  if(overrides.cacheKey!==undefined) options.cacheKey=overrides.cacheKey;
  if(overrides.unavailable) delete pebble.subscribeToSource;
  function latest(category,item) {
    const sub=subscriptions.filter(value=>!value.closed&&value.request.category===category&&value.request.item===item).at(-1);
    assert.ok(sub,'missing '+category+'/'+item);
    return sub.request;
  }
  const result={values,timers,subscriptions,deliveries,callbacks,logs,settings,pebble,time:()=>now,
    prefs:instances=>latest('preferences','complications').onData({instances}),
    prefError:code=>latest('preferences','complications').onError({code}),
    source:(body,category='test',item='reading')=>latest(category,item).onData(body),
    sourceError:(code,category='test',item='reading')=>latest(category,item).onError({code}),
    latest,hold:value=>{hold=value;},advance:ms=>{now+=ms;},
    packet:()=>decode(deliveries.at(-1)[KEY]),
    tick:ms=>{const end=now+ms;let count=0;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;assert.ok(++count<1000);now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;},
    restart:()=>{result.client=createComplications(options);}
  };
  result.restart();
  return result;
}

test('The first two global choices use independent source indices and group properties without provider pinning',()=>{
  const f=fixture();
  f.client.refresh();
  assert.equal(f.deliveries.length,0,'await actual preferences before replacing offline watch data');
  assert.equal(f.subscriptions[0].request.plugin,undefined);
  f.prefs([preference(0,'test','reading',0,'a'),preference(1,'test','reading',1,'b')]);
  const request=f.latest('test','reading');
  assert.equal(request.plugin,undefined);
  assert.deepEqual(request.properties.sort(),['a','b']);
  assert.deepEqual(request.iconPixelSize,{w:24,h:24});
  f.source({instances:[{instanceId:'not-slot-0',properties:{a:{shortText:{text:'zero'}}}},
    {instanceId:'not-slot-1',properties:{b:{shortText:{text:'one'}}}}]});
  assert.deepEqual(f.packet().map(slot=>slot.status),[2,2,0,0,0]);
  assert.equal(f.packet()[1].text,'one');
  assert.equal(f.packet()[0].text,'zero');
  assert.equal(f.client.status().configured,2);
  assert.equal(f.client.status().ready,2);
});

test('Hidden choices never subscribe, affect diagnostics, fill a missing first slot or change the two-slot cache signature',()=>{
  const f=fixture();f.client.refresh();
  f.prefs([preference(4,'hidden','four'),preference(1,'phone','battery'),preference(2,'weather','location'),preference(3,'hidden','three')]);
  assert.deepEqual(f.subscriptions.map(s=>s.request.category),['preferences','phone']);
  assert.equal(f.client.status().configured,1);
  assert.equal(f.client.status().slots.length,2);
  f.source(envelope({shortText:{text:'78%'}}),'phone','battery');
  assert.deepEqual(f.packet().map(s=>s.status),[0,2,0,0,0]);
  assert.equal(f.packet()[1].text,'78%');
  const before=f.subscriptions.length;
  const cached=JSON.parse(f.values.get('watchface-core-complications-v1'));
  assert.equal(cached.records.length,2);
  f.prefs([preference(1,'phone','battery'),preference(2,'different','provider'),preference(4,'also','changed')]);
  assert.equal(f.subscriptions.length,before,'hidden edits do not rebind displayed providers');
  assert.deepEqual(JSON.parse(f.values.get('watchface-core-complications-v1')),cached);
});

test('An old five-slot cache is rejected even when its first two source descriptors match',()=>{
  const seed=fixture();seed.client.refresh();seed.prefs([preference(0)]);seed.source(envelope({shortText:{text:'current'}}));
  const cached=JSON.parse(seed.values.get('watchface-core-complications-v1'));
  const oldSignature=JSON.stringify([JSON.parse(cached.signature.slice('two:'.length))[0],null,null,null,null]);
  seed.values.set('watchface-core-complications-v1',JSON.stringify({signature:oldSignature,
    records:[cached.records[0],null,{...cached.records[0],text:'hidden old content'},null,null]}));
  const f=fixture({values:seed.values});f.advance(60000);f.client.refresh();f.prefs([preference(0)]);
  assert.deepEqual(f.packet().map(s=>s.status),[1,0,0,0,0]);
  assert.ok(!JSON.stringify([...f.values.values()]).includes('hidden old content'));
  assert.equal(JSON.parse(f.values.get('watchface-core-complications-v1')).records.length,2);
});

test('Only standard weather precipitation receives the droplet display hint; source text and precision remain unchanged',()=>{
  const cases=[
    {text:'0%',numeric:{value:0,unit:'%'}},
    {text:'100%',numeric:{value:100,unit:'%'}},
    {text:'40,5 %',numeric:{value:40.46,unit:'%'}},
    {text:'40%',numeric:{value:40.4,unit:'%'}},
    {text:'2.5%'},
    {numeric:{value:0,unit:'%'}}
  ];
  for(const value of cases) {
    const f=fixture();f.client.refresh();f.prefs([preference(0,'weather','location',0,'precipitation')]);
    const property={};if(value.text!==undefined)property.shortText={text:value.text};
    if(value.numeric!==undefined)property.numericValue=value.numeric;
    f.source({instances:[{properties:{precipitation:property}}]},'weather','location');
    assert.equal(f.packet()[0].displayKind,1,JSON.stringify(value));
    assert.equal(f.packet()[0].text,value.text===undefined?'0 %':value.text);
    const receipt=f.packet()[0].confirmedAt,expiry=f.packet()[0].validUntil;
    f.advance(60000);f.client.configure();
    assert.equal(f.packet()[0].confirmedAt,receipt);assert.equal(f.packet()[0].validUntil,expiry);
    assert.equal(JSON.parse(f.values.get('watchface-core-complications-v1')).records[0].displayKind,1);
  }
});

test('Battery, humidity, rainfall amounts and contradictory probabilities never acquire a droplet hint',()=>{
  const cases=[
    {category:'phone',item:'phone_state',property:'battery_level',value:{shortText:{text:'40%'},numericValue:{value:40,unit:'%'}}},
    {category:'weather',item:'location',property:'humidity',value:{shortText:{text:'40%'},numericValue:{value:40,unit:'%'}}},
    {value:{shortText:{text:'40%'},numericValue:{value:40,unit:'mm'}}},
    {value:{shortText:{text:'40%'},numericValue:{value:90,unit:'%'}}},
    {value:{shortText:{text:'40.5%'},numericValue:{value:40.4,unit:'%'}}},
    {value:{shortText:{text:'40%'},numericValue:{value:NaN,unit:'%'}}},
    {value:{shortText:{text:'40%'},numericValue:null}},
    ...['-1%','101%','100.1%','Rain 40%','40% today','1/2','40 mm'].map(value=>({value:{shortText:{text:value}}}))
  ];
  for(const value of cases) {
    const category=value.category||'weather',item=value.item||'location',property=value.property||'precipitation';
    const f=fixture();f.client.refresh();f.prefs([preference(0,category,item,0,property)]);
    f.source({instances:[{properties:{[property]:value.value}}]},category,item);
    assert.equal(f.packet()[0].displayKind,0,JSON.stringify(value));
  }
});

test('Initial preference errors preserve offline watch data while missing host API explicitly clears it',()=>{
  const f=fixture();f.client.refresh();f.prefError('PERMISSION_DENIED');
  assert.equal(f.deliveries.length,0);
  assert.equal(f.client.status().error,'PERMISSION_DENIED');
  f.prefs([]);
  assert.deepEqual(f.packet().map(slot=>slot.status),[0,0,0,0,0]);
  const missing=fixture({unavailable:true});missing.client.refresh();
  assert.equal(missing.client.status().available,false);
  assert.deepEqual(missing.packet().map(slot=>slot.status),[3,3,0,0,0]);
});

test('A source instance reorder follows the configured ordinal without moving the global slot',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(1,'test','reading',1)]);
  const first={instanceId:'home',properties:{value:{shortText:{text:'Home'}}}};
  const second={instanceId:'office',properties:{value:{shortText:{text:'Office'}}}};
  f.source({instances:[first,second]});
  assert.equal(f.packet()[1].text,'Office');
  f.source({instances:[second,first]});
  assert.equal(f.packet()[1].text,'Home');
  assert.deepEqual(f.packet().map(s=>s.status),[0,2,0,0,0]);
  assert.equal(f.client.status().slots[1].index,1);
});

test('Shape priority preserves supplied units, numeric zero and boolean false; series-only data is explicitly unsupported',()=>{
  const f=fixture();f.client.refresh();
  f.prefs([preference(0,'test','reading',0,'p0'),preference(1,'test','reading',0,'p1')]);
  const p={p0:{shortText:{text:'0°C'},numericValue:{value:99,unit:'wrong'}},p1:{numericValue:{value:0,unit:'%'}},
    p2:{boolean:{value:false}},p3:{timestamp:{value:NOW/1000+3600}},p4:{series:{numericValue:{values:[20]}}}};
  f.source({instances:[{properties:p}]});
  assert.equal(f.packet()[0].text,'0°C');assert.equal(f.packet()[1].text,'0 %');
  f.prefs([preference(0,'test','reading',0,'p2'),preference(1,'test','reading',0,'p3')]);
  f.source({instances:[{properties:p}]});
  assert.equal(f.packet()[0].text,'Off');
  assert.equal(f.packet()[1].flags,8);assert.equal(f.packet()[1].timestamp,NOW/1000+3600);
  f.prefs([preference(1,'test','reading',0,'p4')]);f.source({instances:[{properties:p}]});
  assert.equal(f.packet()[1].status,5);assert.equal(f.packet()[1].flags,0);
});

test('Numeric data outranks long text and localized booleans; timestamps remain raw across clock-format changes',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);
  f.source(envelope({numericValue:{value:12.5,unit:'kWh'},longText:{text:'less preferred'},boolean:{value:true}}));
  assert.equal(f.packet()[0].text,'12.5 kWh');
  f.source(envelope({timestamp:{value:NOW/1000+3600}}));
  const first=f.packet()[0];f.advance(60000);f.settings.use12Hour=true;f.client.configure();
  assert.deepEqual(f.packet()[0],first,'watch formats timestamp; settings do not renew source confirmation');
});

test('Boolean language replay changes only text and never source timestamps',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);f.source(envelope({boolean:{value:false}}));
  const first=f.packet()[0];f.advance(60000);f.settings.language='cs';f.client.configure();
  assert.equal(f.packet()[0].text,'Vypnuto');
  assert.equal(f.packet()[0].confirmedAt,first.confirmedAt);assert.equal(f.packet()[0].validUntil,first.validUntil);
});

test('Transient errors retain valid cached readings, while revoked permission, source absence and invalid properties clear',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);f.source(envelope({shortText:{text:'original'}}));
  const original=f.packet()[0];f.advance(60000);f.sourceError('NETWORK_ERROR');
  assert.deepEqual(f.packet()[0],original);
  for(const [error,status] of [['PERMISSION_DENIED',4],['PLUGIN_UNAVAILABLE',3],['PLUGIN_DISABLED',6]]) {
    f.sourceError(error);assert.equal(f.packet()[0].status,status);assert.equal(f.packet()[0].flags,0);
    f.source(envelope({shortText:{text:'recovered'}}));
  }
  f.source(envelope({numericValue:{value:NaN,unit:'°C'}}));
  assert.equal(f.packet()[0].status,3);assert.equal(f.packet()[0].flags,0);
});

test('Source expiry is exclusive, malformed expiry clears, and expiry timers do not fetch or renew',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);
  f.source(envelope({shortText:{text:'limited'}},{validUntilMs:NOW+60000}));
  const before=f.subscriptions.length;f.tick(60000);
  assert.equal(f.packet()[0].status,7);assert.equal(f.subscriptions.length,before);
  f.source(envelope({shortText:{text:'bad expiry'}},{validUntilMs:'tomorrow'}));
  assert.equal(f.packet()[0].status,3);assert.equal(f.packet()[0].flags,0);
});

test('Changing global configuration clears all previous values atomically and ignores old callbacks',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);
  const old=f.latest('test','reading');f.source(envelope({shortText:{text:'old'}}));
  f.prefs([preference(1,'new','source',0,'x')]);
  assert.equal(f.packet()[0].status,0);assert.equal(f.packet()[1].status,1);
  old.onData(envelope({shortText:{text:'must not return'}}));
  assert.equal(f.packet()[0].status,0);assert.equal(f.packet()[1].status,1);
  f.source({instances:[{properties:{x:{shortText:{text:'new'}}}}]},'new','source');
  assert.equal(f.packet()[1].text,'new');assert.equal(f.packet()[0].text,'');
});

test('Explicit refresh and the thirty-minute timer rebind providers without replay renewing cached values',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);f.source(envelope({shortText:{text:'old provider'}}));
  const old=f.latest('test','reading');const original=f.packet()[0];
  f.advance(60000);f.client.refresh();
  assert.notEqual(f.latest('test','reading'),old);
  assert.deepEqual(f.packet()[0],original);
  old.onData(envelope({shortText:{text:'late old provider'}}));
  assert.equal(f.packet()[0].text,'old provider');
  f.source({...envelope({shortText:{text:'new provider'}}),pluginUuid:'different-native-provider'});
  assert.equal(f.packet()[0].text,'new provider');
  const count=f.subscriptions.length;f.tick(30*60000);
  assert.ok(f.subscriptions.length>count);
  assert.equal(f.latest('test','reading').plugin,undefined);
});

test('Matching persisted data is used only after actual preferences; changed preferences never resurrect it',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);f.source(envelope({shortText:{text:'cached'}}));
  const restarted=fixture({values:f.values});restarted.advance(60000);restarted.client.refresh();restarted.prefError('TIMEOUT');
  assert.equal(restarted.deliveries.length,0);
  restarted.prefs([preference(0)]);assert.equal(restarted.packet()[0].text,'cached');
  assert.equal(restarted.packet()[0].confirmedAt,NOW/1000);
  restarted.prefs([preference(1)]);assert.equal(restarted.packet()[0].status,0);assert.equal(restarted.packet()[1].status,1);
});

test('Invalid or duplicate global slot entries never guess a source index or compress fixed slots',()=>{
  const f=fixture();f.client.refresh();
  const missingIndex=preference(1);delete missingIndex.properties.index;
  f.prefs([preference(0),preference(0),missingIndex,preference(8)]);
  assert.deepEqual(f.packet().map(slot=>slot.status),[5,5,0,0,0]);
  assert.equal(f.subscriptions.filter(sub=>sub.request.category==='test').length,0);
});

test('Icons are preferred over images, invalid visible palette indices are rejected, and image colors remain marked',()=>{
  const bitmap=(palette,pixel)=>({width:1,height:1,palette:Buffer.from(palette).toString('base64'),pixels:Buffer.from([pixel]).toString('base64')});
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);
  f.source(envelope({shortText:{text:'icon'},icon:bitmap([0,255],0x10),image:bitmap([0,192],0x10)}));
  assert.equal(f.packet()[0].flags,3);
  f.source(envelope({image:bitmap([255],0x00)}));assert.equal(f.packet()[0].flags,6);
  f.source(envelope({icon:bitmap([255],0x10)}));assert.equal(f.packet()[0].status,3);assert.equal(f.packet()[0].flags,0);
});

test('A hung send has bounded retries and old delivery callbacks cannot overwrite a newer full snapshot',()=>{
  const f=fixture();f.hold(true);f.client.refresh();f.prefs([preference(0)]);
  const old=f.callbacks[0];f.source(envelope({shortText:{text:'newest'}}));
  f.tick(10000);old.success();f.hold(false);f.callbacks.at(-1).success();
  assert.equal(f.packet()[0].text,'newest');
  assert.equal(f.packet()[0].status,2);
});

test('A zero timestamp clears only its slot and cannot invalidate another configured reading',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0,'test','reading',0,'bad'),preference(1,'test','reading',0,'good')]);
  f.source({instances:[{properties:{bad:{timestamp:{value:0}},good:{shortText:{text:'kept'}}}}]});
  assert.equal(f.packet()[0].status,3);assert.equal(f.packet()[0].flags,0);
  assert.equal(f.packet()[1].status,2);assert.equal(f.packet()[1].text,'kept');
});

test('A failed preferences unsubscribe does not abort a later refresh or its provider rebind',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);
  f.subscriptions.find(sub=>sub.request.category==='preferences').unsubscribe=()=>{throw new Error('host failure');};
  const previous=f.latest('test','reading');
  assert.doesNotThrow(()=>f.client.refresh());
  assert.notEqual(f.latest('test','reading'),previous);
  assert.ok(f.timers.size>0,'backup refresh remains scheduled');
});

test('A synchronous global preference replacement prevents remaining obsolete source subscriptions',()=>{
  const f=fixture({subscribe:request=>{
    if(request.category==='first') f.prefs([preference(1,'replacement','reading')]);
  }});
  f.client.refresh();
  f.prefs([preference(0,'first','reading'),preference(1,'obsolete','reading')]);
  assert.equal(f.subscriptions.some(sub=>sub.request.category==='obsolete'),false);
  assert.equal(f.client.status().slots[1].category,'replacement');
  assert.deepEqual(f.packet().map(slot=>slot.status),[0,1,0,0,0]);
});

test('Compact source bitmap rows are repacked into the watch stride with zeroed padding',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);
  const image={width:3,height:2,palette:Buffer.from([0,255]).toString('base64'),
    pixels:Buffer.from([0x01,0x1f,0x10,0x0f]).toString('base64')};
  f.source(envelope({icon:image}));
  const packet=Buffer.from(f.deliveries.at(-1)[KEY]);
  const first=6;
  assert.equal(packet[first+1],2);
  assert.equal(packet[first+3],3);assert.equal(packet[first+4],2);
  assert.equal(packet.readUInt16LE(first+14),8);
  const pixels=first+56+packet[first+2]+packet[first+22]+packet[first+23]+16;
  assert.deepEqual([...packet.subarray(pixels,pixels+8)],[0x01,0x10,0,0,0x10,0,0,0]);
  // A four-byte-aligned source payload is not the public ImageShape format.
  f.source(envelope({icon:{...image,pixels:Buffer.from([0x01,0x10,0,0,0x10,0,0,0]).toString('base64')}}));
  assert.equal(f.packet()[0].status,3);
});

test('Unavailable sources retry once per bounded backoff without postponing the normal backup timer',()=>{
  const attempts=[];
  const f=fixture({subscribe:request=>{
    if(request.category==='weather') {
      attempts.push(f.time()-NOW);
      request.onError({code:'PLUGIN_UNAVAILABLE',message:'No plugin found for weather/location'});
    }
  }});
  f.client.refresh();f.prefs([preference(0,'weather','location')]);
  assert.deepEqual(attempts,[0]);
  f.tick(4999);assert.equal(attempts.length,1);
  f.tick(1);f.tick(15000);f.tick(60000);f.tick(120000);f.tick(120000);
  assert.deepEqual(attempts,[0,5000,20000,80000,200000,320000]);
  assert.equal(f.timers.size,2,'one recovery and one original thirty-minute backup remain');
  const preferenceCount=()=>f.subscriptions.filter(sub=>sub.request.category==='preferences').length;
  assert.equal(preferenceCount(),1,'recovery rebinds sources, not global preferences');
  f.tick(1800000-320000);
  assert.equal(preferenceCount(),2,'normal backup was not pushed out by each recovery');
});

test('Source registration recovery accepts the new provider and ignores callbacks from old dead subscriptions',()=>{
  let registered=false;
  const f=fixture({subscribe:request=>{
    if(request.category==='weather') {
      if(registered) request.onData(envelope({shortText:{text:'registered'}}));
      else request.onError({code:'PLUGIN_UNAVAILABLE',message:'Provider is not registered yet'});
    }
  }});
  f.client.refresh();f.prefs([preference(0,'weather','location')]);
  const old=f.latest('weather','location');
  f.tick(5000);registered=true;f.tick(15000);
  assert.equal(f.packet()[0].text,'registered');
  assert.equal(f.client.status().slots[0].error,'');assert.equal(f.client.status().slots[0].message,'');
  const count=f.subscriptions.length;
  old.onData(envelope({shortText:{text:'obsolete'}}));old.onError({code:'PLUGIN_UNAVAILABLE',message:'obsolete error'});
  f.tick(120000);
  assert.equal(f.subscriptions.length,count,'successful recovery cancels the pending recovery timer');
  assert.equal(f.packet()[0].text,'registered');
  assert.equal(f.packet()[0].confirmedAt,(NOW+20000)/1000);
});

test('Unrelated successful groups never reset a still-failed source backoff or create parallel retries',()=>{
  const weather=[];
  const other=[];
  const f=fixture({subscribe:request=>{
    if(request.category==='weather') {weather.push(f.time()-NOW);request.onError({code:'PLUGIN_UNAVAILABLE'});}
    if(request.category==='phone') {other.push(f.time()-NOW);request.onData(envelope({shortText:{text:'battery'}}));}
  }});
  f.client.refresh();f.prefs([preference(0,'weather','location'),preference(1,'phone','battery')]);
  f.tick(5000);f.tick(15000);f.tick(60000);f.tick(120000);
  assert.deepEqual(weather,[0,5000,20000,80000,200000]);
  assert.deepEqual(other,weather);
  assert.equal(f.client.status().slots[1].status,'ready');
  assert.equal(f.timers.size,3,'one expiry, one recovery and one backup only');
});

test('Preference changes and API unavailability cancel recovery and clear obsolete source diagnostics',()=>{
  const f=fixture({subscribe:request=>{
    if(request.category==='weather') request.onError({code:'PLUGIN_UNAVAILABLE',message:'Old weather error'});
  }});
  f.client.refresh();f.prefs([preference(0,'weather','location')]);
  const old=f.latest('weather','location');
  f.prefs([preference(1,'phone','battery')]);
  const count=f.subscriptions.length;
  f.tick(120000);
  assert.equal(f.subscriptions.length,count);
  assert.equal(f.client.status().slots[0].message,'');
  old.onError({code:'PLUGIN_UNAVAILABLE',message:'Late old error'});
  assert.equal(f.client.status().message,'');
  f.prefs([preference(0,'weather','location')]);
  delete f.pebble.subscribeToSource;
  f.client.refresh();
  const unavailableCount=f.subscriptions.length;
  f.tick(120000);
  assert.equal(f.subscriptions.length,unavailableCount);
  assert.equal(f.client.status().error,'API_UNAVAILABLE');
  assert.equal(f.timers.size,0);
});

test('Denied, unsupported and ordinary network errors do not trigger provider-registration retries',()=>{
  for(const code of ['PERMISSION_DENIED','UNSUPPORTED','INVALID_REQUEST','NETWORK_ERROR','TIMEOUT']) {
    const f=fixture({subscribe:request=>{if(request.category==='test') request.onError({code,message:'detail'});}});
    f.client.refresh();f.prefs([preference(0)]);
    const count=f.subscriptions.length;f.tick(120000);
    assert.equal(f.subscriptions.length,count,code);
  }
});

test('Diagnostics preserve a bounded printable source message locally and pair the top message with its error',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0,'phone','battery'),preference(1,'weather','location')]);
  const detail='Weather failed at https://private.invalid/location?city=České Budějovice';
  f.latest('weather','location').onError({code:'PLUGIN_UNAVAILABLE',message:detail+'\n\t\u0000\u202e\u200b'+'x'.repeat(300)+'🙂'});
  const message=f.client.status().slots[1].message;
  assert.ok(message.startsWith(detail));assert.ok(message.length<=180);
  assert.ok(!/[\x00-\x1f\x7f-\x9f\u2028-\u202e\u200b]/.test(message));
  assert.equal(f.client.status().message,message);
  assert.equal(f.logs.some(value=>value.includes('private.invalid')),false);
  f.latest('phone','battery').onError({code:'PERMISSION_DENIED',message:'Phone permission missing'});
  assert.equal(f.client.status().error,'PERMISSION_DENIED');
  assert.equal(f.client.status().message,'Phone permission missing','top error and message must come from the same slot');
  f.source(envelope({shortText:{text:'recovered'}}),'phone','battery');
  assert.equal(f.client.status().slots[0].message,'');
  assert.equal(f.client.status().message,message);
  f.source(envelope({shortText:{text:'weather recovered'}}),'weather','location');
  assert.equal(f.client.status().error,'');assert.equal(f.client.status().message,'');
});

test('Preference error messages are preserved without overwriting offline data and clear on a valid preference snapshot',()=>{
  const f=fixture();f.client.refresh();
  f.latest('preferences','complications').onError({code:'PLUGIN_UNAVAILABLE',message:'Preferences are starting\r\nTry again'});
  assert.equal(f.client.status().message,'Preferences are starting Try again');assert.equal(f.deliveries.length,0);
  f.prefs([]);assert.equal(f.client.status().error,'');assert.equal(f.client.status().message,'');
});

test('A late failed watch delivery cannot replace the newest recovered source packet',()=>{
  let registered=false;
  const f=fixture({subscribe:request=>{
    if(request.category==='weather') {
      if(registered) request.onData(envelope({shortText:{text:'newest'}}));
      else request.onError({code:'PLUGIN_UNAVAILABLE'});
    }
  }});
  f.client.refresh();f.hold(true);f.prefs([preference(0,'weather','location')]);
  const old=f.callbacks.at(-1);registered=true;f.tick(5000);
  f.hold(false);old.failure();
  assert.equal(f.packet()[0].text,'newest');assert.equal(f.packet()[0].status,2);
});


test('A host-selected cache key isolates stored receipts without changing the wire contract',()=>{
  const values=new Map();
  const first=fixture({values,cacheKey:'first-face-complications-v1'});
  first.client.refresh();first.prefs([preference(0)]);
  first.source(envelope({shortText:{text:'first face'}}));
  assert.ok(values.has('first-face-complications-v1'));
  assert.ok(!values.has('watchface-core-complications-v1'));
  const original=values.get('first-face-complications-v1');
  const second=fixture({values,cacheKey:'second-face-complications-v1'});
  second.client.refresh();second.prefs([preference(0)]);
  assert.equal(second.packet()[0].text,'','another face cannot replay this namespace');
  second.source(envelope({shortText:{text:'second face'}}));
  assert.equal(values.get('first-face-complications-v1'),original);
  assert.ok(values.get('second-face-complications-v1').includes('second face'));
  const restart=fixture({values,cacheKey:'first-face-complications-v1'});
  restart.advance(60000);restart.client.refresh();restart.prefs([preference(0)]);
  assert.equal(restart.packet()[0].text,'first face');
  assert.equal(restart.packet()[0].confirmedAt,NOW/1000,'cache replay does not renew the receipt');
});

test('An empty or non-string host cache key falls back to the generic library namespace',()=>{
  for(const cacheKey of ['',null,0,{}]) {
    const f=fixture({cacheKey});f.client.refresh();f.prefs([preference(0)]);
    f.source(envelope({shortText:{text:'current'}}));
    assert.ok(f.values.has('watchface-core-complications-v1'));
    assert.ok(!f.values.has('halftone-complications-v1'));
  }
});

test('Semantic metadata retains exact source identity, numeric values and ranges without rewriting formatted units',()=>{
  const f=fixture();f.client.refresh();
  const temp=preference(0,'weather','location',0,'temperature');
  temp.properties.label={shortText:{text:'Air temperature'}};
  f.prefs([temp,preference(1,'phone','phone_state',0,'battery_level')]);
  f.source({instances:[{properties:{temperature:{shortText:{text:'5,3°F'},numericValue:{value:5.25,unit:'°F',min:-40,max:120}}}}]},'weather','location');
  f.source({instances:[{properties:{battery_level:{shortText:{text:'0%'},numericValue:{value:0,unit:'%',min:0,max:100}}}}]},'phone','phone_state');
  const [temperature,battery]=f.packet();
  assert.equal(temperature.text,'5,3°F');
  assert.deepEqual(temperature.semantic,{kind:1,source:1,value:5.25,min:-40,max:120,unit:'°F',label:'Air temperature',detail:1,qualifiers:0,observedAt:0});
  assert.equal(battery.text,'0%');assert.equal(battery.semantic.kind,3);assert.equal(battery.semantic.source,2);
  assert.equal(battery.semantic.value,0);assert.equal(battery.semantic.min,0);assert.equal(battery.semantic.max,100);
  assert.equal(f.client.status().slots[0].label,'Air temperature');
  const saved=JSON.parse(f.values.get('watchface-core-complications-v1')).records[0];
  assert.equal(saved.semantic.unit,'°F');assert.equal(saved.semantic.value,5.25);
  f.advance(60000);f.client.configure();
  assert.equal(f.packet()[0].confirmedAt,temperature.confirmedAt);assert.deepEqual(f.packet()[0].semantic,temperature.semantic);
  assert.equal(JSON.parse(f.values.get('watchface-core-complications-v1')).records[0].confirmedAt,saved.confirmedAt);
});

test('Unrelated numeric properties remain generic numbers, malformed ranges are omitted, and long units are never shortened into a different unit',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0)]);
  f.source(envelope({shortText:{text:'12,5 milligrams per cubic metre'},numericValue:{value:12.5,unit:'milligrams per cubic metre',min:10,max:1}}));
  const slot=f.packet()[0];
  assert.equal(slot.text,'12,5 milligrams per cubic metre');assert.equal(slot.semantic.kind,9);assert.equal(slot.semantic.source,5);
  assert.equal(slot.semantic.value,12.5);assert.equal(slot.semantic.unit,'');
  assert.equal(slot.semantic.min,undefined);assert.equal(slot.semantic.max,undefined);
  assert.equal(f.client.status().slots[0].text,null,'unknown plugins do not leak their content through diagnostics');
  f.source(envelope({boolean:{value:false}}));assert.equal(f.packet()[0].semantic.kind,10);assert.equal(f.packet()[0].semantic.value,0);
  f.source(envelope({timestamp:{value:NOW/1000+600}}));
  assert.equal(f.packet()[0].semantic.kind,11);assert.equal(f.packet()[0].flags,8);assert.equal(f.packet()[0].timestamp,NOW/1000+600);
});

test('Weather freshness diagnostics distinguish original measurement time from receipt, replay and provider expiry',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0,'weather','location',0,'temperature')]);
  assert.deepEqual(f.latest('weather','location').properties,['temperature','observed_at','is_forecast']);
  f.source({validUntilMs:NOW+1200000,instances:[{properties:{temperature:{shortText:{text:'7°C'}},
    observed_at:{timestamp:{value:NOW/1000-600}},is_forecast:{boolean:{value:false}}}}]},'weather','location');
  let state=f.client.status().slots[0];
  assert.equal(state.receivedAt,NOW/1000);assert.equal(state.receivedAgeSec,0);
  assert.equal(state.observedAt,NOW/1000-600);assert.equal(state.observationAgeSec,600);assert.equal(state.cached,false);
  f.advance(60000);f.client.configure();state=f.client.status().slots[0];
  assert.equal(state.receivedAgeSec,60);assert.equal(state.observationAgeSec,660);assert.equal(state.text,'7°C');
  const restored=fixture({values:f.values});restored.advance(60000);restored.client.refresh();restored.prefs([preference(0,'weather','location',0,'temperature')]);
  state=restored.client.status().slots[0];assert.equal(state.cached,true);assert.equal(state.receivedAt,NOW/1000);assert.equal(state.observationAgeSec,660);
  restored.source({instances:[{properties:{temperature:{shortText:{text:'~6°C'}},is_forecast:{boolean:{value:true}},
    observed_at:{timestamp:{value:NOW/1000-600}}}}]},'weather','location');
  state=restored.client.status().slots[0];assert.equal(state.observedAt,null);assert.equal(state.observationAgeSec,null);assert.equal(state.cached,false);
});

test('Humidity and wind observation diagnostics use their own measurement timestamps; future or unrelated times are not observations',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0,'weather','location',0,'humidity'),preference(1,'weather','location',0,'wind_speed')]);
  f.source({instances:[{properties:{humidity:{numericValue:{value:70,unit:'%'}},wind_speed:{numericValue:{value:3,unit:'m/s'}},
    observed_at:{timestamp:{value:NOW/1000-60}},humidity_observed_at:{timestamp:{value:NOW/1000-300}},wind_observed_at:{timestamp:{value:NOW/1000+1}}}}]},'weather','location');
  const states=f.client.status().slots;
  assert.equal(states[0].observationAgeSec,300);assert.equal(states[1].observedAt,null);
  assert.equal(f.packet()[0].semantic.kind,4);assert.equal(f.packet()[1].semantic.kind,5);
});

test('Shared transport replaces a waiting complication snapshot with the latest value without changing receipt times or reporting provider errors',()=>{
  const f=fixture({queue:true});f.hold(true);f.client.refresh();f.prefs([preference(0)]);
  f.source(envelope({shortText:{text:'Old value'}}));f.advance(1000);f.source(envelope({shortText:{text:'Latest value'}}));
  assert.equal(f.deliveries.length,1,'only the raw active loading snapshot has been sent');
  f.callbacks[0].success();assert.equal(f.deliveries.length,2);assert.equal(f.packet()[0].text,'Latest value');
  assert.equal(f.packet()[0].confirmedAt,NOW/1000+1);
  f.callbacks[1].success();f.tick(5000);assert.equal(f.deliveries.length,2);assert.equal(f.client.status().error,'');
  assert.deepEqual(f.logs,[]);
});

test('A superseded standalone complication transfer does not retry or become a provider diagnostic',()=>{
  const f=fixture();f.hold(true);f.client.refresh();f.prefs([preference(0)]);
  f.callbacks.at(-1).failure({code:'SUPERSEDED'});const count=f.deliveries.length;
  f.tick(5000);assert.equal(f.deliveries.length,count);assert.equal(f.client.status().error,'');assert.deepEqual(f.logs,[]);
});

test('Explicit music and notification complication selections render live but never persist or restore their private readings',()=>{
  for(const category of ['music','notifications']) {
    const f=fixture();f.client.refresh();
    const selected=[preference(0,category,category==='music'?'track':'notification',0,'value'),preference(1,'weather','location',0,'temperature')];
    f.prefs(selected);
    f.source(envelope({shortText:{text:'Private '+category+' content'}}),category,category==='music'?'track':'notification');
    f.source({instances:[{properties:{temperature:{shortText:{text:'7°C'}}}}]},'weather','location');
    assert.equal(f.packet()[0].text,'Private '+category+' content','explicit selection still renders current RAM data');
    const saved=JSON.parse(f.values.get('watchface-core-complications-v1'));
    assert.equal(saved.records[0],null);assert.equal(saved.records[1].text,'7°C');
    assert.ok(!JSON.stringify([...f.values.values()]).includes('Private'));
    assert.equal(f.client.status().slots[0].text,null);
    const old=f.latest(category,category==='music'?'track':'notification');
    f.client.refresh();
    assert.equal(f.packet()[0].status,1,'reconnect/refresh waits for fresh private source data');
    assert.equal(f.packet()[1].text,'7°C');assert.equal(f.packet()[1].confirmedAt,NOW/1000);
    old.onData(envelope({shortText:{text:'Late private old source'}}));assert.equal(f.packet()[0].status,1);
    // Simulate the older cache implementation, which did persist this reading.
    saved.records[0]={text:'Old private '+category+' body',confirmedAt:NOW/1000,validUntil:NOW/1000+7200};
    f.values.set('watchface-core-complications-v1',JSON.stringify(saved));
    const restored=fixture({values:f.values});
    assert.ok(!JSON.stringify([...restored.values.values()]).includes('Old private'),
      'legacy private content is removed even before preferences can be read');
    restored.advance(60000);restored.client.refresh();restored.prefs(selected);
    assert.equal(restored.packet()[0].status,1);assert.equal(restored.packet()[0].text,'');
    assert.equal(restored.packet()[1].text,'7°C');assert.equal(restored.packet()[1].confirmedAt,NOW/1000);
    restored.source(envelope({shortText:{text:'Fresh private '+category+' content'}}),category,category==='music'?'track':'notification');
    assert.equal(restored.packet()[0].text,'Fresh private '+category+' content');
    assert.ok(!JSON.stringify([...restored.values.values()]).includes('Fresh private'));
  }
});

test('Unclassifiable old selected-reading caches and private semantic records are scrubbed without damaging identified weather records',()=>{
  const f=fixture();f.client.refresh();f.prefs([preference(0,'weather','location',0,'temperature')]);
  f.source({instances:[{properties:{temperature:{shortText:{text:'7°C'}}}}]},'weather','location');
  const saved=JSON.parse(f.values.get('watchface-core-complications-v1'));
  saved.records[1]={text:'Unclassified private body',confirmedAt:NOW/1000,validUntil:NOW/1000+7200};
  f.values.set('watchface-core-complications-v1',JSON.stringify(saved));
  const restored=fixture({values:f.values});
  const cleaned=JSON.parse(restored.values.get('watchface-core-complications-v1'));
  assert.equal(cleaned.records[0].text,'7°C');assert.equal(cleaned.records[1],null);
  cleaned.records[0].semantic.source=3;cleaned.records[0].text='Private mislabeled cache';
  restored.values.set('watchface-core-complications-v1',JSON.stringify(cleaned));
  const again=fixture({values:restored.values});
  assert.ok(!JSON.stringify([...again.values.values()]).includes('Private mislabeled'));
});

test('Weather and phone identities preserve their precise property before, during and after a value',()=>{
  const kinds={temperature:[1,1],feels_like:[1,2],high:[1,3],low:[1,4],precipitation:[0,0],
    humidity:[4,6],wind_speed:[5,7],wind_direction:[5,8],uv_index:[6,9],condition:[7,10]};
  for(const [property,[kind,detail]]of Object.entries(kinds)) {
    const f=fixture();f.client.refresh();f.prefs([preference(0,'weather','location',0,property)]);
    let slot=f.packet()[0];
    assert.equal(slot.status,1);assert.equal(slot.semantic.kind,kind,property);
    assert.equal(slot.semantic.detail,detail,property);assert.equal(slot.semantic.label,property.replace(/_/g,' '));
    const text=property==='condition'?'Cloudy':property==='precipitation'?'2 mm':'7';
    f.source({validUntilMs:NOW+2000,instances:[{properties:{[property]:{shortText:{text}}}}]},'weather','location');
    assert.equal(f.packet()[0].semantic.detail,detail,property);
    f.tick(2000);slot=f.packet()[0];
    assert.equal(slot.status,7);assert.equal(f.client.status().slots[0].status,'expired');
    assert.equal(slot.semantic.detail,detail);assert.equal(slot.semantic.source,1);
    assert.equal(slot.semantic.label,property.replace(/_/g,' '));
    assert.equal(slot.flags,0);assert.equal(slot.text,'');assert.equal(slot.semantic.value,undefined);
    assert.equal(slot.confirmedAt,0);assert.equal(slot.validUntil,0);assert.equal(slot.semantic.observedAt,0);
    f.sourceError('PERMISSION_DENIED','weather','location');slot=f.packet()[0];
    assert.equal(slot.status,4);assert.equal(slot.semantic.detail,detail);
    f.sourceError('PLUGIN_DISABLED','weather','location');assert.equal(f.packet()[0].status,6);
    assert.equal(f.packet()[0].semantic.detail,detail);
    f.sourceError('UNSUPPORTED','weather','location');assert.equal(f.packet()[0].status,5);
    assert.equal(f.packet()[0].semantic.detail,detail);
    f.sourceError('SOURCE_UNAVAILABLE','weather','location');assert.equal(f.packet()[0].status,3);
    assert.equal(f.packet()[0].semantic.detail,detail);
  }
  const f=fixture();f.client.refresh();f.prefs([preference(1,'phone','phone_state',0,'battery_level')]);
  assert.equal(f.packet()[1].semantic.detail,11);assert.equal(f.packet()[1].semantic.source,2);
  assert.equal(f.packet()[0].status,0);assert.equal(f.packet()[0].semantic.label,'');
});

test('Forecast temperature is explicitly qualified and never acquires an invented observation time',()=>{
  for(const [property,detail]of [['temperature',1],['feels_like',2],['high',3],['low',4]]) {
    const f=fixture();f.client.refresh();f.prefs([preference(0,'weather','location',0,property)]);
    assert.ok(f.latest('weather','location').properties.includes('is_forecast'));
    f.source({instances:[{properties:{[property]:{shortText:{text:'5°C'}},
      is_forecast:{boolean:{value:true}},observed_at:{timestamp:{value:NOW/1000-3600}}}}]},'weather','location');
    const slot=f.packet()[0];assert.equal(slot.semantic.detail,detail);assert.equal(slot.semantic.qualifiers,1);
    assert.equal(slot.semantic.observedAt,0);assert.equal(f.client.status().slots[0].observedAt,null);
  }
  const f=fixture();f.client.refresh();f.prefs([preference(0,'weather','location',0,'temperature')]);
  f.source({instances:[{properties:{temperature:{shortText:{text:'5°C'}},
    is_forecast:{boolean:{value:false}},observed_at:{timestamp:{value:NOW/1000-600}}}}]},'weather','location');
  assert.equal(f.packet()[0].semantic.observedAt,NOW/1000-600);
  const before=f.packet()[0];f.tick(60000);f.client.configure();
  assert.equal(f.packet()[0].semantic.observedAt,before.semantic.observedAt);
  assert.equal(f.packet()[0].confirmedAt,before.confirmedAt);
});

test('Expired or denied private selections cannot retain a value, label or source identity on the wire',()=>{
  for(const category of ['music','notifications']) {
    const f=fixture();f.client.refresh();const selected=preference(0,category,'item',0,'value');
    selected.properties.label={shortText:{text:'Private person'}};f.prefs([selected]);
    assert.equal(f.packet()[0].semantic.label,'');
    f.source(envelope({shortText:{text:'Private message'}},{validUntilMs:NOW+1000}),category,'item');
    assert.equal(f.packet()[0].text,'Private message');f.tick(1000);
    const expired=f.packet()[0];assert.equal(expired.status,7);assert.equal(expired.semantic.label,'');
    assert.equal(expired.semantic.source,0);assert.equal(expired.text,'');
    f.sourceError('PERMISSION_DENIED',category,'item');assert.equal(f.packet()[0].semantic.label,'');
    assert.ok(!JSON.stringify([...f.values.values()]).includes('Private message'));
    assert.ok(!JSON.stringify([...f.values.values()]).includes('Private person'),'private descriptor labels must not reach persistent cache metadata');
  }
});

test('Older public caches gain descriptor meaning without renewing values or measurement timestamps',()=>{
  const seed=fixture();seed.client.refresh();seed.prefs([preference(0,'weather','location',0,'feels_like')]);
  seed.source({instances:[{properties:{feels_like:{shortText:{text:'4°C'}}}}]},'weather','location');
  const cached=JSON.parse(seed.values.get('watchface-core-complications-v1'));
  delete cached.records[0].semantic.detail;delete cached.records[0].semantic.qualifiers;
  seed.values.set('watchface-core-complications-v1',JSON.stringify(cached));
  const restored=fixture({values:seed.values});restored.advance(60000);restored.client.refresh();
  restored.prefs([preference(0,'weather','location',0,'feels_like')]);
  assert.equal(restored.packet()[0].semantic.detail,2);assert.equal(restored.packet()[0].text,'4°C');
  assert.equal(restored.packet()[0].confirmedAt,NOW/1000);
  assert.equal(restored.packet()[0].validUntil,NOW/1000+7200);
  assert.equal(restored.client.status().slots[0].cached,true);
});

test('Legacy cache signatures also scrub private custom labels before preferences are available',()=>{
  const values=new Map();
  values.set('watchface-core-complications-v1',JSON.stringify({signature:'two:'+JSON.stringify([
    {category:'music',item:'track',property:'title',index:0,label:'Private person'},null]),records:[null,null]}));
  fixture({values,unavailable:true});
  assert.ok(!JSON.stringify([...values.values()]).includes('Private person'));
  const signature=JSON.parse(values.get('watchface-core-complications-v1')).signature;
  assert.equal(JSON.parse(signature.slice(4))[0].category,'music');
});
