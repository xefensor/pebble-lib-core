/* Run the same persisted-cache, expiry and privacy scenarios as WfcReadings,
 * with the compact host type and the unchanged legacy core as reference. */
#include "readings.h"
#define WfcReadings WfcReadingPair
static uint8_t pair_scratch[WFC_CACHE_BYTES];
/* The host can rebuild its render plan as soon as the callback starts. */
#define READING_TEST_REUSE_SCRATCH() memset(pair_scratch,0xa5,sizeof(pair_scratch))
#define wfc_readings_init(state,config,connected) \
  ((void)wfc_reading_pair_init(state,config,connected,pair_scratch,sizeof(pair_scratch)))
#define wfc_readings_load_cache wfc_reading_pair_load_cache
#define wfc_readings_receive wfc_reading_pair_receive
#define wfc_readings_connection_changed wfc_reading_pair_connection_changed
#define wfc_readings_request_accepted wfc_reading_pair_request_accepted
#define wfc_readings_tick wfc_reading_pair_tick
#define wfc_readings_clear_cache wfc_reading_pair_clear_cache
#define READING_TEST_PRIVATE_SLOTS 2
#include "readings-state.c"
