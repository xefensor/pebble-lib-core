#include "readings.h"

#define WFC_READINGS_TYPE WfcReadings
#define WFC_READINGS_FN(name) wfc_readings_##name
#define WFC_READINGS_RECEIVE wfc_readings_receive
#include "readings_impl.h"
#undef WFC_READINGS_TYPE
#undef WFC_READINGS_FN
#undef WFC_READINGS_RECEIVE

void wfc_readings_init(WfcReadings *state, const WfcConfig *config, bool phone_connected) {
  memset(state, 0, sizeof(*state));
  if (config != NULL) { state->config = *config; }
  state->phone_connected = phone_connected;
}

bool wfc_readings_connection_changed(WfcReadings *state, bool phone_connected) {
  if (state->phone_connected == phone_connected) { return false; }
  state->phone_connected = phone_connected;
  clear_private_readings(state);
  changed(state);
  return true;
}

void wfc_readings_request_accepted(WfcReadings *state, time_t now) {
  state->last_request_at = now;
}
