#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <time.h>
#include <math.h>
#include <float.h>
typedef char complications_binary64_required[(sizeof(double) == 8 && DBL_MANT_DIG == 53 && DBL_MAX_EXP == 1024) ? 1 : -1];

#define COMPLICATION_SLOT_COUNT 5
#define COMPLICATION_HEADER_BYTES 6
#define COMPLICATION_LEGACY_RECORD_HEADER_BYTES 20
#define COMPLICATION_V3_RECORD_HEADER_BYTES 52
#define COMPLICATION_RECORD_HEADER_BYTES 56
#define COMPLICATION_MAX_TEXT_BYTES 128
#define COMPLICATION_MAX_BITMAP_WIDTH 40
#define COMPLICATION_MAX_BITMAP_HEIGHT 40
#define COMPLICATION_PALETTE_BYTES 16
#define COMPLICATION_MAX_BITMAP_BYTES 800
#define COMPLICATION_MAX_SLOT_BYTES 1040
#define COMPLICATION_MAX_BYTES 5206
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
  COMPLICATION_STATUS_EXPIRED = 7,
} ComplicationStatus;

enum {
  COMPLICATION_DISPLAY_GENERIC = 0,
  COMPLICATION_DISPLAY_PRECIPITATION = 1,
};

#define COMPLICATION_MAX_UNIT_BYTES 16
#define COMPLICATION_MAX_LABEL_BYTES 24

enum {
  COMPLICATION_SEMANTIC_GENERIC = 0, COMPLICATION_SEMANTIC_TEMPERATURE = 1,
  COMPLICATION_SEMANTIC_PRECIPITATION = 2, COMPLICATION_SEMANTIC_BATTERY = 3,
  COMPLICATION_SEMANTIC_HUMIDITY = 4, COMPLICATION_SEMANTIC_WIND = 5,
  COMPLICATION_SEMANTIC_UV = 6, COMPLICATION_SEMANTIC_CONDITION = 7,
  COMPLICATION_SEMANTIC_RANGE = 8, COMPLICATION_SEMANTIC_NUMBER = 9,
  COMPLICATION_SEMANTIC_BOOLEAN = 10, COMPLICATION_SEMANTIC_TIMESTAMP = 11,
};
enum {
  COMPLICATION_SOURCE_GENERIC = 0, COMPLICATION_SOURCE_WEATHER = 1,
  COMPLICATION_SOURCE_PHONE = 2, COMPLICATION_SOURCE_MUSIC = 3,
  COMPLICATION_SOURCE_NOTIFICATION = 4, COMPLICATION_SOURCE_OTHER = 5,
};
enum {
  COMPLICATION_DETAIL_NONE = 0, COMPLICATION_DETAIL_TEMPERATURE = 1,
  COMPLICATION_DETAIL_FEELS_LIKE = 2, COMPLICATION_DETAIL_HIGH = 3,
  COMPLICATION_DETAIL_LOW = 4, COMPLICATION_DETAIL_PRECIPITATION = 5,
  COMPLICATION_DETAIL_HUMIDITY = 6, COMPLICATION_DETAIL_WIND_SPEED = 7,
  COMPLICATION_DETAIL_WIND_DIRECTION = 8, COMPLICATION_DETAIL_UV = 9,
  COMPLICATION_DETAIL_CONDITION = 10, COMPLICATION_DETAIL_PHONE_BATTERY = 11,
};
enum { COMPLICATION_QUALIFIER_FORECAST = 1 };
static inline bool complications_detail_valid(unsigned detail,unsigned kind) {
  static const uint8_t semantic[] = {0,1,1,1,1,2,4,5,5,6,7,3};
  return detail <= COMPLICATION_DETAIL_PHONE_BATTERY && (!detail || semantic[detail] == kind ||
      (detail == COMPLICATION_DETAIL_PRECIPITATION &&
       (kind == COMPLICATION_SEMANTIC_GENERIC || kind == COMPLICATION_SEMANTIC_NUMBER)));
}
enum { COMPLICATION_SEMANTIC_VALUE = 1, COMPLICATION_SEMANTIC_MIN = 2,
       COMPLICATION_SEMANTIC_MAX = 4 };

static inline size_t complications_record_header_bytes(unsigned version) {
  return version == 4 ? COMPLICATION_RECORD_HEADER_BYTES : version == 3 ?
      COMPLICATION_V3_RECORD_HEADER_BYTES : COMPLICATION_LEGACY_RECORD_HEADER_BYTES;
}

// Read IEEE754 binary64 by bits, with no unaligned pointer access.
static inline double complications_f64(const uint8_t *bytes) {
  uint64_t bits = 0;
  for (unsigned i = 0; i < 8; ++i) bits |= (uint64_t)bytes[i] << (i * 8);
  double value;
  memcpy(&value, &bits, sizeof(value));
  return value;
}
static inline bool complications_zero(const uint8_t *bytes, size_t length) {
  for (size_t i = 0; i < length; ++i) if (bytes[i]) return false;
  return true;
}

typedef struct {
  uint8_t flags;
  uint8_t status;
  uint8_t width;
  uint8_t height;
  uint8_t stride;
  uint8_t text_length;
  uint8_t display_kind;
  uint8_t semantic_kind, source_kind, semantic_flags;
  uint8_t detail, qualifiers;
  uint32_t observed_at;
  bool cached; // Native persistent-cache origin only; never a provider observation time.
  double numeric_value, minimum, maximum;
  char unit[COMPLICATION_MAX_UNIT_BYTES + 1];
  char label[COMPLICATION_MAX_LABEL_BYTES + 1];
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
  const bool extended = bytes[0] >= 3;
  const bool precise = bytes[0] == 4;
  const size_t header = complications_record_header_bytes(bytes[0]);
  const unsigned known_flags = COMPLICATION_FLAG_TEXT | COMPLICATION_FLAG_BITMAP |
      COMPLICATION_FLAG_IMAGE | COMPLICATION_FLAG_TIMESTAMP;
  for (unsigned index = 0; index < COMPLICATION_SLOT_COUNT; ++index) {
    if (at > length || length - at < header) { return false; }
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
    const uint8_t kind = extended ? record[20] : 0;
    const uint8_t semantic_flags = extended ? record[21] : 0;
    const uint8_t unit_length = extended ? record[22] : 0;
    const uint8_t label_length = extended ? record[23] : 0;
    const uint8_t source = extended ? record[24] : 0;
    const uint8_t detail = precise ? record[25] : 0;
    const uint8_t qualifiers = precise ? record[26] : 0;
    const uint32_t observed = precise ? complications_u32(record + 52) : 0;
    const double value = extended ? complications_f64(record + 28) : 0;
    const double minimum = extended ? complications_f64(record + 36) : 0;
    const double maximum = extended ? complications_f64(record + 44) : 0;
    if (kind > COMPLICATION_SEMANTIC_TIMESTAMP || source > COMPLICATION_SOURCE_OTHER ||
        (semantic_flags & ~7) || unit_length > COMPLICATION_MAX_UNIT_BYTES ||
        label_length > COMPLICATION_MAX_LABEL_BYTES ||
        !complications_detail_valid(detail,kind) ||
        (qualifiers & ~COMPLICATION_QUALIFIER_FORECAST) ||
        (qualifiers && source != COMPLICATION_SOURCE_WEATHER) ||
        (observed && (observed > confirmed || (qualifiers & COMPLICATION_QUALIFIER_FORECAST))) ||
        (extended && ((precise ? record[27] != 0 : !complications_zero(record + 25, 3)) ||
          (!(semantic_flags & 1) && !complications_zero(record + 28, 8)) ||
          (!(semantic_flags & 2) && !complications_zero(record + 36, 8)) ||
          (!(semantic_flags & 4) && !complications_zero(record + 44, 8)))) ||
        !isfinite(value) || !isfinite(minimum) || !isfinite(maximum) ||
        ((semantic_flags & 6) == 6 && minimum > maximum)) return false;
    if ((flags & ~known_flags) || status > (precise ? COMPLICATION_STATUS_EXPIRED : COMPLICATION_STATUS_DISABLED) ||
        display_kind > COMPLICATION_DISPLAY_PRECIPITATION ||
        (bytes[0] == 1 && display_kind != COMPLICATION_DISPLAY_GENERIC) ||
        text_length > (extended ? COMPLICATION_MAX_TEXT_BYTES : 48) ||
        width > (extended ? COMPLICATION_MAX_BITMAP_WIDTH : 24) ||
        height > (extended ? COMPLICATION_MAX_BITMAP_HEIGHT : 24) ||
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
    } else {
      if (flags || display_kind || text_length || width || height || confirmed || until ||
          pixel_bytes || timestamp || semantic_flags || observed) return false;
      if ((!precise || status == COMPLICATION_STATUS_EMPTY) &&
          (kind || source || unit_length || label_length || detail || qualifiers)) return false;
      if (precise && (source == COMPLICATION_SOURCE_MUSIC || source == COMPLICATION_SOURCE_NOTIFICATION)) return false;
    }

    at += header;
    const size_t bitmap_length = flags & COMPLICATION_FLAG_BITMAP
        ? COMPLICATION_PALETTE_BYTES + pixel_bytes : 0;
    const size_t payload_length = text_length + unit_length + label_length + bitmap_length;
    if (payload_length > length - at ||
        !complications_text_valid(bytes + at, text_length) ||
        !complications_text_valid(bytes + at + text_length, unit_length) ||
        !complications_text_valid(bytes + at + text_length + unit_length, label_length)) { return false; }
    if (result != NULL) {
      ComplicationSlot *slot = &result->slots[index];
      slot->flags = flags;
      slot->status = status;
      slot->text_length = text_length;
      slot->display_kind = display_kind;
      slot->semantic_kind = kind; slot->source_kind = source; slot->semantic_flags = semantic_flags;
      slot->detail = detail; slot->qualifiers = qualifiers; slot->observed_at = observed;
      slot->numeric_value = value; slot->minimum = minimum; slot->maximum = maximum;
      if (unit_length) memcpy(slot->unit, bytes + at + text_length, unit_length);
      if (label_length) memcpy(slot->label, bytes + at + text_length + unit_length, label_length);
      slot->width = width;
      slot->height = height;
      slot->stride = stride;
      slot->pixel_bytes = pixel_bytes;
      slot->confirmed_at = confirmed;
      slot->valid_until = until;
      slot->timestamp = timestamp;
      if (text_length) { memcpy(slot->text, bytes + at, text_length); }
      if (bitmap_length) {
        memcpy(slot->palette, bytes + at + text_length + unit_length + label_length, COMPLICATION_PALETTE_BYTES);
        memcpy(slot->bitmap, bytes + at + text_length + unit_length + label_length + COMPLICATION_PALETTE_BYTES, pixel_bytes);
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
      COMPLICATION_SLOT_COUNT * COMPLICATION_LEGACY_RECORD_HEADER_BYTES ||
      length > COMPLICATION_MAX_BYTES || (bytes[0] != 1 && bytes[0] != 2 && bytes[0] != 3 && bytes[0] != 4) || bytes[1] != 0 ||
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
