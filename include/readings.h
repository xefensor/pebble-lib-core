#pragma once

#include "core_types.h"

// A host using a separate activity engine needs no legacy context allocation.
// This is an additive state type; WatchfaceCore's layout and API are unchanged.
typedef struct {
  ComplicationSet complications;
  bool has_complications;
  bool phone_connected;
  bool was_fresh[COMPLICATION_SLOT_COUNT];
  uint8_t complication_packet[WFC_CACHE_BYTES];
  size_t complication_packet_length;
  time_t last_request_at;
  WfcConfig config;
} WfcReadings;

void wfc_readings_init(WfcReadings *state, const WfcConfig *config, bool phone_connected);
bool wfc_readings_load_cache(WfcReadings *state, time_t now);
void wfc_readings_clear_cache(WfcReadings *state);
bool wfc_readings_receive(WfcReadings *state, const uint8_t *bytes, size_t length, time_t now);
bool wfc_readings_connection_changed(WfcReadings *state, bool phone_connected);
void wfc_readings_request_accepted(WfcReadings *state, time_t now);
// True once when a ready record becomes stale, or for a connected 30-min refresh.
bool wfc_readings_tick(WfcReadings *state, time_t now);

// Activity hosts still validate the complete legacy context packet, but retain
// only its public phone status. No private text/image or five-slot copy exists.
typedef struct {
  uint32_t confirmed_at, valid_until;
  uint8_t percent;
  bool ready;
} WfcPhoneStatus;

// Invalid input leaves *output unchanged. NULL output performs validation only.
bool wfc_context_phone_status_read(const uint8_t *bytes, size_t length,
                                 WfcPhoneStatus *output);
static inline bool wfc_phone_status_fresh(const WfcPhoneStatus *status, time_t now) {
  return status->ready && status->valid_until > (int64_t)now &&
      (int64_t)status->confirmed_at <= (int64_t)now + 30;
}
