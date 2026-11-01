'use strict';

var VERSION = 4;
var HEADER_BYTES = 56;
var SEMANTIC_KIND = {GENERIC:0,TEMPERATURE:1,PRECIPITATION:2,BATTERY:3,HUMIDITY:4,WIND:5,UV:6,CONDITION:7,RANGE:8,NUMBER:9,BOOLEAN:10,TIMESTAMP:11};
var SOURCE_KIND = {GENERIC:0,WEATHER:1,PHONE:2,MUSIC:3,NOTIFICATION:4,OTHER:5};
var DETAIL_KIND = {NONE:0,TEMPERATURE:1,FEELS_LIKE:2,HIGH:3,LOW:4,PRECIPITATION:5,HUMIDITY:6,WIND_SPEED:7,WIND_DIRECTION:8,UV:9,CONDITION:10,PHONE_BATTERY:11};
var QUALIFIERS = {FORECAST:1};
var DETAIL_SEMANTIC = [0,1,1,1,1,2,4,5,5,6,7,3];
var SLOT_COUNT = 5;
var TEXT = 1;
var BITMAP = 2;
var IMAGE = 4;
var TIMESTAMP = 8;
var EMPTY = 0;
var READY = 2;
var UNAVAILABLE = 3;
var UNSUPPORTED = 5;
var EXPIRED = 7;
var MAX_EPOCH = 4294967295;
var MAX_AGE = 7200;
var MAX_TEXT_BYTES = 128;

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function integer(value, minimum, maximum) {
  return typeof value === 'number' && isFinite(value) && value >= minimum &&
    value <= maximum && Math.floor(value) === value;
}
function bytes(value) {
  return Array.isArray(value) || Object.prototype.toString.call(value) === '[object Uint8Array]';
}
function byteArray(value, length) {
  if (!bytes(value) || value.length !== length) { return false; }
  for (var i = 0; i < length; i++) { if (!integer(value[i], 0, 255)) { return false; } }
  return true;
}
function scalar(text, at) {
  var first = text.charCodeAt(at);
  if (first >= 0xD800 && first <= 0xDBFF) {
    var second = text.charCodeAt(at + 1);
    if (second >= 0xDC00 && second <= 0xDFFF) {
      return {value:0x10000 + (first - 0xD800) * 1024 + second - 0xDC00, length:2};
    }
    return {value:0xFFFD, length:1};
  }
  return {value:first >= 0xDC00 && first <= 0xDFFF ? 0xFFFD : first, length:1};
}
function scalarText(value) {
  if (value <= 0xFFFF) { return String.fromCharCode(value); }
  value -= 0x10000;
  return String.fromCharCode(0xD800 + Math.floor(value / 1024), 0xDC00 + value % 1024);
}
function utf8Length(value) { return value < 0x80 ? 1 : value < 0x800 ? 2 : value < 0x10000 ? 3 : 4; }

// The native decoder rejects control characters. Keep ordinary word boundaries
// when sanitizing them, repair orphan surrogates and truncate only whole UTF-8
// scalars, reserving an ellipsis when content exceeds the byte limit. The
// bounded returned string is also suitable for coordinator storage and replay.
function normalizeText(value, maxBytes) {
  maxBytes = integer(maxBytes, 3, MAX_TEXT_BYTES) ? maxBytes : MAX_TEXT_BYTES;
  if (typeof value !== 'string') { return ''; }
  var result = '';
  var ellipsisPrefix = '';
  var count = 0;
  var pendingSpace = false;
  for (var i = 0; i < value.length;) {
    var next = scalar(value, i);
    i += next.length;
    var code = next.value;
    if (code < 0x20 || (code >= 0x7F && code <= 0x9F) || code === 0x2028 || code === 0x2029) { code = 0x20; }
    // Defer spaces until another scalar arrives: trailing controls or spaces
    // alone do not make an otherwise fitting string require an ellipsis.
    if (code === 0x20) { pendingSpace = result.length > 0; continue; }
    var length = utf8Length(code) + (pendingSpace ? 1 : 0);
    if (count + length > maxBytes) { return ellipsisPrefix + '\u2026'; }
    result += (pendingSpace ? ' ' : '') + scalarText(code);
    count += length;
    pendingSpace = false;
    if (count <= maxBytes - 3) { ellipsisPrefix = result; }
  }
  return result;
}
function utf8(text) {
  var out = [];
  for (var i = 0; i < text.length;) {
    var next = scalar(text, i);
    var code = next.value;
    i += next.length;
    if (code < 0x80) { out.push(code); }
    else if (code < 0x800) { out.push(0xC0 | (code >> 6), 0x80 | (code & 63)); }
    else if (code < 0x10000) { out.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63)); }
    else { out.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63)); }
  }
  return out;
}
function u16(out, at, value) { out[at] = value & 255; out[at + 1] = Math.floor(value / 256) & 255; }
function u32(out, at, value) {
  for (var i = 0; i < 4; i++) { out[at + i] = Math.floor(value / Math.pow(256, i)) % 256; }
}
function crc16Xmodem(value) {
  var crc = 0;
  for (var i = 0; i < value.length; i++) {
    crc ^= value[i] << 8;
    for (var bit = 0; bit < 8; bit++) { crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xFFFF; }
  }
  return crc;
}
function statusRecord(status, headerBytes) {
  headerBytes = headerBytes || HEADER_BYTES;
  var result = [];
  for (var i = 0; i < headerBytes; i++) { result.push(0); }
  result[1] = status;
  return result;
}
function bitmapOf(value, maxSize) {
  maxSize = maxSize || 40;
  if (!object(value) || !integer(value.width, 1, maxSize) || !integer(value.height, 1, maxSize) ||
      !bytes(value.palette) || !integer(value.palette.length, 1, 16)) { return null; }
  var stride = ((value.width + 7) >> 3) * 4;
  var count = stride * value.height;
  if (!byteArray(value.palette, value.palette.length) || !byteArray(value.pixels, count)) { return null; }
  // The original palette length matters before padding to the 16-byte wire
  // palette. Ignore row padding and the unused low nibble of odd-width rows.
  for (var y = 0; y < value.height; y++) {
    for (var x = 0; x < value.width; x++) {
      var pair = value.pixels[y * stride + (x >> 1)];
      var index = x & 1 ? pair & 15 : pair >> 4;
      if (index >= value.palette.length) { return null; }
    }
  }
  var palette = [];
  for (var i = 0; i < 16; i++) { palette.push(i < value.palette.length ? value.palette[i] : 0); }
  return {width:value.width, height:value.height, palette:palette,
    pixels:Array.prototype.slice.call(value.pixels), image:value.image === true};
}
function f64(out, at, value) {
  var buffer = new ArrayBuffer(8), view = new DataView(buffer);
  view.setFloat64(0, value, true);
  for (var i = 0; i < 8; ++i) { out[at + i] = view.getUint8(i); }
}
function semanticOf(slot, version, identityOnly) {
  var value = slot.semantic;
  if (!object(value)) { return null; }
  var kind = value.kind === undefined ? 0 : value.kind;
  var source = value.source === undefined ? 0 : value.source;
  if (!integer(kind, 0, 11) || !integer(source, 0, 5)) { return null; }
  var result = {kind:kind,source:source,flags:0,unit:[],label:[],detail:0,qualifiers:0,observedAt:0};
  if (version === 4) {
    var detail = value.detail === undefined ? 0 : value.detail;
    var qualifiers = value.qualifiers === undefined ? 0 : value.qualifiers;
    var observedAt = identityOnly || value.observedAt === undefined ? 0 : value.observedAt;
    if (!integer(detail,0,11) || detail && DETAIL_SEMANTIC[detail] !== kind &&
        !(detail === DETAIL_KIND.PRECIPITATION && (kind === SEMANTIC_KIND.GENERIC || kind === SEMANTIC_KIND.NUMBER)) ||
        !integer(qualifiers,0,1) || qualifiers && source !== SOURCE_KIND.WEATHER ||
        !integer(observedAt,0,MAX_EPOCH) || observedAt &&
          (observedAt > slot.confirmedAt || qualifiers & QUALIFIERS.FORECAST)) { return null; }
    result.detail=detail; result.qualifiers=qualifiers; result.observedAt=observedAt;
  }
  var fields = ['value','min','max'];
  for (var i = 0; i < fields.length; ++i) {
    if (!identityOnly && value[fields[i]] !== undefined) {
      var numeric = value[fields[i]];
      if (typeof numeric !== 'number' || !isFinite(numeric)) { return null; }
      result[fields[i]] = numeric; result.flags |= 1 << i;
    }
  }
  if ((result.flags & 6) === 6 && result.min > result.max) { return null; }
  if (value.unit !== undefined) {
    if (typeof value.unit !== 'string') { return null; }
    result.unit = utf8(normalizeText(value.unit));
    // A shortened unit could change its meaning. Omit invalid optional metadata.
    if (result.unit.length > 16) { return null; }
  }
  if (value.label !== undefined) {
    if (typeof value.label !== 'string') { return null; }
    result.label = utf8(normalizeText(value.label,24));
  }
  return result;
}

function unavailableRecord(slot,status,version,header) {
  if (version !== 4 || status === EMPTY) { return statusRecord(status === EXPIRED ? UNAVAILABLE : status,header); }
  var metadata=semanticOf(slot,version,true), out=statusRecord(status,header);
  // Identity may survive a public source failure, but private source names,
  // old content, numbers and observation times never survive this path.
  if (!metadata || metadata.source === SOURCE_KIND.MUSIC || metadata.source === SOURCE_KIND.NOTIFICATION) { return out; }
  out[20]=metadata.kind; out[22]=metadata.unit.length; out[23]=metadata.label.length;
  out[24]=metadata.source; out[25]=metadata.detail; out[26]=metadata.qualifiers;
  return out.concat(metadata.unit,metadata.label);
}
function record(slot, nowSec, version) {
  var header = version === 4 ? HEADER_BYTES : version === 3 ? 52 : 20;
  if (slot === undefined || slot === null) { return statusRecord(EMPTY,header); }
  if (!object(slot) || !integer(slot.status, 0, 7)) { return statusRecord(UNSUPPORTED,header); }
  if (slot.status !== READY) { return unavailableRecord(slot,slot.status,version,header); }
  if (!integer(nowSec, 1, MAX_EPOCH) || !integer(slot.confirmedAt, 1, MAX_EPOCH) ||
      !integer(slot.validUntil, 1, MAX_EPOCH) || slot.confirmedAt > nowSec) { return statusRecord(UNAVAILABLE,header); }
  var until = Math.min(slot.validUntil, slot.confirmedAt + MAX_AGE, MAX_EPOCH);
  if (nowSec >= until) { return unavailableRecord(slot,version === 4 ? EXPIRED : UNAVAILABLE,version,header); }
  var text = utf8(normalizeText(slot.text,version >= 3 ? 128 : 48));
  var event = !text.length && integer(slot.timestamp, 1, MAX_EPOCH) ? slot.timestamp : null;
  var bitmap = bitmapOf(slot.bitmap,version >= 3 ? 40 : 24);
  var flags = (text.length ? TEXT : event !== null ? TIMESTAMP : 0) |
    (bitmap ? BITMAP | (bitmap.image ? IMAGE : 0) : 0);
  if (!flags) { return statusRecord(slot.timestamp === 0 ? UNAVAILABLE : UNSUPPORTED,header); }
  var out = statusRecord(READY,header);
  out[0] = flags;
  out[2] = text.length;
  out[3] = bitmap ? bitmap.width : 0;
  out[4] = bitmap ? bitmap.height : 0;
  // V2 uses the former reserved byte for a provider-aware presentation hint.
  // Generic percentages (battery, humidity) never acquire precipitation art.
  out[5] = version !== 1 && slot.displayKind === 1 && text.length ? 1 : 0;
  u32(out, 6, slot.confirmedAt);
  u32(out, 10, until);
  u16(out, 14, bitmap ? bitmap.pixels.length : 0);
  if (event !== null) { u32(out, 16, event); }
  var semantic = version >= 3 ? semanticOf(slot,version,false) : null;
  if (semantic) {
    out[20] = semantic.kind; out[21] = semantic.flags;
    out[22] = semantic.unit.length; out[23] = semantic.label.length; out[24] = semantic.source;
    if (version === 4) {
      out[25]=semantic.detail; out[26]=semantic.qualifiers; u32(out,52,semantic.observedAt);
    }
    if (semantic.flags & 1) { f64(out,28,semantic.value); }
    if (semantic.flags & 2) { f64(out,36,semantic.min); }
    if (semantic.flags & 4) { f64(out,44,semantic.max); }
  }
  out = out.concat(text,semantic ? semantic.unit : [],semantic ? semantic.label : []);
  if (bitmap) { out = out.concat(bitmap.palette, bitmap.pixels); }
  return out;
}

/** Five fixed slots, including holes. No fetching, cache mutation or inference. */
function packComplications(slots, nowSec, version) {
  version = version === 1 || version === 2 || version === 3 ? version : VERSION;
  var out = [version, 0, 0, 0, 0, 0];
  var values = Array.isArray(slots) ? slots : [];
  for (var i = 0; i < SLOT_COUNT; i++) { out = out.concat(record(values[i], nowSec,version)); }
  u16(out, 2, out.length);
  // CRC bytes stay zero while calculating the checksum over the whole packet.
  u16(out, 4, crc16Xmodem(out));
  return out;
}

module.exports = {packComplications:packComplications, normalizeText:normalizeText, crc16Xmodem:crc16Xmodem, SEMANTIC_KIND:SEMANTIC_KIND, SOURCE_KIND:SOURCE_KIND, DETAIL_KIND:DETAIL_KIND, QUALIFIERS:QUALIFIERS};
