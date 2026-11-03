#include "readings.h"
#include "context_data.h"

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

bool wfc_context_phone_status_read(const uint8_t *bytes, size_t length,
                                 WfcPhoneStatus *output) {
  if (!context_read(bytes, length, NULL)) { return false; }
  if (output == NULL) { return true; }
  size_t at = COMPLICATION_HEADER_BYTES;
  const size_t header = complications_record_header_bytes(bytes[0]);
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT - 1; ++i) {
    const uint8_t *record = bytes + at;
    at += header + record[2] + (bytes[0] >= 3 ? record[22] + record[23] : 0) +
        ((record[0] & COMPLICATION_FLAG_BITMAP) ?
         COMPLICATION_PALETTE_BYTES + complications_u16(record + 14) : 0);
  }
  const uint8_t *record = bytes + at;
  memset(output, 0, sizeof(*output));
  if (record[1] == COMPLICATION_STATUS_READY) {
    output->confirmed_at = complications_u32(record + 6);
    output->valid_until = complications_u32(record + 10);
    for (unsigned j = 0; j + 1 < record[2]; ++j)
      output->percent = output->percent * 10 + record[header + j] - '0';
    output->ready = true;
  }
  return true;
}
