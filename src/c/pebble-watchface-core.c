#include "pebble-watchface-core.h"

static void changed(WatchfaceCore *state) {
  if (state->config.on_changed != NULL) { state->config.on_changed(state->config.context); }
}

static void record_freshness(WatchfaceCore *state, time_t now) {
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    state->was_fresh[i] = state->has_complications &&
        complication_is_fresh(&state->complications.slots[i], now);
  }
}

void wfc_init(WatchfaceCore *state, const WfcConfig *config,
              bool phone_connected, uint32_t previous_session_token) {
  memset(state, 0, sizeof(*state));
  if (config != NULL) { state->config = *config; }
  state->phone_connected = phone_connected;
  state->session_token = context_next_session_token(previous_session_token);
  state->context_rebaseline = true;
  state->context_awaiting_baseline = true;
}

void wfc_clear_cache(WatchfaceCore *state) {
  if (state->config.storage.remove == NULL) { return; }
  for (unsigned i = 0; i < WFC_CACHE_CHUNKS; ++i) {
    state->config.storage.remove(state->config.storage.context, state->config.cache_first_key + i);
  }
}

static bool save_cache(WatchfaceCore *state) {
  const WfcStorage *storage = &state->config.storage;
  if (storage->write == NULL || storage->remove == NULL) { return false; }
  const size_t count = (state->complication_packet_length + WFC_CACHE_CHUNK_BYTES - 1) /
      WFC_CACHE_CHUNK_BYTES;
  // Commit the header chunk last; torn writes cannot revive a mixed snapshot.
  for (size_t pass = 1; pass <= count; ++pass) {
    const size_t index = pass == count ? 0 : pass;
    const size_t offset = index * WFC_CACHE_CHUNK_BYTES;
    const size_t remaining = state->complication_packet_length - offset;
    const size_t length = remaining < WFC_CACHE_CHUNK_BYTES ? remaining : WFC_CACHE_CHUNK_BYTES;
    if (storage->write(storage->context, state->config.cache_first_key + index,
                       state->complication_packet + offset, length) != (int)length) {
      wfc_clear_cache(state);
      return false;
    }
  }
  for (size_t i = count; i < WFC_CACHE_CHUNKS; ++i) {
    storage->remove(storage->context, state->config.cache_first_key + i);
  }
  return true;
}

bool wfc_load_cache(WatchfaceCore *state, time_t now) {
  const WfcStorage *storage = &state->config.storage;
  if (storage->size == NULL || storage->read == NULL) { return false; }
  const uint32_t first_key = state->config.cache_first_key;
  const int first_length = storage->size(storage->context, first_key);
  if (first_length < COMPLICATION_HEADER_BYTES || first_length > WFC_CACHE_CHUNK_BYTES ||
      storage->read(storage->context, first_key, state->complication_packet,
                    WFC_CACHE_CHUNK_BYTES) != first_length) { return false; }
  const size_t length = complications_u16(state->complication_packet + 2);
  if (length < COMPLICATION_HEADER_BYTES || length > COMPLICATION_MAX_BYTES ||
      first_length != (int)(length < WFC_CACHE_CHUNK_BYTES ? length : WFC_CACHE_CHUNK_BYTES)) {
    return false;
  }
  const size_t count = (length + WFC_CACHE_CHUNK_BYTES - 1) / WFC_CACHE_CHUNK_BYTES;
  for (size_t i = 1; i < count; ++i) {
    const size_t offset = i * WFC_CACHE_CHUNK_BYTES;
    const size_t remaining = length - offset;
    const size_t chunk = remaining < WFC_CACHE_CHUNK_BYTES ? remaining : WFC_CACHE_CHUNK_BYTES;
    if (storage->size(storage->context, first_key + i) != (int)chunk ||
        storage->read(storage->context, first_key + i,
                      state->complication_packet + offset, chunk) != (int)chunk) { return false; }
  }
  if (!complications_read(state->complication_packet, length, &state->complications)) { return false; }
  state->has_complications = true;
  state->complication_packet_length = length;
  record_freshness(state, now);
  changed(state);
  return true;
}

bool wfc_receive_complications(WatchfaceCore *state, const uint8_t *bytes,
                               size_t length, time_t now) {
  if (length <= COMPLICATION_MAX_BYTES && complications_read(bytes, length, &state->complications)) {
    state->has_complications = true;
    state->complication_packet_length = length;
    memcpy(state->complication_packet, bytes, length);
    record_freshness(state, now);
    save_cache(state);
    changed(state);
    return true;
  }
  state->has_complications = false;
  state->complication_packet_length = 0;
  memset(&state->complications, 0, sizeof(state->complications));
  memset(state->was_fresh, 0, sizeof(state->was_fresh));
  wfc_clear_cache(state);
  changed(state);
  return false;
}

bool wfc_receive_context(WatchfaceCore *state, const uint8_t *bytes,
                         size_t length, uint32_t marker) {
  const bool baseline = context_session_token_matches(marker, state->session_token);
  const bool valid = state->phone_connected && length <= COMPLICATION_MAX_BYTES &&
      context_receive(bytes, length, &state->context, &state->context_awaiting_baseline, baseline);
  if (!valid) { memset(&state->context, 0, sizeof(state->context)); }
  changed(state);
  return valid;
}

bool wfc_connection_changed(WatchfaceCore *state, bool phone_connected) {
  if (state->phone_connected == phone_connected) { return false; }
  state->phone_connected = phone_connected;
  ++state->connection_generation;
  state->context_rebaseline = true;
  state->context_awaiting_baseline = true;
  memset(&state->context, 0, sizeof(state->context));
  if (phone_connected) { state->session_token = context_next_session_token(state->session_token); }
  changed(state);
  return true;
}

void wfc_context_query(WatchfaceCore *state) { state->context_rebaseline = true; }

uint32_t wfc_request_marker(WatchfaceCore *state) {
  state->context_rebaseline_in_flight = state->context_rebaseline;
  state->request_generation = state->connection_generation;
  return state->context_rebaseline || state->context_awaiting_baseline ? state->session_token : 1;
}

void wfc_request_accepted(WatchfaceCore *state, time_t now) { state->last_request_at = now; }
void wfc_request_failed(WatchfaceCore *state) { state->context_rebaseline_in_flight = false; }
void wfc_request_acknowledged(WatchfaceCore *state) {
  if (state->context_rebaseline_in_flight && state->request_generation == state->connection_generation) {
    state->context_rebaseline = false;
  }
  state->context_rebaseline_in_flight = false;
}

bool wfc_tick(WatchfaceCore *state, time_t now) {
  bool expired = false;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    const bool fresh = state->has_complications && complication_is_fresh(&state->complications.slots[i], now);
    if (state->was_fresh[i] && !fresh && state->complications.slots[i].status == COMPLICATION_STATUS_READY) {
      expired = true;
    }
    state->was_fresh[i] = fresh;
  }
  if (expired) { changed(state); }
  return expired || (state->phone_connected && now >= state->last_request_at + WFC_REFRESH_SECONDS);
}

uint32_t wfc_prune_context(WatchfaceCore *state, time_t now) {
  bool pruned = false;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    if (!context_slot_fresh(&state->context.slots[i], now)) {
      const ComplicationSlot empty = {0};
      if (memcmp(&state->context.slots[i], &empty, sizeof(empty)) != 0) { pruned = true; }
      memset(&state->context.slots[i], 0, sizeof(state->context.slots[i]));
    }
  }
  if (pruned) { changed(state); }
  return context_next_expiry(&state->context, now);
}
