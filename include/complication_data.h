#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

#define COMPLICATION_SLOT_COUNT 5
#define COMPLICATION_HEADER_BYTES 6
#define COMPLICATION_RECORD_HEADER_BYTES 20
#define COMPLICATION_MAX_TEXT_BYTES 48
#define COMPLICATION_MAX_BITMAP_WIDTH 24
#define COMPLICATION_MAX_BITMAP_HEIGHT 24
#define COMPLICATION_PALETTE_BYTES 16
#define COMPLICATION_MAX_BITMAP_BYTES 288
#define COMPLICATION_MAX_SLOT_BYTES 372
#define COMPLICATION_MAX_BYTES 1866
#define COMPLICATION_MAX_AGE_SECONDS (2 * 60 * 60)

enum {
  COMPLICATION_FLAG_TEXT = 1,
  COMPLICATION_FLAG_BITMAP = 2,
  COMPLICATION_FLAG_IMAGE = 4,
  COMPLICATION_FLAG_TIMESTAMP = 8,
};

typedef enum {
  COMPLICATION_STATUS_EMPTY = 0,
  COMPLICATION_STATUS_LOADING = 1,
  COMPLICATION_STATUS_READY = 2,
  COMPLICATION_STATUS_UNAVAILABLE = 3,
  COMPLICATION_STATUS_DENIED = 4,
  COMPLICATION_STATUS_UNSUPPORTED = 5,
  COMPLICATION_STATUS_DISABLED = 6,
} ComplicationStatus;

enum {
  COMPLICATION_DISPLAY_GENERIC = 0,
  COMPLICATION_DISPLAY_PRECIPITATION = 1,
};

typedef struct {
  uint8_t flags;
  uint8_t status;
  uint8_t width;
  uint8_t height;
  uint8_t stride;
  uint8_t text_length;
  uint8_t display_kind;
  uint16_t pixel_bytes;
  uint32_t confirmed_at;
  uint32_t valid_until;
  uint32_t timestamp;
  char text[COMPLICATION_MAX_TEXT_BYTES + 1];
  uint8_t palette[COMPLICATION_PALETTE_BYTES];
  // Raw 4bpp: even x is the high nibble. Every row is padded to four bytes.
  uint8_t bitmap[COMPLICATION_MAX_BITMAP_BYTES];
} ComplicationSlot;

typedef struct {
  ComplicationSlot slots[COMPLICATION_SLOT_COUNT];
} ComplicationSet;

static inline uint16_t complications_u16(const uint8_t *bytes) {
  return (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);
}

static inline uint32_t complications_u32(const uint8_t *bytes) {
  return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
      ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

// CRC16-CCITT/XMODEM, initial value zero, polynomial 0x1021. The checksum
// includes the complete snapshot, with the checksum's own two bytes zeroed.
static inline uint16_t complications_crc16(const uint8_t *bytes, size_t length) {
  uint16_t crc = 0;
  if (bytes == NULL) { return 0; }
  for (size_t i = 0; i < length; ++i) {
    const uint8_t value = i == 4 || i == 5 ? 0 : bytes[i];
    crc ^= (uint16_t)value << 8;
    for (unsigned bit = 0; bit < 8; ++bit) {
      crc = (uint16_t)((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0));
    }
  }
  return crc;
}

// Single-line printable UTF-8. Reject overlong encodings, surrogates and
// out-of-range scalars, plus C0/C1 controls and Unicode line separators.
static inline bool complications_text_valid(const uint8_t *text, size_t length) {
  size_t at = 0;
  while (at < length) {
    const uint8_t first = text[at++];
    uint32_t point;
    uint32_t minimum;
    unsigned remaining;
    if (first < 0x80) {
      point = first;
      minimum = 0;
      remaining = 0;
    } else if (first >= 0xc2 && first <= 0xdf) {
      point = first & 0x1f;
      minimum = 0x80;
      remaining = 1;
    } else if (first >= 0xe0 && first <= 0xef) {
      point = first & 0x0f;
      minimum = 0x800;
      remaining = 2;
    } else if (first >= 0xf0 && first <= 0xf4) {
      point = first & 0x07;
      minimum = 0x10000;
      remaining = 3;
    } else { return false; }
    if (remaining > length - at) { return false; }
    for (unsigned i = 0; i < remaining; ++i) {
      const uint8_t next = text[at++];
      if ((next & 0xc0) != 0x80) { return false; }
      point = (point << 6) | (next & 0x3f);
    }
    if (point < minimum || point > 0x10ffff ||
        (point >= 0xd800 && point <= 0xdfff) || point < 0x20 ||
        (point >= 0x7f && point <= 0x9f) || point == 0x2028 || point == 0x2029) {
      return false;
    }
  }
  return true;
}

static inline bool complications_records_read(const uint8_t *bytes,
                                               size_t length,
                                               ComplicationSet *result) {
  size_t at = COMPLICATION_HEADER_BYTES;
  const unsigned known_flags = COMPLICATION_FLAG_TEXT | COMPLICATION_FLAG_BITMAP |
      COMPLICATION_FLAG_IMAGE | COMPLICATION_FLAG_TIMESTAMP;
  for (unsigned index = 0; index < COMPLICATION_SLOT_COUNT; ++index) {
    if (at > length || length - at < COMPLICATION_RECORD_HEADER_BYTES) { return false; }
    const uint8_t *record = bytes + at;
    const uint8_t flags = record[0];
    const uint8_t status = record[1];
    const uint8_t text_length = record[2];
    const uint8_t width = record[3];
    const uint8_t height = record[4];
    const uint8_t display_kind = record[5];
    const uint32_t confirmed = complications_u32(record + 6);
    const uint32_t until = complications_u32(record + 10);
    const uint16_t pixel_bytes = complications_u16(record + 14);
    const uint32_t timestamp = complications_u32(record + 16);
    if ((flags & ~known_flags) || status > COMPLICATION_STATUS_DISABLED ||
        display_kind > COMPLICATION_DISPLAY_PRECIPITATION ||
        (bytes[0] == 1 && display_kind != COMPLICATION_DISPLAY_GENERIC) ||
        text_length > COMPLICATION_MAX_TEXT_BYTES ||
        width > COMPLICATION_MAX_BITMAP_WIDTH || height > COMPLICATION_MAX_BITMAP_HEIGHT ||
        ((flags & COMPLICATION_FLAG_IMAGE) && !(flags & COMPLICATION_FLAG_BITMAP))) { return false; }
    const uint8_t stride = (uint8_t)(((width + 7) >> 3) * 4);
    if (status == COMPLICATION_STATUS_READY) {
      if (display_kind != COMPLICATION_DISPLAY_GENERIC &&
          (!(flags & COMPLICATION_FLAG_TEXT) || (flags & COMPLICATION_FLAG_TIMESTAMP))) { return false; }
      if (!(flags & (COMPLICATION_FLAG_TEXT | COMPLICATION_FLAG_BITMAP | COMPLICATION_FLAG_TIMESTAMP)) ||
          ((flags & COMPLICATION_FLAG_TEXT) ? text_length == 0 : text_length != 0) ||
          ((flags & COMPLICATION_FLAG_TIMESTAMP) ? timestamp == 0 : timestamp != 0) ||
          confirmed == 0 || until <= confirmed ||
          (uint64_t)until > (uint64_t)confirmed + COMPLICATION_MAX_AGE_SECONDS) { return false; }
      if (flags & COMPLICATION_FLAG_BITMAP) {
        if (width == 0 || height == 0 || pixel_bytes != (unsigned)stride * height) { return false; }
      } else if (width != 0 || height != 0 || pixel_bytes != 0) { return false; }
    } else if (flags != 0 || display_kind != 0 || text_length != 0 || width != 0 || height != 0 ||
               confirmed != 0 || until != 0 || pixel_bytes != 0 || timestamp != 0) { return false; }

    at += COMPLICATION_RECORD_HEADER_BYTES;
    const size_t bitmap_length = flags & COMPLICATION_FLAG_BITMAP
        ? COMPLICATION_PALETTE_BYTES + pixel_bytes : 0;
    const size_t payload_length = text_length + bitmap_length;
    if (payload_length > length - at ||
        !complications_text_valid(bytes + at, text_length)) { return false; }
    if (result != NULL) {
      ComplicationSlot *slot = &result->slots[index];
      slot->flags = flags;
      slot->status = status;
      slot->text_length = text_length;
      slot->display_kind = display_kind;
      slot->width = width;
      slot->height = height;
      slot->stride = stride;
      slot->pixel_bytes = pixel_bytes;
      slot->confirmed_at = confirmed;
      slot->valid_until = until;
      slot->timestamp = timestamp;
      if (text_length) { memcpy(slot->text, bytes + at, text_length); }
      if (bitmap_length) {
        memcpy(slot->palette, bytes + at + text_length, COMPLICATION_PALETTE_BYTES);
        memcpy(slot->bitmap, bytes + at + text_length + COMPLICATION_PALETTE_BYTES, pixel_bytes);
      }
    }
    at += payload_length;
  }
  return at == length;
}

// Validate the complete snapshot before copying any slot. Two passes avoid a
// roughly 2KB temporary ComplicationSet on the watch's small native stack.
// Input bytes and output storage must not overlap.
static inline bool complications_read(const uint8_t *bytes, size_t length,
                                       ComplicationSet *result) {
  if (bytes == NULL || length < COMPLICATION_HEADER_BYTES +
      COMPLICATION_SLOT_COUNT * COMPLICATION_RECORD_HEADER_BYTES ||
      length > COMPLICATION_MAX_BYTES || (bytes[0] != 1 && bytes[0] != 2) || bytes[1] != 0 ||
      complications_u16(bytes + 2) != length ||
      complications_u16(bytes + 4) != complications_crc16(bytes, length) ||
      !complications_records_read(bytes, length, NULL)) { return false; }
  if (result != NULL) {
    memset(result, 0, sizeof(*result));
    complications_records_read(bytes, length, result);
  }
  return true;
}

static inline bool complication_is_selected(const ComplicationSlot *slot) {
  return slot != NULL && slot->status != COMPLICATION_STATUS_EMPTY;
}

// Structurally valid expired slots remain in the snapshot so fixed global IDs
// do not move. A display uses this helper to replace stale values with '--'.
static inline bool complication_is_fresh(const ComplicationSlot *slot, time_t now) {
  const int64_t current = (int64_t)now;
  if (slot == NULL || slot->status != COMPLICATION_STATUS_READY || current <= 0 ||
      current > UINT32_MAX || slot->confirmed_at == 0 ||
      (int64_t)slot->confirmed_at > current + 300 ||
      slot->valid_until <= slot->confirmed_at || current >= slot->valid_until ||
      (uint64_t)slot->valid_until > (uint64_t)slot->confirmed_at + COMPLICATION_MAX_AGE_SECONDS) {
    return false;
  }
  return true;
}
