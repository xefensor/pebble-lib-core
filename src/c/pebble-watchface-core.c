#include "pebble-watchface-core.h"

#define WFC_READINGS_TYPE WatchfaceCore
#define WFC_READINGS_FN(name) wfc_##name
#define WFC_READINGS_RECEIVE wfc_receive_complications
#include "readings_impl.h"
#undef WFC_READINGS_TYPE
#undef WFC_READINGS_FN
#undef WFC_READINGS_RECEIVE

void wfc_init(WatchfaceCore *state, const WfcConfig *config,
              bool phone_connected, uint32_t previous_session_token) {
  memset(state, 0, sizeof(*state));
  if (config != NULL) { state->config = *config; }
  state->phone_connected = phone_connected;
  state->session_token = context_next_session_token(previous_session_token);
  state->context_rebaseline = true;
  state->context_awaiting_baseline = true;
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
  clear_private_readings(state);
  if (phone_connected) { state->session_token = context_next_session_token(state->session_token); }
  changed(state);
  return true;
}

void wfc_context_query(WatchfaceCore *state) {
  // A phone-side runtime can restart without a Bluetooth transition. Give its
  // new ephemeral event sequence a new native session rather than confusing
  // it with an earlier runtime's notification bursts or late request ACKs.
  state->session_token = context_next_session_token(state->session_token);
  ++state->connection_generation;
  state->context_rebaseline = true;
  state->context_awaiting_baseline = true;
  memset(&state->context, 0, sizeof(state->context));
  changed(state);
}

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

uint32_t wfc_prune_context(WatchfaceCore *state, time_t now) {
  bool pruned = false;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    if (!context_slot_fresh(&state->context.slots[i], now)) {
      if (!complications_zero((const uint8_t *)&state->context.slots[i],
                              sizeof(state->context.slots[i]))) { pruned = true; }
      memset(&state->context.slots[i], 0, sizeof(state->context.slots[i]));
    }
  }
  if (pruned) { changed(state); }
  return context_next_expiry(&state->context, now);
}
