'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const createQueue = require('../src/js/message-queue');

function fixture() {
  const calls=[], timers=new Map(); let sequence=0;
  const send=createQueue({send:(payload,success,failure)=>calls.push({payload,success,failure}),
    later:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,delay});return id;},cancelLater:id=>timers.delete(id)});
  return {send,calls,timers,timeout:()=>[...timers.values()][0].fn()};
}
test('AppMessage serializes independent settings and source snapshots, preserving queued bytes',()=>{
  const f=fixture(), events=[], bytes=[1,2,3];
  f.send({10021:bytes},()=>events.push('complications'));
  f.send({10023:[4,5]},()=>events.push('context'));
  f.send({10003:123},()=>events.push('theme'));
  bytes[0]=99;
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].payload[10021],[1,2,3]);
  f.calls[0].success();assert.equal(f.calls.length,2);
  f.calls[1].success();assert.equal(f.calls.length,3);
  f.calls[2].success();assert.deepEqual(events,['complications','context','theme']);
  assert.equal(f.timers.size,0);
});
test('Failure releases the channel; stale callbacks cannot acknowledge a later delivery',()=>{
  const f=fixture();let firstFailures=0, secondSuccesses=0;
  f.send({one:1},()=>assert.fail('failed delivery cannot succeed'),()=>firstFailures++);
  f.send({two:2},()=>secondSuccesses++);
  f.calls[0].failure({code:'BUSY'});
  f.calls[0].success();f.calls[0].failure();
  assert.equal(firstFailures,1);assert.equal(secondSuccesses,0);
  f.calls[1].success();assert.equal(secondSuccesses,1);
});
test('A missing native callback times out once and cannot block later snapshots',()=>{
  const f=fixture();let error;
  f.send({one:1},()=>assert.fail('timed out'),value=>{error=value;});
  f.send({two:2});
  assert.equal([...f.timers.values()][0].delay,15000);
  f.timeout();assert.equal(error.code,'TIMEOUT');assert.equal(f.calls.length,2);
  f.calls[0].success();assert.equal(f.timers.size,1);
  f.calls[1].success();assert.equal(f.timers.size,0);
});
test('Synchronous send exceptions settle and release the shared channel',()=>{
  let attempts=0,failures=0,successes=0;
  const send=createQueue({send:(_payload,success)=>{if(!attempts++)throw Error('transport');success();},
    later:()=>1,cancelLater:()=>{}});
  send({one:1},null,()=>failures++);send({two:2},()=>successes++);
  assert.equal(failures,1);assert.equal(successes,1);
});

test('Latest pending snapshots replace waiting context and complication data while settings keep their order',()=>{
  const f=fixture(),events=[];
  f.send({10003:1},()=>events.push('first-settings'));
  f.send({10023:[1],10024:37},()=>assert.fail('old context cannot ACK'),error=>events.push('context-'+error.code));
  f.send({10021:[2]},()=>assert.fail('old complication cannot ACK'),error=>events.push('comp-'+error.code));
  f.send({10003:2},()=>events.push('second-settings'));
  f.send({10023:[3],10024:38},()=>events.push('context-latest'));
  f.send({10021:[4]},()=>events.push('comp-latest'));
  assert.deepEqual(events,['context-SUPERSEDED','comp-SUPERSEDED']);
  f.calls[0].success();assert.deepEqual(f.calls[1].payload,{10003:2});
  f.calls[1].success();assert.deepEqual(f.calls[2].payload,{10023:[3],10024:38});
  f.calls[2].success();assert.deepEqual(f.calls[3].payload,{10021:[4]});
  f.calls[3].success();
  assert.deepEqual(events,['context-SUPERSEDED','comp-SUPERSEDED','first-settings','second-settings','context-latest','comp-latest']);
});

test('Snapshot replacement never cancels active transfers or drops mixed settings/control messages',()=>{
  const f=fixture(),events=[];
  f.send({10023:[0]},()=>events.push('active'));
  f.send({10023:[1],10003:99},()=>events.push('mixed'));
  f.send({10024:1},()=>events.push('query'));
  f.send({10023:[2]},()=>assert.fail('old queued snapshot'),error=>events.push(error.code));
  f.send({10023:[3]},()=>events.push('latest'));
  assert.deepEqual(events,['SUPERSEDED']);
  f.calls[0].success();assert.equal(f.calls[1].payload[10003],99);
  f.calls[1].success();assert.deepEqual(f.calls[2].payload,{10024:1});
  f.calls[2].success();assert.deepEqual(f.calls[3].payload,{10023:[3]});
  f.calls[3].success();assert.deepEqual(events,['SUPERSEDED','active','mixed','query','latest']);
});

test('Replacement is allowed at the queue bound, settings failures settle exactly once, and callback exceptions cannot corrupt it',()=>{
  const f=fixture();let replaced=0,busy=0;
  f.send({active:1});
  f.send({10023:[1]},null,error=>{assert.equal(error.code,'SUPERSEDED');replaced++;throw Error('consumer');});
  for(let i=0;i<15;i++)f.send({setting:i});
  assert.throws(()=>f.send({10023:[2]}),/consumer/);assert.equal(replaced,1);
  f.send({extra:1},null,error=>{assert.equal(error.code,'BUSY');busy++;});assert.equal(busy,1);
  f.calls[0].success();
  for(let i=1;i<=15;i++){assert.equal(f.calls[i].payload.setting,i-1);f.calls[i].success();}
  assert.deepEqual(f.calls[16].payload,{10023:[2]});f.calls[16].success();
  assert.equal(f.timers.size,0);assert.equal(replaced,1);assert.equal(busy,1);
});

test('Custom message keys and typed snapshot buffers are supported without mutating queued bytes',()=>{
  const calls=[];
  const send=createQueue({keys:{CONTEXT_DATA:7,REQUEST_CONTEXT:8,COMPLICATION_DATA:9},
    send:(payload,success)=>calls.push({payload,success}),later:()=>1,cancelLater:()=>{}});
  send({active:1});const pixels=new Uint8Array([1,2]);
  send({7:pixels,8:3});pixels[0]=99;send({7:new Uint8Array([3,4]),8:4});
  calls[0].success();assert.deepEqual(calls[1].payload,{7:[3,4],8:4});
});

test('Context playback/event sidecars are copied and superseded atomically with their snapshot',()=>{
  const f=fixture(),events=[],state=new Uint8Array([7,0,0,0,1,0,0,0,0]);
  f.send({setting:1});
  f.send({10023:[1],10025:state},null,error=>events.push(error.code));state[4]=99;
  f.send({10023:[2],10024:8,10025:[8,0,0,0,0,0,0,0,1]});
  assert.deepEqual(events,['SUPERSEDED']);f.calls[0].success();
  assert.deepEqual(f.calls[1].payload,{10023:[2],10024:8,10025:[8,0,0,0,0,0,0,0,1]});
  const custom=[];
  const send=createQueue({keys:{CONTEXT_DATA:23,REQUEST_CONTEXT:24,CONTEXT_STATE:40},
    send:(payload,success)=>custom.push({payload,success}),later:()=>1,cancelLater:()=>{}});
  send({setting:1});send({23:[1],40:state});send({23:[2],40:new Uint8Array([8,0,0,0,2,0,0,0,0])});
  custom[0].success();assert.deepEqual(custom[1].payload,{23:[2],40:[8,0,0,0,2,0,0,0,0]});
});
