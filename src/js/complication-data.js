'use strict';

var VERSION = 2;
var SLOT_COUNT = 5;
var TEXT = 1;
var BITMAP = 2;
var IMAGE = 4;
var TIMESTAMP = 8;
var EMPTY = 0;
var READY = 2;
var UNAVAILABLE = 3;
var UNSUPPORTED = 5;
var MAX_EPOCH = 4294967295;
var MAX_AGE = 7200;
var MAX_TEXT_BYTES = 48;

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
function normalizeText(value) {
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
    if (count + length > MAX_TEXT_BYTES) { return ellipsisPrefix + '\u2026'; }
    result += (pendingSpace ? ' ' : '') + scalarText(code);
    count += length;
    pendingSpace = false;
    if (count <= MAX_TEXT_BYTES - 3) { ellipsisPrefix = result; }
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
function statusRecord(status) {
  var result = [];
  for (var i = 0; i < 20; i++) { result.push(0); }
  result[1] = status;
  return result;
}
function bitmapOf(value) {
  if (!object(value) || !integer(value.width, 1, 24) || !integer(value.height, 1, 24) ||
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
function record(slot, nowSec) {
  if (slot === undefined || slot === null) { return statusRecord(EMPTY); }
  if (!object(slot) || !integer(slot.status, 0, 6)) { return statusRecord(UNSUPPORTED); }
  if (slot.status !== READY) { return statusRecord(slot.status); }
  if (!integer(nowSec, 1, MAX_EPOCH) || !integer(slot.confirmedAt, 1, MAX_EPOCH) ||
      !integer(slot.validUntil, 1, MAX_EPOCH) || slot.confirmedAt > nowSec) { return statusRecord(UNAVAILABLE); }
  var until = Math.min(slot.validUntil, slot.confirmedAt + MAX_AGE, MAX_EPOCH);
  if (nowSec >= until) { return statusRecord(UNAVAILABLE); }
  var text = utf8(normalizeText(slot.text));
  var event = !text.length && integer(slot.timestamp, 1, MAX_EPOCH) ? slot.timestamp : null;
  var bitmap = bitmapOf(slot.bitmap);
  var flags = (text.length ? TEXT : event !== null ? TIMESTAMP : 0) |
    (bitmap ? BITMAP | (bitmap.image ? IMAGE : 0) : 0);
  if (!flags) { return statusRecord(slot.timestamp === 0 ? UNAVAILABLE : UNSUPPORTED); }
  var out = statusRecord(READY);
  out[0] = flags;
  out[2] = text.length;
  out[3] = bitmap ? bitmap.width : 0;
  out[4] = bitmap ? bitmap.height : 0;
  // V2 uses the former reserved byte for a provider-aware presentation hint.
  // Generic percentages (battery, humidity) never acquire precipitation art.
  out[5] = slot.displayKind === 1 && text.length ? 1 : 0;
  u32(out, 6, slot.confirmedAt);
  u32(out, 10, until);
  u16(out, 14, bitmap ? bitmap.pixels.length : 0);
  if (event !== null) { u32(out, 16, event); }
  out = out.concat(text);
  if (bitmap) { out = out.concat(bitmap.palette, bitmap.pixels); }
  return out;
}

/** Five fixed slots, including holes. No fetching, cache mutation or inference. */
function packComplications(slots, nowSec) {
  var out = [VERSION, 0, 0, 0, 0, 0];
  var values = Array.isArray(slots) ? slots : [];
  for (var i = 0; i < SLOT_COUNT; i++) { out = out.concat(record(values[i], nowSec)); }
  u16(out, 2, out.length);
  // CRC bytes stay zero while calculating the checksum over the whole packet.
  u16(out, 4, crc16Xmodem(out));
  return out;
}

module.exports = {packComplications:packComplications, normalizeText:normalizeText, crc16Xmodem:crc16Xmodem};
