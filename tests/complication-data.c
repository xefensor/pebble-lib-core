#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include "../include/complication_data.h"

static const uint32_t NOW = 1793433600;

typedef struct {
  uint8_t bytes[COMPLICATION_MAX_BYTES + 32];
  size_t length;
  size_t records[COMPLICATION_SLOT_COUNT];
  unsigned count;
} Packet;

static void put16(uint8_t *bytes, uint16_t value) {
  bytes[0] = (uint8_t)value;
  bytes[1] = (uint8_t)(value >> 8);
}

static void put32(uint8_t *bytes, uint32_t value) {
  for (unsigned i = 0; i < 4; ++i) { bytes[i] = (uint8_t)(value >> (i * 8)); }
}

// Independent bit-stream reference, including the wire's zeroed CRC field.
static uint16_t reference_crc(const uint8_t *bytes, size_t length) {
  uint32_t state = 0;
  for (size_t i = 0; i < length; ++i) {
    const unsigned byte = i == 4 || i == 5 ? 0 : bytes[i];
    for (int bit = 7; bit >= 0; --bit) {
      const unsigned feedback = ((state >> 15) ^ (byte >> bit)) & 1;
      state = (state << 1) & 0xffff;
      if (feedback) { state ^= 0x1021; }
    }
  }
  return (uint16_t)state;
}

static void init(Packet *packet) {
  memset(packet, 0, sizeof(*packet));
  packet->bytes[0] = 1;
  packet->length = COMPLICATION_HEADER_BYTES;
}

static void add(Packet *packet, uint8_t flags, uint8_t status,
                const void *text, size_t text_length, uint8_t width,
                uint8_t height, uint32_t timestamp) {
  assert(packet->count < COMPLICATION_SLOT_COUNT);
  const size_t at = packet->length;
  packet->records[packet->count++] = at;
  const uint16_t pixels = flags & COMPLICATION_FLAG_BITMAP
      ? ((width + 7) >> 3) * 4 * height : 0;
  const size_t payload = text_length + (flags & COMPLICATION_FLAG_BITMAP ? 16 + pixels : 0);
  assert(at + 20 + payload <= sizeof(packet->bytes));
  uint8_t *record = packet->bytes + at;
  record[0] = flags;
  record[1] = status;
  record[2] = text_length;
  record[3] = width;
  record[4] = height;
  if (status == COMPLICATION_STATUS_READY) {
    put32(record + 6, NOW);
    put32(record + 10, NOW + 7200);
  }
  put16(record + 14, pixels);
  put32(record + 16, timestamp);
  if (text_length) { memcpy(record + 20, text, text_length); }
  if (flags & COMPLICATION_FLAG_BITMAP) {
    for (unsigned i = 0; i < 16; ++i) { record[20 + text_length + i] = (uint8_t)(0xc0 ^ (i * 17)); }
    for (unsigned i = 0; i < pixels; ++i) { record[36 + text_length + i] = (uint8_t)(i + 0x12); }
  }
  packet->length += 20 + payload;
}

static void finish(Packet *packet) {
  while (packet->count < COMPLICATION_SLOT_COUNT) {
    add(packet, 0, COMPLICATION_STATUS_EMPTY, NULL, 0, 0, 0, 0);
  }
  put16(packet->bytes + 2, packet->length);
  put16(packet->bytes + 4, reference_crc(packet->bytes, packet->length));
}

static void reseal(Packet *packet) {
  put16(packet->bytes + 4, reference_crc(packet->bytes, packet->length));
}

static void text_packet(Packet *packet, const void *text, size_t length) {
  init(packet);
  add(packet, COMPLICATION_FLAG_TEXT, COMPLICATION_STATUS_READY, text, length, 0, 0, 0);
  finish(packet);
}

static void assert_bad(const Packet *packet) {
  ComplicationSet destination;
  ComplicationSet original;
  memset(&destination, 0xa5, sizeof(destination));
  memcpy(&original, &destination, sizeof(original));
  assert(!complications_read(packet->bytes, packet->length, &destination));
  assert(memcmp(&destination, &original, sizeof(destination)) == 0);
  assert(!complications_read(packet->bytes, packet->length, NULL));
}

static unsigned hex_digit(char value) {
  return value >= '0' && value <= '9' ? (unsigned)(value - '0') : (unsigned)(value - 'a' + 10);
}

int main(void) {
  Packet packet;
  Packet changed;
  ComplicationSet result;

  // Golden snapshot emitted by the independent PKJS encoder. This anchors
  // flags/status values, every LE offset, palette order, stride and CRC.
  const char *golden =
      "01008300417d0102050000008820ce6a7425ce6a0000000000003230c2b0"
      "430000000000000000000000000000000000000000000400000000000000"
      "00000000000000000000000802000000008820ce6a7425ce6a00001c23ce"
      "6a0202000101008820ce6a7425ce6a04000000000000c000000000000000"
      "0000000000000010000000";
  init(&packet);
  packet.length = strlen(golden) / 2;
  for (size_t i = 0; i < packet.length; ++i) {
    packet.bytes[i] = (uint8_t)((hex_digit(golden[i * 2]) << 4) | hex_digit(golden[i * 2 + 1]));
  }
  assert(packet.length == 131 && complications_crc16(packet.bytes, packet.length) == 0x7d41);
  assert(complications_read(packet.bytes, packet.length, &result));
  assert(strcmp(result.slots[0].text, "20°C") == 0);
  assert(result.slots[0].confirmed_at == 1791893640 && result.slots[0].valid_until == 1791894900);
  assert(result.slots[1].status == COMPLICATION_STATUS_EMPTY);
  assert(result.slots[2].status == COMPLICATION_STATUS_DENIED);
  assert(result.slots[3].timestamp == 1791894300 && result.slots[3].text[0] == '\0');
  assert(result.slots[4].width == 1 && result.slots[4].height == 1 && result.slots[4].stride == 4);
  assert(result.slots[4].pixel_bytes == 4 && result.slots[4].bitmap[0] == 0x10);
  assert(result.slots[4].palette[0] == 0 && result.slots[4].palette[1] == 0xc0 &&
         result.slots[4].palette[2] == 0);

  // All five IDs preserve independent source text, including zero, native F,
  // Unicode case/units, icons, images and a timestamp without an invented label.
  init(&packet);
  add(&packet, COMPLICATION_FLAG_TEXT, COMPLICATION_STATUS_READY, "0°C", strlen("0°C"), 0, 0, 0);
  add(&packet, COMPLICATION_FLAG_TEXT, COMPLICATION_STATUS_READY, "32°F", strlen("32°F"), 0, 0, 0);
  add(&packet, COMPLICATION_FLAG_TEXT | COMPLICATION_FLAG_BITMAP, COMPLICATION_STATUS_READY,
      "České", strlen("České"), 9, 2, 0);
  add(&packet, COMPLICATION_FLAG_BITMAP | COMPLICATION_FLAG_IMAGE, COMPLICATION_STATUS_READY,
      NULL, 0, 24, 24, 0);
  add(&packet, COMPLICATION_FLAG_TIMESTAMP, COMPLICATION_STATUS_READY, NULL, 0, 0, 0, NOW + 600);
  finish(&packet);
  assert(complications_read(packet.bytes, packet.length, &result));
  assert(complications_read(packet.bytes, packet.length, NULL));
  assert(strcmp(result.slots[0].text, "0°C") == 0);
  assert(strcmp(result.slots[1].text, "32°F") == 0);
  assert(strcmp(result.slots[2].text, "České") == 0);
  assert(result.slots[2].text_length == strlen("České"));
  assert(result.slots[2].width == 9 && result.slots[2].height == 2 &&
         result.slots[2].stride == 8 && result.slots[2].pixel_bytes == 16);
  assert(result.slots[2].bitmap[0] == 0x12 && result.slots[2].bitmap[15] == 0x21);
  assert(result.slots[2].bitmap[16] == 0 && result.slots[2].palette[0] == 0xc0);
  assert(result.slots[3].pixel_bytes == 288 && result.slots[3].stride == 12);
  assert(result.slots[3].flags == (COMPLICATION_FLAG_BITMAP | COMPLICATION_FLAG_IMAGE));
  assert(result.slots[4].timestamp == NOW + 600 && result.slots[4].text[0] == '\0');
  for (unsigned i = 0; i < 5; ++i) {
    assert(result.slots[i].confirmed_at == NOW && result.slots[i].valid_until == NOW + 7200);
    assert(complication_is_selected(&result.slots[i]));
    assert(complication_is_fresh(&result.slots[i], NOW));
  }

  // V2 retains the exact old record boundaries, with one presentation byte.
  // Legacy V1 cache packets remain readable, but cannot claim the new hint.
  Packet styled;
  text_packet(&styled, "40%", 3);
  styled.bytes[0] = 2;
  styled.bytes[styled.records[0] + 5] = COMPLICATION_DISPLAY_PRECIPITATION;
  reseal(&styled);
  assert(complications_read(styled.bytes, styled.length, &result));
  assert(strcmp(result.slots[0].text, "40%") == 0);
  assert(result.slots[0].display_kind == COMPLICATION_DISPLAY_PRECIPITATION);
  assert(result.slots[1].display_kind == COMPLICATION_DISPLAY_GENERIC);
  changed = styled;
  changed.bytes[0] = 1;
  reseal(&changed);
  assert_bad(&changed);
  changed = styled;
  changed.bytes[changed.records[0] + 5] = 2;
  reseal(&changed);
  assert_bad(&changed);
  changed = styled;
  changed.bytes[changed.records[1] + 5] = 1;
  reseal(&changed);
  assert_bad(&changed);
  init(&styled);
  styled.bytes[0] = 2;
  add(&styled, COMPLICATION_FLAG_TIMESTAMP, COMPLICATION_STATUS_READY, NULL, 0, 0, 0, NOW + 1);
  finish(&styled);
  styled.bytes[styled.records[0] + 5] = 1;
  reseal(&styled);
  assert_bad(&styled);

  // Every byte participates in the checksum; rewriting the CRC field itself
  // does not affect its computed value. Invalid last slots cannot partly copy.
  const uint16_t crc = complications_crc16(packet.bytes, packet.length);
  assert(crc == reference_crc(packet.bytes, packet.length));
  changed = packet;
  changed.bytes[4] ^= 0xff;
  assert(complications_crc16(changed.bytes, changed.length) == crc);
  assert_bad(&changed);
  changed = packet;
  changed.bytes[packet.records[3] + 36 + 287] ^= 1;
  assert_bad(&changed);
  changed = packet;
  changed.bytes[changed.records[4] + 1] = 7;
  reseal(&changed);
  assert_bad(&changed);

  // Full maximum packet: no off-by-one in text, padded bitmap rows or count.
  init(&packet);
  char text[49];
  memset(text, 'x', 48);
  text[48] = '\0';
  for (unsigned i = 0; i < 5; ++i) {
    add(&packet, 15, COMPLICATION_STATUS_READY, text, 48, 24, 24, UINT32_MAX);
  }
  finish(&packet);
  assert(packet.length == 1866);
  assert(complications_read(packet.bytes, packet.length, &result));
  assert(result.slots[4].text[48] == '\0' && strlen(result.slots[4].text) == 48);
  assert(result.slots[4].bitmap[287] == (uint8_t)(287 + 0x12));
  assert(result.slots[4].timestamp == UINT32_MAX);
  changed = packet;
  changed.bytes[changed.records[4] + 2] = 49;
  reseal(&changed);
  assert_bad(&changed);
  assert(!complications_read(packet.bytes, COMPLICATION_MAX_BYTES + 1, &result));

  // Non-ready states carry their status only. EMPTY is hidden; every other
  // selected state stays at its own fixed ID and is not a fresh value.
  for (uint8_t status = 0; status <= 6; ++status) {
    if (status == COMPLICATION_STATUS_READY) { continue; }
    init(&packet);
    add(&packet, 0, status, NULL, 0, 0, 0, 0);
    finish(&packet);
    assert(packet.length == 106 && complications_read(packet.bytes, packet.length, &result));
    assert(result.slots[0].status == status && result.slots[0].flags == 0);
    assert(complication_is_selected(&result.slots[0]) == (status != COMPLICATION_STATUS_EMPTY));
    assert(!complication_is_fresh(&result.slots[0], NOW));
    assert(result.slots[1].status == COMPLICATION_STATUS_EMPTY);
    const unsigned forbidden_offsets[] = {0, 2, 3, 4, 5, 6, 10, 14, 16};
    for (unsigned i = 0; i < sizeof(forbidden_offsets) / sizeof(forbidden_offsets[0]); ++i) {
      changed = packet;
      changed.bytes[changed.records[0] + forbidden_offsets[i]] = 1;
      reseal(&changed);
      assert_bad(&changed);
    }
  }
  assert(!complication_is_selected(NULL));
  assert(!complication_is_fresh(NULL, NOW));

  // Exact envelope length, version, reserved bytes and exactly five records.
  init(&packet);
  finish(&packet);
  assert(!complications_read(NULL, packet.length, &result));
  assert(!complications_read(packet.bytes, 0, &result));
  assert(!complications_read(packet.bytes, 5, &result));
  changed = packet;
  changed.bytes[0] = 3;
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  changed.bytes[1] = 1;
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  put16(changed.bytes + 2, changed.length + 1);
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  changed.length -= 20;
  put16(changed.bytes + 2, changed.length);
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  changed.length += 20;
  put16(changed.bytes + 2, changed.length);
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  changed.bytes[changed.length++] = 0;
  put16(changed.bytes + 2, changed.length);
  reseal(&changed);
  assert_bad(&changed);

  // Text is printable, single-line UTF-8 rather than opaque or NUL-terminated
  // bytes. Valid multi-byte boundaries survive without normalization.
  const char *valid_text[] = {"0", "0%", "mW 0.0°C", "České Budějovice", "éééééééééééééééééééééééé",
    "\xc2\xa0", "\xdf\xbf", "\xe0\xa0\x80", "\xed\x9f\xbf", "\xee\x80\x80",
    "\xef\xbf\xbf", "\xf0\x90\x80\x80", "\xf4\x8f\xbf\xbf", "\xf0\x9f\x98\x80"};
  for (unsigned i = 0; i < sizeof(valid_text) / sizeof(valid_text[0]); ++i) {
    text_packet(&packet, valid_text[i], strlen(valid_text[i]));
    assert(complications_read(packet.bytes, packet.length, &result));
    assert(strcmp(result.slots[0].text, valid_text[i]) == 0);
  }
  const struct { const char *bytes; size_t length; } invalid_text[] = {
    {"\0", 1}, {"\n", 1}, {"\t", 1}, {"\x1f", 1}, {"\x7f", 1},
    {"\xc2\x80", 2}, {"\xc2\x9f", 2}, {"\xe2\x80\xa8", 3}, {"\xe2\x80\xa9", 3},
    {"\xc0\xaf", 2}, {"\xe0\x80\xaf", 3}, {"\xf0\x80\x80\xaf", 4},
    {"\xed\xa0\x80", 3}, {"\xf4\x90\x80\x80", 4}, {"\xf5\x80\x80\x80", 4},
    {"\x80", 1}, {"\xff", 1}, {"\xc2", 1}, {"\xe2\x82", 2}, {"\xf0\x9f\x98", 3},
    {"\xe2\x28\xa1", 3}, {"\xf0\x9f\x98\x41", 4}
  };
  for (unsigned i = 0; i < sizeof(invalid_text) / sizeof(invalid_text[0]); ++i) {
    text_packet(&packet, invalid_text[i].bytes, invalid_text[i].length);
    assert_bad(&packet);
  }
  memset(text, 'x', sizeof(text));
  text_packet(&packet, text, 49);
  assert_bad(&packet);

  // Value flags must agree with their lengths, dimensions and timestamp.
  text_packet(&packet, "ok", 2);
  const struct { unsigned offset; uint8_t value; } corruptions[] = {
    {0, 0}, {0, 16}, {0, COMPLICATION_FLAG_IMAGE}, {2, 0}, {3, 1}, {4, 1},
    {5, 1}, {14, 1}, {16, 1}, {1, 7}
  };
  for (unsigned i = 0; i < sizeof(corruptions) / sizeof(corruptions[0]); ++i) {
    changed = packet;
    changed.bytes[6 + corruptions[i].offset] = corruptions[i].value;
    reseal(&changed);
    assert_bad(&changed);
  }
  changed = packet;
  changed.bytes[6] |= COMPLICATION_FLAG_TIMESTAMP;
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  put32(changed.bytes + 6 + 6, 0);
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  put32(changed.bytes + 6 + 10, NOW);
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  put32(changed.bytes + 6 + 10, NOW + 7201);
  reseal(&changed);
  assert_bad(&changed);

  init(&packet);
  add(&packet, COMPLICATION_FLAG_BITMAP, COMPLICATION_STATUS_READY, NULL, 0, 9, 2, 0);
  finish(&packet);
  for (unsigned offset = 3; offset <= 4; ++offset) {
    for (unsigned width = 0; width <= 25; width += 25) {
      changed = packet;
      changed.bytes[6 + offset] = width;
      reseal(&changed);
      assert_bad(&changed);
    }
  }
  changed = packet;
  put16(changed.bytes + 6 + 14, 15); // 9px needs an 8-byte row, not a packed 5-byte row.
  reseal(&changed);
  assert_bad(&changed);
  changed = packet;
  changed.length--;
  put16(changed.bytes + 2, changed.length);
  reseal(&changed);
  assert_bad(&changed);

  // Decoding is structural: expired/future values keep their IDs. Freshness is
  // evaluated separately and never turns a repeated read into new data.
  text_packet(&packet, "0%", 2);
  assert(complications_read(packet.bytes, packet.length, &result));
  assert(complication_is_fresh(&result.slots[0], NOW + 7199));
  assert(!complication_is_fresh(&result.slots[0], NOW + 7200));
  assert(complication_is_selected(&result.slots[0]));
  assert(complications_read(packet.bytes, packet.length, &result));
  assert(result.slots[0].confirmed_at == NOW);
  assert(!complication_is_fresh(&result.slots[0], NOW + 7200));
  assert(!complication_is_fresh(&result.slots[0], 0));
  assert(!complication_is_fresh(&result.slots[0], (time_t)-1));
  assert(!complication_is_fresh(&result.slots[0], NOW - 301));
  assert(complication_is_fresh(&result.slots[0], NOW - 300));
  if (sizeof(time_t) > 4) {
    assert(!complication_is_fresh(&result.slots[0], (time_t)INT64_MAX));
  }
  put32(packet.bytes + 12, UINT32_MAX - 7200);
  put32(packet.bytes + 16, UINT32_MAX);
  reseal(&packet);
  assert(complications_read(packet.bytes, packet.length, &result));
  assert(complication_is_fresh(&result.slots[0], (time_t)(UINT32_MAX - 1)));
  assert(!complication_is_fresh(&result.slots[0], (time_t)UINT32_MAX));
  changed = packet;
  put32(changed.bytes + 12, UINT32_MAX - 7201);
  reseal(&changed);
  assert_bad(&changed);

  // Independent v3 JS golden fixtures exercise full metadata, float64,
  // 128-byte international text, 40px bitmap and the exact worst-case size.
  const char *v3files[] = {"complications-v3", "context-v3", "maximum-v3"};
  for (unsigned which = 0; which < 3; ++which) {
    char path[96]; snprintf(path, sizeof(path), "tests/fixtures/%s.bin", v3files[which]);
    FILE *file = fopen(path, "rb"); assert(file);
    packet.length = fread(packet.bytes, 1, sizeof(packet.bytes), file); fclose(file);
    assert(packet.bytes[0] == 3 && complications_read(packet.bytes, packet.length, &result));
    size_t at = 6;
    for (unsigned i = 0; i < 5; ++i) {
      packet.records[i] = at;
      const uint8_t *r = packet.bytes + at;
      at += 52 + r[2] + r[22] + r[23] + ((r[0] & 2) ? 16 + complications_u16(r+14) : 0);
    }
    assert(at == packet.length);
    if (which == 0) {
      assert(strcmp(result.slots[0].text, "5°C") == 0);
      assert(result.slots[0].semantic_kind == COMPLICATION_SEMANTIC_TEMPERATURE);
      assert(result.slots[0].source_kind == COMPLICATION_SOURCE_WEATHER);
      assert(result.slots[0].semantic_flags == 7);
      assert(result.slots[0].numeric_value == 5.125 && result.slots[0].minimum == -4.5 && result.slots[0].maximum == 12.25);
      assert(strcmp(result.slots[0].unit, "°C") == 0 && strcmp(result.slots[0].label, "Teplota") == 0);
      const unsigned bad_offsets[] = {20,21,22,23,24,25,26,27};
      const uint8_t bad_values[] = {12,8,17,25,6,1,1,1};
      for (unsigned j = 0; j < sizeof(bad_offsets)/sizeof(*bad_offsets); ++j) {
        changed=packet; changed.bytes[6+bad_offsets[j]]=bad_values[j]; reseal(&changed); assert_bad(&changed);
      }
      changed=packet; // Signaling/quiet NaN and infinity are never native values.
      memset(changed.bytes+6+28,0,8); changed.bytes[6+34]=0xf0; changed.bytes[6+35]=0x7f;
      reseal(&changed); assert_bad(&changed);
      changed.bytes[6+34]=0xf8; reseal(&changed); assert_bad(&changed);
      changed=packet; changed.bytes[6+21]=0; reseal(&changed); assert_bad(&changed); // hidden numeric bytes
      changed=packet; memcpy(changed.bytes+6+36,changed.bytes+6+44,8); // min=max
      reseal(&changed); assert(complications_read(changed.bytes,changed.length,NULL));
      changed=packet; memcpy(changed.bytes+6+36,packet.bytes+6+44,8);
      memcpy(changed.bytes+6+44,packet.bytes+6+36,8); reseal(&changed); assert_bad(&changed); // min>max
      changed=packet; changed.bytes[6+52+packet.bytes[8]]=0x01; reseal(&changed); assert_bad(&changed); // unit control
      changed=packet; changed.bytes[packet.records[4]+20]=1; reseal(&changed); assert_bad(&changed); // nonready semantic
    } else if (which == 1) {
      assert(result.slots[0].text_length > 48 && result.slots[0].text_length <= 128);
      assert(result.slots[0].width == 40 && result.slots[0].pixel_bytes == 800);
      assert(result.slots[1].text_length == 128);
      changed=packet; changed.bytes[6+3]=41; reseal(&changed); assert_bad(&changed);
    } else {
      assert(packet.length == COMPLICATION_MAX_BYTES);
      assert(strlen(result.slots[4].text) == 128 && strlen(result.slots[4].unit) == 16 && strlen(result.slots[4].label) == 24);
      for (size_t cut=0; cut<packet.length; ++cut) assert(!complications_read(packet.bytes,cut,NULL));
      changed=packet; changed.bytes[packet.records[4]+2]=129; reseal(&changed); assert_bad(&changed);
    }
  }
  return 0;
}
