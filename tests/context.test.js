'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const createContext=require('../src/js/context');
const createQueue=require('../src/js/message-queue');
const NOW=1791893700000;
const KEY=10023;
const REQUEST_KEY=10024;
const text=value=>({shortText:{text:value}});
const music=(playing=true,title='Genesis',artist='Justice',extra={})=>({instances:[{instanceId:'track',properties:{
  title:text(title),artist:text(artist),playing:{boolean:{value:playing}},...extra}}]});
const notification=(id,title='Alexej',app='Signal',body='Dinner in ten minutes',extra={})=>({instanceId:id,properties:{
  name:text(title),app:text(app),body:text(body),package:{longText:{text:'org.thoughtcrime.securesms'}},...extra}});
const battery=value=>({instances:[{instanceId:'phone',properties:{battery_level:{numericValue:{value,unit:'%'}}}}]});
const envelope=instances=>({instances});
function decode(bytes) {
  const buffer=Buffer.from(bytes); let at=6;
  const header=buffer[0]>=3 ? 52 : 20;
  return Array.from({length:5},()=>{
    const value={flags:buffer[at],status:buffer[at+1],width:buffer[at+3],height:buffer[at+4],
      confirmedAt:buffer.readUInt32LE(at+6),validUntil:buffer.readUInt32LE(at+10)};
    const length=buffer[at+2], pixelBytes=buffer.readUInt16LE(at+14);
    const unitLength=header===52 ? buffer[at+22] : 0,labelLength=header===52 ? buffer[at+23] : 0;
    value.text=buffer.subarray(at+header,at+header+length).toString('utf8');
    if(header===52) value.semantic={kind:buffer[at+20],source:buffer[at+24],value:buffer[at+21]&1 ? buffer.readDoubleLE(at+28) : undefined,
      min:buffer[at+21]&2 ? buffer.readDoubleLE(at+36) : undefined,max:buffer[at+21]&4 ? buffer.readDoubleLE(at+44) : undefined};
    if (value.flags&2) value.pixels=[...buffer.subarray(at+header+length+unitLength+labelLength+16,at+header+length+unitLength+labelLength+16+pixelBytes)];
    at+=header+length+unitLength+labelLength+(value.flags&2?16+pixelBytes:0);
    return value;
  });
}
function fixture(overrides={}) {
  let now=NOW, sequence=0, hold=false;
  const settings={showMusic:true,showNotifications:false,notificationPreview:false,notificationApps:'',showStatus:true,...overrides.settings};
  const timers=new Map(), subscriptions=[], deliveries=[], callbacks=[];
  const pebble={subscribeToSource:request=>{
    const handle={request,closed:false,unsubscribe(){this.closed=true;}};
    subscriptions.push(handle);
    if(overrides.subscribe) overrides.subscribe(request,handle);
    return handle;
  }};
  const subscribe=pebble.subscribeToSource;
  if(overrides.unavailable) delete pebble.subscribeToSource;
  const options={pebble,keys:{CONTEXT_DATA:KEY,REQUEST_CONTEXT:REQUEST_KEY},getSettings:()=>settings,now:()=>now,
    later:(fn,delay)=>{const id=++sequence;timers.set(id,{at:now+delay,fn});return id;},cancelLater:id=>timers.delete(id),
    // Private data must never be persisted by this coordinator.
    storage:{getItem(){throw new Error('No private-content storage');},setItem(){throw new Error('No private-content storage');}},
    log(){throw new Error('No private-content logging');},
    send:(payload,success,failure)=>{deliveries.push(payload);callbacks.push({success,failure});if(!hold)success();}
  };
  if(overrides.queue) options.send=createQueue({send:options.send,keys:options.keys,later:options.later,cancelLater:options.cancelLater});
  const client=createContext(options);
  function latest(name) {
    const category=name==='phone'?'phone':name;
    const value=subscriptions.filter(sub=>!sub.closed && sub.request.category===category).at(-1);
    assert.ok(value,'missing source '+name); return value.request;
  }
  return {client,settings,timers,subscriptions,deliveries,callbacks,latest,time:()=>now,
    apiAvailable:value=>{if(value)pebble.subscribeToSource=subscribe;else delete pebble.subscribeToSource;},
    source:(name,value)=>latest(name).onData(value),error:(name,code)=>latest(name).onError({code}),
    packet:()=>decode(deliveries.at(-1)[KEY]),hold:value=>{hold=value;},advance:ms=>{now+=ms;},
    tick:ms=>{const end=now+ms;let count=0;for(;;){
      const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next)break;assert.ok(++count<2000);now=next[1].at;timers.delete(next[0]);next[1].fn();
    }now=end;}};
}

test('Default context subscribes only music and phone state, without provider pins or notification access',()=>{
  const f=fixture();f.client.refresh();
  assert.deepEqual(f.subscriptions.map(s=>[s.request.category,s.request.item]),[['music','track'],['phone','phone_state']]);
  for(const sub of f.subscriptions) assert.equal(sub.request.plugin,undefined);
  assert.deepEqual(f.latest('music').iconPixelSize,{w:40,h:40});
  assert.equal(f.latest('phone').iconPixelSize,undefined);
  assert.equal(f.client.status().ready,false);
  f.source('music',envelope([]));f.source('phone',battery(75));
  assert.equal(f.client.status().ready,true);
  assert.deepEqual(f.packet().map(s=>s.status),[0,0,0,0,0]);
});

test('Playing music has a two-minute receipt lease and independent title/artist fields',()=>{
  const f=fixture();f.client.refresh();f.source('music',music());
  assert.deepEqual(f.packet().slice(0,2).map(s=>s.text),['Genesis','Justice']);
  assert.equal(f.packet()[0].confirmedAt,NOW/1000);
  assert.equal(f.packet()[0].validUntil,NOW/1000+120);
  assert.equal(f.packet()[1].validUntil,f.packet()[0].validUntil);
  assert.equal(f.client.status().music,true);
  assert.ok(!JSON.stringify(f.client.status()).includes('Genesis'));
});

test('Initially paused music stays hidden; a playing track gets one non-renewable five-second pause grace',()=>{
  const f=fixture();f.client.refresh();f.source('music',music(false));
  assert.equal(f.packet()[0].status,0);
  f.source('music',music());f.tick(10000);f.source('music',music(false));
  const deadline=f.packet()[0].validUntil;
  assert.equal(deadline,NOW/1000+15);
  f.tick(2000);f.source('music',music(false));
  assert.equal(f.packet()[0].validUntil,deadline);
  f.tick(3000);assert.equal(f.packet()[0].status,0);
  f.source('music',music(false));assert.equal(f.packet()[0].status,0);
  f.source('music',music(true,'New song'));
  assert.equal(f.packet()[0].text,'New song');
});

test('Heartbeat rebinding does not renew content until an authoritative native delivery arrives',()=>{
  const f=fixture();f.client.refresh();f.source('music',music());f.source('phone',battery(12));
  const old=f.latest('music');f.tick(60000);
  assert.notEqual(f.latest('music'),old);
  old.onData(music(true,'Obsolete'));
  f.client.configure();assert.equal(f.packet()[0].text,'Genesis');
  assert.equal(f.packet()[0].confirmedAt,NOW/1000);
  f.source('music',music(true,'Fresh'));
  assert.equal(f.packet()[0].confirmedAt,NOW/1000+60);
  f.tick(120000);assert.equal(f.packet()[0].status,0);
  assert.equal(f.packet()[4].status,0);
});

test('Provider expiry is respected and malformed source contracts clear ephemeral content',()=>{
  const f=fixture();f.client.refresh();
  f.source('music',{...music(),validUntilMs:NOW+2000});
  assert.equal(f.packet()[0].validUntil,NOW/1000+2);
  f.tick(2000);assert.equal(f.packet()[0].status,0);
  for(const value of [null,{}, {instances:'wrong'},music('true'),music(true,''),{...music(),validUntilMs:'tomorrow'}]) {
    f.source('music',value);assert.equal(f.packet()[0].status,0);
    assert.equal(f.client.status().error,'INVALID_DATA');
  }
  f.source('music',envelope([]));assert.equal(f.client.status().error,'');
});

test('Album artwork is decoded from compact odd-width source rows into aligned watch rows',()=>{
  const f=fixture();f.client.refresh();
  const shape={width:3,height:2,palette:Buffer.from([0,255]).toString('base64'),pixels:Buffer.from([0x10,0x10,0x01,0x00]).toString('base64')};
  f.source('music',music(true,'Album track','Artist',{artwork:{image:shape}}));
  const p=f.packet()[0];assert.equal(p.flags,7);assert.equal(p.width,3);assert.equal(p.height,2);
  assert.deepEqual(p.pixels,[0x10,0x10,0,0,0x01,0,0,0]);
  f.source('music',music(true,'Still text','Artist',{artwork:{image:{...shape,pixels:'AA=='}}}));
  assert.equal(f.packet()[0].flags,1);
  assert.equal(f.packet()[0].text,'Still text');
  f.source('music',music(true,'Themed icon','Artist',{artwork:{icon:shape}}));
  assert.equal(f.packet()[0].flags,3,'monochrome icon fallback is tinted by the native theme');
});

test('Notification baseline suppresses existing shade entries and only newly arriving IDs activate a summary',()=>{
  const f=fixture({settings:{showNotifications:true}});f.client.refresh();
  const existing=notification('old');f.source('notifications',envelope([existing]));
  assert.equal(f.packet()[2].status,0);
  f.source('notifications',envelope([notification('new'),existing]));
  assert.equal(f.packet()[2].text,'Signal · Alexej');
  assert.equal(f.packet()[3].status,0,'message bodies are hidden by default');
  assert.equal(f.packet()[2].validUntil,NOW/1000+8);
  assert.equal(f.client.status().notification,true);
});

test('Notification body previews are opt-in, sanitize controls, and never renew on identical redeliveries or other-source updates',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh();
  f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('one','Alex\u202e\nXef','Signal','Meet\nme\u200b here')]));
  assert.equal(f.packet()[2].text,'Signal · Alex Xef');
  assert.equal(f.packet()[3].text,'Meet me here');
  const first=f.packet()[2];f.tick(5000);
  f.source('notifications',envelope([notification('one','Alex\u202e\nXef','Signal','Meet\nme\u200b here')]));
  f.source('music',music());f.source('phone',battery(10));
  assert.equal(f.packet()[2].text,first.text);
  assert.equal(f.packet()[2].confirmedAt,first.confirmedAt);
  assert.equal(f.packet()[2].validUntil,first.validUntil);
  f.tick(7000);assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[3].status,0);
});

test('Removing the active notification clears its summary immediately, even while music continues',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh();
  f.source('music',music());f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('new')]));
  f.source('notifications',envelope([]));
  assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[3].status,0);
  assert.equal(f.packet()[0].text,'Genesis');
});

test('A new message on the same conversation notification key activates a fresh summary, while artwork-only changes do not',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh();
  f.source('notifications',envelope([notification('chat','Alexej','Signal','Earlier message')]));
  f.source('notifications',envelope([notification('chat','Alexej','Signal','A new message')]));
  assert.equal(f.packet()[3].text,'A new message');
  assert.equal(f.packet()[2].validUntil,NOW/1000+8);
  f.tick(5000);
  f.source('notifications',envelope([notification('chat','Alexej','Signal','Another new message')]));
  assert.equal(f.packet()[3].text,'Another new message');
  const end=f.packet()[2].validUntil;
  assert.equal(end,NOW/1000+8,'updates in one burst keep the original interruption deadline');
  f.tick(1000);
  f.source('notifications',envelope([notification('chat','Alexej','Signal','Another new message',{app_icon:{image:{invalid:true}}})]));
  assert.equal(f.packet()[2].validUntil,end);
});

test('App-name and package filters match exact case-insensitive entries and ignore disallowed arrivals',()=>{
  const f=fixture({settings:{showNotifications:true,notificationApps:' signal, COM.WHATSAPP , signal '}});f.client.refresh();
  f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('no','Update','Signal Beta')]));
  assert.equal(f.packet()[2].status,0);
  f.source('notifications',envelope([notification('yes','Hello','SIGNAL')]));
  assert.equal(f.packet()[2].text,'SIGNAL · Hello');
  f.source('notifications',envelope([notification('package','Hello','WhatsApp Business','text',{
    package:{longText:{text:'com.whatsapp'}}})]));
  assert.equal(f.packet()[2].text,'WhatsApp Business · Hello');
});

test('The newest allowed new notification wins; duplicate and prototype-like IDs remain safe',()=>{
  const f=fixture({settings:{showNotifications:true}});f.client.refresh();f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('__proto__','Newest'),notification('constructor','Older'),notification('__proto__','Duplicate')]));
  assert.equal(f.packet()[2].text,'Signal · Newest');
  f.tick(1000);f.source('notifications',envelope([notification('__proto__','Newest'),notification('constructor','Older')]));
  assert.equal(f.packet()[2].text,'Signal · Newest');
});

test('Reconnection suppresses accumulated notifications and ignores callbacks from previous subscriptions',()=>{
  const f=fixture({settings:{showNotifications:true}});f.client.refresh();f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('one')]));const old=f.latest('notifications');
  f.client.connectionChanged(false);
  assert.equal(f.client.status().notification,false);assert.equal(f.timers.size,0);
  old.onData(envelope([notification('late')]));assert.equal(f.client.status().notification,false);
  f.client.connectionChanged(true,2);f.source('notifications',envelope([notification('offline')]));
  assert.equal(f.packet()[2].status,0);
  f.source('notifications',envelope([notification('new'),notification('offline')]));
  assert.equal(f.packet()[2].status,2);
  f.client.connectionChanged(true,3);f.source('notifications',envelope([notification('new'),notification('offline')]));
  assert.equal(f.packet()[2].status,0,'explicit native reconnect always re-establishes the baseline');
});

test('Relevant configuration changes retract previews and establish a fresh baseline; cosmetic replay keeps original music timestamps',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh();
  f.source('music',music());f.source('notifications',envelope([]));f.source('notifications',envelope([notification('one')]));
  const first=f.packet()[0];f.advance(1000);f.client.configure();
  assert.equal(f.packet()[0].confirmedAt,first.confirmedAt);
  assert.equal(f.packet()[2].status,2);
  const old=f.latest('notifications');f.settings.notificationPreview=false;f.client.configure();
  assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[3].status,0);
  old.onData(envelope([notification('late')]));assert.equal(f.packet()[2].status,0);
  f.source('notifications',envelope([notification('one')]));assert.equal(f.packet()[2].status,0);
  f.settings.showNotifications=false;f.settings.showMusic=false;f.settings.showStatus=false;f.client.configure();
  assert.ok(f.subscriptions.every(s=>s.closed));assert.equal(f.timers.size,0);
  assert.equal(f.client.status().ready,true);
});

test('Low phone battery preserves zero and only displays percentages at or below fifteen',()=>{
  const f=fixture();f.client.refresh();
  for(const value of [0,1,15]){f.source('phone',battery(value));assert.equal(f.packet()[4].text,value+'%');}
  for(const value of [15.1,42,100]){f.source('phone',battery(value));assert.equal(f.packet()[4].status,0);}
  for(const value of [-1,101,NaN,'5']){f.source('phone',battery(value));assert.equal(f.packet()[4].status,0);assert.equal(f.client.status().sources.phone,'INVALID_DATA');}
  f.source('phone',{instances:[{properties:{battery_level:{numericValue:{value:4,unit:'volts'}}}}]});
  assert.equal(f.packet()[4].status,0);
});

test('Source errors retract only their data, keep diagnostic codes content-free and require a new notification baseline',()=>{
  const f=fixture({settings:{showNotifications:true}});f.client.refresh();
  f.source('music',music());f.source('phone',battery(5));f.source('notifications',envelope([]));f.source('notifications',envelope([notification('one')]));
  f.latest('notifications').onError({code:'PERMISSION_DENIED',message:'Secret notification body'});
  assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[0].text,'Genesis');assert.equal(f.packet()[4].text,'5%');
  assert.equal(f.client.status().error,'PERMISSION_DENIED');
  assert.ok(!JSON.stringify(f.client.status()).includes('Secret'));
  f.source('notifications',envelope([notification('one')]));assert.equal(f.packet()[2].status,0);
  f.error('music','PLUGIN_UNAVAILABLE');assert.equal(f.packet()[0].status,0);assert.equal(f.packet()[1].status,0);
});

test('Unavailable sources retry after five then fifteen seconds, independently of healthy sources',()=>{
  const f=fixture();f.client.refresh();f.error('music','PLUGIN_UNAVAILABLE');
  const first=f.latest('music');f.tick(4999);assert.equal(f.latest('music'),first);
  f.tick(1);const second=f.latest('music');assert.notEqual(second,first);
  f.source('phone',battery(10));f.error('music','PLUGIN_UNAVAILABLE');
  f.tick(14999);assert.equal(f.latest('music'),second);
  f.tick(1);assert.notEqual(f.latest('music'),second);
  f.source('music',music());f.tick(5000);assert.equal(f.packet()[0].text,'Genesis');
});

test('Delivery coalesces queued updates, retries only current state, and never revives an expired preview',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh();f.hold(true);
  f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('one')]));
  f.source('music',music(true,'Newest song'));
  const count=f.deliveries.length;f.tick(12000);
  assert.equal(f.deliveries.length,count,'one context transfer remains in flight');
  f.callbacks.at(-1).failure();
  assert.equal(f.packet()[0].text,'Newest song');assert.equal(f.packet()[2].status,0);
  f.callbacks.at(-1).failure();f.tick(1000);
  assert.equal(f.packet()[2].status,0);
  f.callbacks.at(-1).failure();f.tick(2000);f.callbacks.at(-1).failure();
  const final=f.deliveries.length;f.tick(10000);assert.equal(f.deliveries.length,final,'bounded retries');
});

test('A stuck send has bounded callback watchdogs, while disconnect and stop cancel pending retries',()=>{
  const f=fixture({settings:{showMusic:false,showStatus:false}});f.hold(true);f.client.refresh();
  f.tick(45000+1000+45000+2000+45000);
  assert.equal(f.deliveries.length,3);assert.equal(f.timers.size,0);
  f.client.refresh();f.callbacks.at(-1).failure();f.client.connectionChanged(false);f.tick(10000);
  assert.equal(f.deliveries.length,4);
  f.client.connectionChanged(true);f.client.stop();
  const count=f.deliveries.length;f.tick(600000);f.client.refresh();f.client.configure();
  assert.equal(f.deliveries.length,count);assert.equal(f.timers.size,0);
});

test('Missing plugin APIs clear context without reading private storage or requesting notification access',()=>{
  const f=fixture({unavailable:true});f.client.refresh();
  assert.equal(f.client.status().available,false);assert.equal(f.client.status().ready,false);
  assert.deepEqual(f.packet().map(s=>s.status),[0,0,0,0,0]);
  assert.equal(f.subscriptions.length,0);assert.equal(f.timers.size,0);
  assert.equal(f.client.status().error,'API_UNAVAILABLE');
});

test('Plugin API appearing after launch recovers on refresh and establishes a new notification baseline',()=>{
  const f=fixture({unavailable:true,settings:{showNotifications:true}});f.client.refresh(true,2);
  assert.equal(f.client.status().error,'API_UNAVAILABLE');
  f.apiAvailable(true);f.client.refresh();
  assert.equal(f.client.status().available,true);assert.equal(f.client.status().error,'');
  f.source('music',music());f.source('phone',battery(10));
  f.source('notifications',envelope([notification('existing')]));
  assert.equal(f.packet()[0].text,'Genesis');assert.equal(f.packet()[4].text,'10%');
  assert.equal(f.packet()[2].status,0,'enabling the API does not replay the existing shade');
  assert.equal(f.client.status().ready,true);
  f.source('notifications',envelope([notification('new'),notification('existing')]));
  assert.equal(f.packet()[2].status,2);
});

test('Plugin API loss clears data and recovery timers, invalidates old callbacks, and can recover through configure',()=>{
  const f=fixture({settings:{showNotifications:true}});f.client.refresh();
  f.source('music',music());f.source('phone',battery(5));f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('one')]));
  const oldMusic=f.latest('music'), oldNotifications=f.latest('notifications');
  f.error('phone','PLUGIN_UNAVAILABLE');
  f.apiAvailable(false);f.client.refresh();
  assert.deepEqual(f.packet().map(s=>s.status),[0,0,0,0,0]);
  assert.equal(f.client.status().error,'API_UNAVAILABLE');assert.equal(f.client.status().ready,false);
  assert.equal(f.timers.size,0);assert.ok(f.subscriptions.every(s=>s.closed));
  oldMusic.onData(music(true,'Obsolete'));oldNotifications.onData(envelope([notification('late')]));
  assert.deepEqual(f.packet().map(s=>s.status),[0,0,0,0,0]);
  f.apiAvailable(true);f.client.configure();f.source('music',music(true,'Recovered'));
  f.source('notifications',envelope([notification('one'),notification('late')]));
  assert.equal(f.packet()[0].text,'Recovered');assert.equal(f.packet()[2].status,0);
  f.source('phone',battery(80));assert.equal(f.client.status().ready,true);
});

test('Configuration also detects API disappearance, and all disabled context sources do not require it',()=>{
  const f=fixture();f.client.refresh();f.source('music',music());
  f.apiAvailable(false);f.client.configure();
  assert.equal(f.packet()[0].status,0);assert.equal(f.client.status().error,'API_UNAVAILABLE');
  f.settings.showMusic=false;f.settings.showStatus=false;f.client.configure();
  assert.equal(f.client.status().error,'');assert.equal(f.client.status().ready,true);
  const disabledSubscriptions=f.subscriptions.length;
  f.apiAvailable(true);f.client.configure();
  assert.equal(f.subscriptions.length,disabledSubscriptions);
});

test('The context heartbeat notices API loss and retracts content instead of retrying an absent method',()=>{
  const f=fixture();f.client.refresh();f.source('music',music());
  f.apiAvailable(false);f.tick(60000);
  assert.equal(f.packet()[0].status,0);assert.equal(f.client.status().error,'API_UNAVAILABLE');
  assert.equal(f.timers.size,0);
});

test('Startup baseline markers precede synchronous source deliveries and stop after their own ACK',()=>{
  const f=fixture({subscribe:request=>{
    if(request.category==='music') request.onData(music());
    else if(request.category==='phone') request.onData(battery(5));
  }});
  f.hold(true);f.client.refresh(true,2);
  assert.equal(f.deliveries[0][REQUEST_KEY],2,'first synchronous source packet carries the boundary');
  f.callbacks[0].success();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined,'same-baseline ACK releases later packets');
  assert.equal(f.packet()[4].text,'5%');
});

test('An old queued notification ACK cannot clear the reconnect marker or replay its old private content',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh();
  f.source('notifications',envelope([]));f.hold(true);
  f.source('notifications',envelope([notification('one','Alexej','Signal','Old private body')]));
  assert.equal(f.packet()[3].text,'Old private body');
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  const old=f.callbacks.at(-1);
  f.client.refresh(true,2);
  old.success();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2,'the old unmarked ACK cannot acknowledge the new boundary');
  assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[3].status,0);
  f.callbacks.at(-1).success();f.hold(false);
  f.source('notifications',envelope([notification('one','Alexej','Signal','Old private body')]));
  assert.equal(f.packet()[2].status,0,'new baseline suppresses existing phone content');
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
});

test('Repeated reconnects require the newest baseline generation even when an earlier marked packet succeeds',()=>{
  const f=fixture({settings:{showNotifications:true}});f.hold(true);f.client.refresh(true,2);
  const first=f.callbacks.at(-1);
  f.client.connectionChanged(true,3);
  first.success();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],3,'old-token ACK cannot release the later baseline');
  const second=f.callbacks.at(-1);
  f.client.connectionChanged(true,4);second.success();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],4);
  first.success();second.failure();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],4,'late duplicate callbacks cannot release a newer token');
  f.callbacks.at(-1).success();f.hold(false);f.source('music',music());
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
});

test('A failed marked transfer retains the marker on retries; API rebaselines establish a new boundary too',()=>{
  const f=fixture({settings:{showMusic:false,showStatus:false}});f.hold(true);f.client.refresh(true,2);
  const first=f.callbacks.at(-1);first.failure();f.tick(1000);
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2);
  first.success();f.callbacks.at(-1).success();f.hold(false);f.client.refresh();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  f.apiAvailable(false);f.client.configure();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2);
  f.apiAvailable(true);f.client.configure();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2);
});

test('Every marked boundary is notification-free, including a retry queued after a fresh notice arrives',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.hold(true);f.client.refresh(true,2);
  const first=f.callbacks.at(-1);
  f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('fresh','Alexej','Signal','Fresh private body')]));
  first.failure();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2);
  assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[3].status,0);
  f.callbacks.at(-1).success();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  assert.equal(f.packet()[3].text,'Fresh private body','fresh content follows its acknowledged boundary');
  assert.equal(f.packet()[2].confirmedAt,NOW/1000);
  assert.equal(f.packet()[2].validUntil,NOW/1000+8,'the boundary does not renew the notice lifetime');
});

test('Startup waits for the native token instead of echoing a default boundary or forwarding early notifications',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh(true);
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  f.source('notifications',envelope([]));
  f.source('notifications',envelope([notification('early')]));
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[3].status,0);
  f.client.connectionChanged(true,2147483647);
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2147483647);
  f.source('notifications',envelope([notification('early')]));
  assert.equal(f.packet()[2].status,0,'the native token establishes a fresh shade baseline');
  f.source('notifications',envelope([notification('new'),notification('early')]));
  assert.equal(f.packet()[2].status,2);assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
});

test('A new connection without a native token cannot reuse the previous connection token',()=>{
  const f=fixture();f.client.refresh(true,37);
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],37);
  f.client.connectionChanged(true);
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  f.source('music',music());f.client.refresh();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  f.client.connectionChanged(true,38);
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],38);
  f.apiAvailable(false);f.client.configure();
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],38,'API rebaseline retains the current connection token');
});

test('Only positive 31-bit native tokens above the ordinary request value are echoed',()=>{
  const f=fixture();
  for(const value of [undefined,null,0,1,-1,2.5,'2',2147483648,Infinity,NaN]) {
    f.client.refresh(true,value);
    assert.equal(f.deliveries.at(-1)[REQUEST_KEY],undefined);
  }
  f.client.refresh(true,2);assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2);
  f.client.refresh(true,2147483647);assert.equal(f.deliveries.at(-1)[REQUEST_KEY],2147483647);
});

test('Music titles and artists retain128UTF8bytes and request40px artwork while notification icons remain24px',()=>{
  const f=fixture({settings:{showNotifications:true}});f.client.refresh();
  const shape={width:40,height:40,palette:Buffer.from([0,255]).toString('base64'),pixels:Buffer.alloc(800,0x10).toString('base64')};
  f.source('music',music(true,'ě'.repeat(50),'Artist '.repeat(30),{artwork:{image:shape}}));
  assert.equal(f.packet()[0].text,'ě'.repeat(50));assert.equal(f.packet()[0].width,40);assert.equal(f.packet()[0].height,40);
  assert.equal(f.packet()[0].pixels.length,800);assert.equal(f.packet()[0].semantic.source,3);
  assert.equal(Buffer.byteLength(f.packet()[1].text,'utf8'),128);assert.ok(f.packet()[1].text.endsWith('…'));
  assert.deepEqual(f.latest('notifications').iconPixelSize,{w:24,h:24});
  f.source('notifications',envelope([]));f.source('notifications',envelope([notification('one','Alexej','Signal','Text',{app_icon:{image:shape}})]));
  assert.equal(f.packet()[2].flags,1,'oversized notification icons are omitted');assert.equal(f.packet()[2].semantic.source,4);
  f.source('phone',battery(0));assert.deepEqual(f.packet()[4].semantic,{kind:3,source:2,value:0,min:0,max:100});
});

test('A continuous notification burst updates the visible text but cannot extend its8second interruption, then resets after quiet',()=>{
  const f=fixture({settings:{showNotifications:true,notificationPreview:true}});f.client.refresh();f.source('music',music());
  f.source('notifications',envelope([]));f.source('notifications',envelope([notification('chat','Alexej','Signal','Message0')]));
  const end=f.packet()[2].validUntil;
  for(let i=1;i<=20;i++) {
    f.tick(1000);f.source('notifications',envelope([notification('chat','Alexej','Signal','Message'+i)]));
    if(i<8) {assert.equal(f.packet()[3].text,'Message'+i);assert.equal(f.packet()[2].validUntil,end);}
    else {assert.equal(f.packet()[2].status,0);assert.equal(f.packet()[3].status,0);}
    assert.equal(f.packet()[0].text,'Genesis','music remains available underneath the interruption');
  }
  f.tick(3000);f.source('notifications',envelope([notification('chat','Alexej','Signal','Independent later message')]));
  assert.equal(f.packet()[3].text,'Independent later message');assert.equal(f.packet()[2].validUntil,NOW/1000+31);
});

test('Context source health reports receipt ages and state without pretending receipt is an observation timestamp',()=>{
  const f=fixture({settings:{showNotifications:true}});f.client.refresh();
  assert.equal(f.client.status().sourceStates.music.state,'waiting');
  f.source('music',music());f.source('phone',battery(80));f.source('notifications',envelope([]));
  let state=f.client.status().sourceStates;
  assert.equal(state.music.state,'playing');assert.equal(state.notifications.state,'idle');assert.equal(state.phone.state,'ready');
  assert.equal(state.music.receivedAt,NOW/1000);assert.equal(state.music.observedAt,null);
  f.advance(2000);f.source('music',music(false));assert.equal(f.client.status().sourceStates.music.state,'paused');
  f.error('notifications','PERMISSION_DENIED');state=f.client.status().sourceStates;
  assert.equal(state.notifications.state,'denied');assert.equal(state.notifications.message,'PERMISSION_DENIED');
  assert.equal(state.phone.receivedAgeSec,2);assert.equal(state.phone.observationAgeSec,null);
  assert.ok(!JSON.stringify(state).includes('Genesis'));
});

test('Shared transport coalesces waiting context snapshots to the latest data and preserves the matching baseline token',()=>{
  const f=fixture({queue:true,settings:{showNotifications:true}});f.hold(true);f.client.refresh(true,7);
  f.source('music',music(true,'Old'));f.source('music',music(true,'Latest'));
  f.client.connectionChanged(true,8);f.source('music',music(true,'After reconnect'));
  assert.equal(f.deliveries.length,1);
  f.callbacks[0].success();assert.equal(f.deliveries.length,2);
  assert.equal(f.deliveries.at(-1)[REQUEST_KEY],8);assert.equal(f.packet()[0].text,'After reconnect');assert.equal(f.packet()[2].status,0);
  f.callbacks[1].success();f.tick(5000);assert.equal(f.deliveries.length,2);assert.equal(f.client.status().error,'');
});

test('A superseded standalone context transfer is terminal and never changes provider health',()=>{
  const f=fixture();f.hold(true);f.client.refresh();f.callbacks.at(-1).failure({code:'SUPERSEDED'});
  const count=f.deliveries.length;f.tick(5000);assert.equal(f.deliveries.length,count);assert.equal(f.client.status().error,'');
});
