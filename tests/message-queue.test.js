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
