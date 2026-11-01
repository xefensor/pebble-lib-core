'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const api=require('../src/js');
const fixtures=require('./fixtures/protocol-v2.json');

test('The public entrypoint exposes only host-configured coordinators and wire helpers',()=>{
  assert.deepEqual(Object.keys(api).sort(),['createComplications','createContext','createMessageQueue','wire']);
  assert.equal(api.createComplications,require('../src/js/complications'));
  assert.equal(api.createContext,require('../src/js/context'));
  assert.equal(api.createMessageQueue,require('../src/js/message-queue'));
  assert.equal(api.wire,require('../src/js/complication-data'));
});

test('Released byte fixtures preserve the C/JavaScript v2 packet and CRC contract',()=>{
  for(const value of fixtures.cases) {
    const expected=Buffer.from(value.hex,'hex');
    assert.deepEqual(Buffer.from(api.wire.packComplications(value.records,fixtures.now,2)),expected,value.name);
    assert.deepEqual(fs.readFileSync(path.join(__dirname,'fixtures',value.name+'.bin')),expected,value.name);
    assert.equal(expected[0],2);assert.equal(expected[1],0);
    assert.equal(expected.readUInt16LE(2),expected.length);
    const check=[...expected];check[4]=0;check[5]=0;
    assert.equal(expected.readUInt16LE(4),api.wire.crc16Xmodem(check));
  }
});

test('V3 golden packets anchor the JavaScript encoder and independent native decoder',()=>{
  const v3=require('./fixtures/protocol-v3.json');
  for(const value of v3.cases) {
    const expected=Buffer.from(value.hex,'hex');
    assert.deepEqual(Buffer.from(api.wire.packComplications(value.records,v3.now)),expected,value.name);
    assert.deepEqual(fs.readFileSync(path.join(__dirname,'fixtures',value.name+'.bin')),expected);
    assert.equal(expected[0],3);assert.equal(expected.readUInt16LE(2),expected.length);
  }
  assert.equal(Buffer.from(v3.cases[2].hex,'hex').length,5186);
});
