#include "readings.h"

static bool pair_decode(const uint8_t *bytes,size_t length,WfcReadingSlots *slots) {
  return complications_read_prefix(bytes,length,slots?slots->slots:NULL,2);
}
#define WFC_READINGS_TYPE WfcReadingPair
#define WFC_READINGS_FN(name) wfc_reading_pair_##name
#define WFC_READINGS_RECEIVE wfc_reading_pair_receive
#define WFC_READINGS_SLOTS 2
#define WFC_READINGS_DECODE pair_decode
#include "readings_impl.h"

bool wfc_reading_pair_init(WfcReadingPair *state,const WfcConfig *config,bool connected,
                            uint8_t *scratch,size_t capacity) {
  if(!state||!scratch||capacity<WFC_CACHE_BYTES)return false;
  memset(state,0,sizeof(*state));
  state->complication_packet=scratch;
  if(config)state->config=*config;
  state->phone_connected=connected;
  return true;
}
bool wfc_reading_pair_connection_changed(WfcReadingPair *state,bool connected) {
  if(state->phone_connected==connected)return false;
  state->phone_connected=connected;
  clear_private_readings(state);changed(state);return true;
}
void wfc_reading_pair_request_accepted(WfcReadingPair *state,time_t now) {
  state->last_request_at=now;
}
