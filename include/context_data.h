#pragma once

#include "complication_data.h"

#define CONTEXT_NOTIFICATION_SECONDS 12
#define CONTEXT_SOURCE_SECONDS 120
#define CONTEXT_MAX_SESSION_TOKEN 2147483647u

static inline uint32_t context_next_session_token(uint32_t previous) {
  return previous < 2 || previous >= CONTEXT_MAX_SESSION_TOKEN ? 2 : previous + 1;
}

static inline bool context_session_token_matches(uint32_t marker, uint32_t expected) {
  return marker >= 2 && marker <= CONTEXT_MAX_SESSION_TOKEN && marker == expected;
}

typedef enum {
  CONTEXT_NONE = 0,
  CONTEXT_MUSIC = 1,
  CONTEXT_NOTIFICATION = 2,
} ContextMode;

static inline bool context_slot_fresh(const ComplicationSlot *slot, time_t now) {
  return complication_is_fresh(slot, now) &&
      (int64_t)slot->confirmed_at <= (int64_t)now + 30;
}

static inline bool context_phone_battery(const ComplicationSlot *slot, time_t now,
                                         unsigned *percent) {
  if (!context_slot_fresh(slot, now) || slot->flags != COMPLICATION_FLAG_TEXT ||
      slot->text_length < 2 || slot->text_length > 3) { return false; }
  unsigned value = 0;
  for (unsigned i = 0; i + 1 < slot->text_length; ++i) {
    if (slot->text[i] < '0' || slot->text[i] > '9') { return false; }
    value = value * 10 + (unsigned)(slot->text[i] - '0');
  }
  if (slot->text[slot->text_length - 1] != '%' || value > 15) { return false; }
  if (percent != NULL) { *percent = value; }
  return true;
}

// Same bounded five-record wire format as complications, but transient data
// has deliberately shorter leases and no timestamp or arbitrary field type.
// Validate all records before touching destination storage.
static inline bool context_read(const uint8_t *bytes, size_t length,
                                 ComplicationSet *result) {
  if (!complications_read(bytes, length, NULL)) { return false; }
  size_t at = COMPLICATION_HEADER_BYTES;
  const size_t header = complications_record_header_bytes(bytes[0]);
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    const uint8_t *record = bytes + at;
    const uint8_t flags = record[0];
    const uint8_t status = record[1];
    const uint8_t text_length = record[2];
    const uint16_t pixels = complications_u16(record + 14);
    if ((flags & COMPLICATION_FLAG_TIMESTAMP) || record[5] != COMPLICATION_DISPLAY_GENERIC) { return false; }
    if (status == COMPLICATION_STATUS_READY) {
      const uint32_t confirmed = complications_u32(record + 6);
      const uint32_t until = complications_u32(record + 10);
      const unsigned limit = i == 2 || i == 3
          ? CONTEXT_NOTIFICATION_SECONDS : CONTEXT_SOURCE_SECONDS;
      if (until - confirmed > limit ||
          ((i == 1 || i == 3 || i == 4) && flags != COMPLICATION_FLAG_TEXT)) {
        return false;
      }
      if (i == 4) {
        if (text_length < 2 || text_length > 3) { return false; }
        unsigned value = 0;
        const uint8_t *text = record + header;
        for (unsigned j = 0; j + 1 < text_length; ++j) {
          if (text[j] < '0' || text[j] > '9') { return false; }
          value = value * 10 + (unsigned)(text[j] - '0');
        }
        if (text[text_length - 1] != '%' || value > 15) { return false; }
      }
    }
    at += header + text_length + (bytes[0] == 3 ? record[22] + record[23] : 0) +
        ((flags & COMPLICATION_FLAG_BITMAP) ? COMPLICATION_PALETTE_BYTES + pixels : 0);
  }
  return complications_read(bytes, length, result);
}

// A phone transport may still hold an older copied snapshot when the watch
// reconnects. Only a valid explicitly marked post-baseline snapshot re-enables
// notification previews. Music/status can recover while that handshake waits.
static inline bool context_receive(const uint8_t *bytes, size_t length,
                                    ComplicationSet *result,
                                    bool *awaiting_baseline, bool baseline) {
  if (result == NULL || awaiting_baseline == NULL ||
      !context_read(bytes, length, result)) { return false; }
  if (baseline) { *awaiting_baseline = false; }
  if (*awaiting_baseline) {
    memset(&result->slots[2], 0, sizeof(result->slots[2]));
    memset(&result->slots[3], 0, sizeof(result->slots[3]));
  }
  return true;
}

static inline ContextMode context_mode(const ComplicationSet *data, time_t now) {
  if (data == NULL) { return CONTEXT_NONE; }
  if (context_slot_fresh(&data->slots[2], now)) { return CONTEXT_NOTIFICATION; }
  if (context_slot_fresh(&data->slots[0], now)) { return CONTEXT_MUSIC; }
  return CONTEXT_NONE;
}

static inline uint32_t context_next_expiry(const ComplicationSet *data, time_t now) {
  uint32_t next = 0;
  if (data == NULL) { return next; }
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    const ComplicationSlot *slot = &data->slots[i];
    if (context_slot_fresh(slot, now) && (next == 0 || slot->valid_until < next)) {
      next = slot->valid_until;
    }
  }
  return next;
}
