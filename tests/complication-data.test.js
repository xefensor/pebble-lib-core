'use strict';

const assert = require('node:assert/strict');
const {test} = require('node:test');
const {packComplications, normalizeText, crc16Xmodem} = require('../src/js/complication-data');
const NOW = 1791893700;
const ready = data => Object.assign({status:2,confirmedAt:NOW-60,validUntil:NOW+1200},data);

function decode(packet) {
  assert.ok(Array.isArray(packet));
  assert.ok(packet.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255));
  const b=Buffer.from(packet);
  assert.equal(b[0],3);
  assert.equal(b[1],0);
  assert.equal(b.readUInt16LE(2),b.length);
  const check=[...packet]; check[4]=check[5]=0;
  assert.equal(b.readUInt16LE(4),crc16Xmodem(check));
  const slots=[];
  let at=6;
  for(let i=0;i<5;i++) {
    const flags=b[at],status=b[at+1],textLength=b[at+2],width=b[at+3],height=b[at+4];
    assert.ok(b[at+5]===0 || b[at+5]===1);
    const pixelBytes=b.readUInt16LE(at+14);
    const slot={flags,status,textLength,width,height,displayKind:b[at+5],confirmedAt:b.readUInt32LE(at+6),
      validUntil:b.readUInt32LE(at+10),pixelBytes,timestamp:b.readUInt32LE(at+16)};
    const unitLength=b[at+22],labelLength=b[at+23];
    slot.semantic={kind:b[at+20],flags:b[at+21],source:b[at+24],value:b.readDoubleLE(at+28),min:b.readDoubleLE(at+36),max:b.readDoubleLE(at+44)};
    at+=52;
    slot.text=b.subarray(at,at+textLength).toString('utf8'); at+=textLength;
    slot.semantic.unit=b.subarray(at,at+unitLength).toString('utf8');at+=unitLength;
    slot.semantic.label=b.subarray(at,at+labelLength).toString('utf8');at+=labelLength;
    if(flags&2) {
      slot.palette=[...b.subarray(at,at+16)];at+=16;
      slot.pixels=[...b.subarray(at,at+pixelBytes)];at+=pixelBytes;
    }
    slots.push(slot);
  }
  assert.equal(at,b.length,'five record boundaries consume exactly the declared packet');
  return slots;
}

test('CRC16/XMODEM matches the published 123456789 check vector',()=>{
  assert.equal(crc16Xmodem([...Buffer.from('123456789')]),0x31C3);
  assert.equal(crc16Xmodem([]),0);
});

test('Five implicit slots preserve holes and non-ready statuses without retaining payloads',()=>{
  const inputs=[];
  inputs[0]={status:1,text:'private old text',confirmedAt:NOW,validUntil:NOW+60};
  inputs[2]=ready({text:'0%'});
  inputs[4]={status:6,text:'disabled secret',bitmap:{width:24,height:24},timestamp:123};
  inputs[5]=ready({text:'ignored sixth slot'});
  const packet=packComplications(inputs,NOW);
  const slots=decode(packet);
  assert.deepEqual(slots.map(s=>s.status),[1,0,2,0,6]);
  assert.equal(slots[2].text,'0%');
  for(const i of [0,1,3,4]) {
    assert.equal(slots[i].flags,0);
    for(const key of ['textLength','width','height','confirmedAt','validUntil','pixelBytes','timestamp']) assert.equal(slots[i][key],0);
  }
  assert.ok(!Buffer.from(packet).toString().includes('secret'));
  assert.equal(packComplications(null,NOW).length,266);
});

test('READY timing is exclusive, bounded to two hours, and never wraps unsigned timestamps',()=>{
  assert.equal(decode(packComplications([ready({text:'fresh',validUntil:NOW+1})],NOW))[0].status,2);
  for(const slot of [ready({text:'expired',validUntil:NOW}),ready({text:'old',confirmedAt:NOW-7200,validUntil:NOW+100}),
    ready({text:'future',confirmedAt:NOW+1}),ready({text:'bad',confirmedAt:0}),ready({text:'bad',validUntil:4294967296})]) {
    const decoded=decode(packComplications([slot],NOW))[0];
    assert.equal(decoded.status,3);
    assert.equal(decoded.flags,0);
    assert.equal(decoded.confirmedAt,0);
  }
  const capped=decode(packComplications([ready({text:'bounded',validUntil:NOW+86400})],NOW))[0];
  assert.equal(capped.validUntil,NOW-60+7200);
  const last=decode(packComplications([{status:2,text:'last',confirmedAt:4294967294,validUntil:4294967295}],4294967294))[0];
  assert.equal(last.validUntil,4294967295);
  for(const now of [0,-1,NaN,Infinity,'1791893700',NOW+.5,4294967296]) {
    assert.equal(decode(packComplications([ready({text:'bad clock'})],now))[0].status,3);
  }
});

test('Text takes precedence over event timestamps; zero is unavailable and future events remain representable',()=>{
  const slots=decode(packComplications([
    ready({text:'Meeting',timestamp:NOW+600}),ready({text:'\n\t',timestamp:0}),
    ready({timestamp:4294967295}),ready({timestamp:-1}),ready({status:'READY',text:'bad status'})
  ],NOW));
  assert.equal(slots[0].flags,1);
  assert.equal(slots[0].timestamp,0);
  assert.equal(slots[0].text,'Meeting');
  assert.equal(slots[1].status,3);
  assert.equal(slots[1].flags,0);
  assert.equal(slots[1].timestamp,0);
  assert.equal(slots[2].timestamp,4294967295);
  assert.equal(slots[3].status,5);
  assert.equal(slots[4].status,5);
});

test('A zero event is cleared without invalidating independent text or other ready slots',()=>{
  const slots=decode(packComplications([
    ready({timestamp:0}),ready({text:'still visible',timestamp:0}),ready({timestamp:NOW+600})
  ],NOW));
  assert.equal(slots[0].status,3);
  assert.equal(slots[0].flags,0);
  assert.equal(slots[0].timestamp,0);
  assert.equal(slots[1].status,2);
  assert.equal(slots[1].flags,1);
  assert.equal(slots[1].text,'still visible');
  assert.equal(slots[2].status,2);
  assert.equal(slots[2].flags,8);
  assert.equal(slots[2].timestamp,NOW+600);
});

const legacyText = value => normalizeText(value,48);
test('Text normalization preserves UTF8 scalars, repairs surrogates and removes native-invalid controls',()=>{
  assert.equal(legacyText('  A\n\tB\u0000\u007f\u0085\u2028\u2029C  '),'A B C');
  assert.equal(legacyText('\uD800X\uDC00'),'\uFFFDX\uFFFD');
  assert.equal(legacyText('界'.repeat(17)),'界'.repeat(15)+'…');
  assert.equal(legacyText('😀'.repeat(13)),'😀'.repeat(11)+'…');
  assert.equal(legacyText('a'.repeat(47)+'😀'),'a'.repeat(45)+'…');
  assert.equal(legacyText(null),'');
  assert.equal(legacyText(0),'');
  const slot=decode(packComplications([ready({text:'界'.repeat(43)})],NOW))[0];
  assert.equal(slot.textLength,126);
  assert.equal(slot.text,'界'.repeat(41)+'…');
  assert.equal(slot.text.includes('\uFFFD'),false);
});

test('Overlong text reserves a true ellipsis and remains stable when normalized for replay',()=>{
  for(const source of ['a'.repeat(49),'界'.repeat(17),'😀'.repeat(13),'a'.repeat(44)+' bcde']) {
    const bounded=legacyText(source);
    assert.ok(bounded.endsWith('…'));
    assert.ok(Buffer.byteLength(bounded,'utf8')<=48);
    assert.equal(legacyText(bounded),bounded,'persisted bounded text must not gain another ellipsis');
    assert.equal(bounded.includes(' …'),false,'do not retain an incomplete trailing word separator');
  }
  assert.equal(legacyText('a'.repeat(48)),'a'.repeat(48));
  assert.equal(legacyText('a'.repeat(48)+' \n\t'),'a'.repeat(48));
  assert.equal(legacyText('界'.repeat(16)),'界'.repeat(16));
  assert.equal(legacyText('a'.repeat(45)+'…'),'a'.repeat(45)+'…');
});

test('Bitmap geometry uses padded4bpp rows and pads a valid short palette to16 bytes',()=>{
  const bitmap={width:9,height:2,palette:[0,192],pixels:new Uint8Array(16).fill(0x10),image:true};
  const slot=decode(packComplications([ready({text:'42',bitmap})],NOW))[0];
  assert.equal(slot.flags,1|2|4);
  assert.equal(slot.width,9);
  assert.equal(slot.height,2);
  assert.equal(slot.pixelBytes,16);
  assert.deepEqual(slot.palette,[0,192,...Array(14).fill(0)]);
  assert.deepEqual(slot.pixels,Array(16).fill(0x10));
  const timestamp=decode(packComplications([ready({timestamp:NOW,bitmap:{...bitmap,image:false}})],NOW))[0];
  assert.equal(timestamp.flags,8|2);
  assert.equal(timestamp.timestamp,NOW);
});

test('Invalid bitmap geometry/pixels are omitted while independent text remains usable',()=>{
  const good={width:1,height:1,palette:[0,192],pixels:[0x10,0,0,0]};
  for(const bitmap of [{...good,width:0},{...good,width:41},{...good,height:1.5},{...good,height:41},
    {...good,palette:[]},{...good,palette:Array(17).fill(0)},{...good,palette:[0,256]},
    {...good,pixels:[0x10]},{...good,pixels:[0x10,0,NaN,0]},{...good,pixels:[0x10,0,-1,0]}]) {
    const slots=decode(packComplications([ready({text:'valid',bitmap}),ready({bitmap})],NOW));
    assert.equal(slots[0].flags,1);
    assert.equal(slots[0].pixelBytes,0);
    assert.equal(slots[1].status,5);
  }
});

test('Visible bitmap indices use the original palette while unused row padding is ignored',()=>{
  const single={width:1,height:2,palette:[192],pixels:[0x0F,255,255,255,0x0E,254,254,254]};
  const slots=decode(packComplications([
    ready({bitmap:single}),
    ready({bitmap:{...single,pixels:[0x10,0,0,0,0,0,0,0]}}),
    ready({bitmap:{width:2,height:1,palette:[0,192],pixels:[0x12,0,0,0]}}),
    ready({bitmap:{width:9,height:2,palette:[0,192],pixels:[0x10,0x10,0x10,0x10,0x1F,255,255,255,
      0x10,0x10,0x10,0x10,0x0F,255,255,255]}})
  ],NOW));
  assert.equal(slots[0].flags,2);
  assert.deepEqual(slots[0].palette,[192,...Array(15).fill(0)]);
  assert.deepEqual(slots[0].pixels,single.pixels);
  assert.equal(slots[1].status,5,'high nibble is a visible out-of-range index');
  assert.equal(slots[2].status,5,'low nibble of an even-width row is visible');
  assert.equal(slots[3].status,2,'odd-row low nibbles and row padding are not visible');
});

test('Five maximum records fit5186 bytes without truncation, overflow or input mutation',()=>{
  const bitmap={width:40,height:40,palette:Array.from({length:16},(_,i)=>i),pixels:Array(800).fill(0x21),image:true};
  const inputs=Array.from({length:5},()=>ready({text:'x'.repeat(128),bitmap,semantic:{kind:1,source:1,value:12.25,min:-20,max:40,unit:'u'.repeat(16),label:'l'.repeat(24)},unknown:'never encoded'}));
  const before=JSON.stringify(inputs);
  const packet=packComplications(inputs,NOW);
  assert.equal(packet.length,5186);
  const slots=decode(packet);
  assert.ok(slots.every(slot=>slot.textLength===128&&slot.pixelBytes===800&&slot.flags===7));
  assert.equal(JSON.stringify(inputs),before);
  assert.equal(Buffer.from(packet).toString().includes('never encoded'),false);
});

test('Invalid statuses clear all fields and do not borrow neighboring content',()=>{
  const slots=decode(packComplications([ready({status:99,text:'one'}),ready({status:NaN,text:'two'}),
    ready({status:4,text:'denied'}),[],ready({text:'five'})],NOW));
  assert.deepEqual(slots.map(slot=>slot.status),[5,5,4,5,2]);
  assert.deepEqual(slots.map(slot=>slot.text),['','','','','five']);
});

test('V2 semantic hint is explicit and never appears on generic percentages or non-text records',()=>{
  const slots=decode(packComplications([ready({text:'40%',displayKind:1}),ready({text:'78%'}),
    ready({text:'0%',displayKind:999}),ready({timestamp:NOW+600,displayKind:1}),
    {status:4,text:'private',displayKind:1}],NOW));
  assert.deepEqual(slots.map(slot=>slot.displayKind),[1,0,0,0,0]);
  assert.deepEqual(slots.map(slot=>slot.text),['40%','78%','0%','','']);
});

test('V3 preserves128-byte international music and explicit numeric semantics without rewriting formatted text',()=>{
  const text='Колесом / '.repeat(12);
  const input=ready({text,semantic:{kind:1,source:1,value:12.125,min:-20.25,max:40.5,unit:'°C',label:'Teplota'}});
  const slot=decode(packComplications([input],NOW))[0];
  assert.ok(slot.textLength>48&&slot.textLength<=128);
  assert.equal(slot.text,normalizeText(text));
  assert.deepEqual(slot.semantic,{kind:1,flags:7,source:1,value:12.125,min:-20.25,max:40.5,unit:'°C',label:'Teplota'});
  assert.equal(normalizeText('x'.repeat(128)),'x'.repeat(128));
  assert.equal(normalizeText('x'.repeat(129)),'x'.repeat(125)+'…');
  const metadataBefore=JSON.stringify(input.semantic);
  packComplications([input],NOW);
  assert.equal(JSON.stringify(input.semantic),metadataBefore);
});

test('Invalid optional semantic values cannot corrupt otherwise usable provider text',()=>{
  for(const semantic of [{kind:12},{source:6},{value:Infinity},{value:NaN},{min:2,max:1},
    {unit:'untruthfully long unit'},{unit:7},{label:{}},{value:'12'},{kind:'temperature'}]) {
    const slot=decode(packComplications([ready({text:'Provider 12.3 °C',semantic})],NOW))[0];
    assert.equal(slot.text,'Provider 12.3 °C');assert.equal(slot.status,2);
    assert.equal(slot.semantic.kind,0);assert.equal(slot.semantic.flags,0);
    assert.equal(slot.semantic.unit,'');assert.equal(slot.semantic.label,'');
  }
  const slot=decode(packComplications([ready({text:'1',semantic:{value:1e300,min:-1e300,max:1e300,label:'界'.repeat(20)}})],NOW))[0];
  assert.equal(slot.semantic.value,1e300);assert.equal(slot.semantic.min,-1e300);
  assert.ok(Buffer.byteLength(slot.semantic.label)<=24);assert.ok(slot.semantic.label.endsWith('…'));
});
