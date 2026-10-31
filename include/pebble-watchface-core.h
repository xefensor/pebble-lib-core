#pragma once

#include "complication_data.h"
#include "context_data.h"

#define WFC_CACHE_CHUNKS 8
#define WFC_CACHE_CHUNK_BYTES 256
#define WFC_REFRESH_SECONDS (30 * 60)

typedef struct {
  void *context;
  int (*size)(void *context, uint32_t key);
  int (*read)(void *context, uint32_t key, void *buffer, size_t length);
  int (*write)(void *context, uint32_t key, const void *buffer, size_t length);
  void (*remove)(void *context, uint32_t key);
} WfcStorage;

typedef struct {
  WfcStorage storage;
  uint32_t cache_first_key;
  void (*on_changed)(void *context);
  void *context;
} WfcConfig;

// One independent state object per watchface. The host owns Pebble services,
// AppMessage registration, timers, presentation and its persistent session key.
typedef struct {
  ComplicationSet complications;
  ComplicationSet context;
  bool has_complications;
  bool phone_connected;
  bool was_fresh[COMPLICATION_SLOT_COUNT];
  uint8_t complication_packet[COMPLICATION_MAX_BYTES];
  size_t complication_packet_length;
  bool context_rebaseline;
  bool context_awaiting_baseline;
  bool context_rebaseline_in_flight;
  uint32_t session_token;
  uint32_t connection_generation;
  uint32_t request_generation;
  time_t last_request_at;
  WfcConfig config;
} WatchfaceCore;

// Advances the saved session token. Persist state->session_token in the host.
void wfc_init(WatchfaceCore *state, const WfcConfig *config,
              bool phone_connected, uint32_t previous_session_token);
bool wfc_load_cache(WatchfaceCore *state, time_t now);
void wfc_clear_cache(WatchfaceCore *state);
bool wfc_receive_complications(WatchfaceCore *state, const uint8_t *bytes,
                               size_t length, time_t now);
// Invalid or disconnected context clears all transient content immediately.
bool wfc_receive_context(WatchfaceCore *state, const uint8_t *bytes,
                         size_t length, uint32_t marker);
// Returns true only on a real connection transition. A reconnect advances the
// session token; the host persists it and schedules its normal startup request.
bool wfc_connection_changed(WatchfaceCore *state, bool phone_connected);
void wfc_context_query(WatchfaceCore *state);
// Call after an outbox was successfully opened, then report the send result.
uint32_t wfc_request_marker(WatchfaceCore *state);
void wfc_request_accepted(WatchfaceCore *state, time_t now);
void wfc_request_failed(WatchfaceCore *state);
void wfc_request_acknowledged(WatchfaceCore *state);
// One request on a ready->stale transition, or every30min while connected.
bool wfc_tick(WatchfaceCore *state, time_t now);
// Clears expired transient records and returns the next absolute expiry, or0.
uint32_t wfc_prune_context(WatchfaceCore *state, time_t now);
