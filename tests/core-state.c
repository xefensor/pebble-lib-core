#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../include/pebble-watchface-core.h"

#define FIRST_KEY 20
static const uint32_t NOW = 1791893700;

typedef struct {
  uint8_t bytes[WFC_CACHE_CHUNKS][WFC_CACHE_CHUNK_BYTES];
  int length[WFC_CACHE_CHUNKS];
  unsigned writes[WFC_CACHE_CHUNKS * 2];
  unsigned write_count;
  unsigned fail_write;
  unsigned removals;
  unsigned notifications;
} Store;

static void reset_store(Store *store) {
  memset(store, 0, sizeof(*store));
  for (unsigned i = 0; i < WFC_CACHE_CHUNKS; ++i) { store->length[i] = -1; }
}
static unsigned index_of(uint32_t key) {
  assert(key >= FIRST_KEY && key < FIRST_KEY + WFC_CACHE_CHUNKS);
  return key - FIRST_KEY;
}
static int size_of(void *context, uint32_t key) {
  return ((Store *)context)->length[index_of(key)];
}
static int read_bytes(void *context, uint32_t key, void *buffer, size_t length) {
  Store *store = context;
  const unsigned index = index_of(key);
  if (store->length[index] < 0) { return -1; }
  const size_t available = (size_t)store->length[index];
  const size_t count = available < length ? available : length;
  memcpy(buffer, store->bytes[index], count);
  return (int)count;
}
static int write_bytes(void *context, uint32_t key, const void *buffer, size_t length) {
  Store *store = context;
  const unsigned index = index_of(key);
  assert(length <= WFC_CACHE_CHUNK_BYTES);
  assert(store->write_count < sizeof(store->writes) / sizeof(store->writes[0]));
  store->writes[store->write_count++] = index;
  const bool fail = store->fail_write == store->write_count;
  const size_t count = fail && length ? length - 1 : length;
  memcpy(store->bytes[index], buffer, count);
  store->length[index] = (int)count;
  return (int)count;
}
static void remove_bytes(void *context, uint32_t key) {
  Store *store = context;
  store->length[index_of(key)] = -1;
  ++store->removals;
}
static void notify(void *context) { ++((Store *)context)->notifications; }
static WfcConfig config_for(Store *store) {
  return (WfcConfig){
    .storage = {.context = store, .size = size_of, .read = read_bytes,
      .write = write_bytes, .remove = remove_bytes},
    .cache_first_key = FIRST_KEY, .on_changed = notify, .context = store
  };
}
static size_t fixture(const char *name, uint8_t *bytes) {
  char path[100];
  snprintf(path, sizeof(path), "tests/fixtures/%s.bin", name);
  FILE *file = fopen(path, "rb");
  assert(file != NULL);
  const size_t count = fread(bytes, 1, COMPLICATION_MAX_BYTES, file);
  assert(!ferror(file) && feof(file));
  assert(fclose(file) == 0);
  return count;
}
static void put16(uint8_t *bytes, unsigned value) {
  bytes[0] = value; bytes[1] = value >> 8;
}
static void put32(uint8_t *bytes, uint32_t value) {
  for (unsigned i = 0; i < 4; ++i) { bytes[i] = value >> (i * 8); }
}
static void seal(uint8_t *bytes, size_t length) {
  put16(bytes + 2, length);
  put16(bytes + 4, complications_crc16(bytes, length));
}
static size_t maximum_packet(uint8_t *bytes) {
  memset(bytes, 0, COMPLICATION_MAX_BYTES);
  bytes[0] = 2;
  size_t at = COMPLICATION_HEADER_BYTES;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    uint8_t *record = bytes + at;
    record[0] = COMPLICATION_FLAG_TEXT | COMPLICATION_FLAG_BITMAP | COMPLICATION_FLAG_IMAGE;
    record[1] = COMPLICATION_STATUS_READY;
    record[2] = COMPLICATION_MAX_TEXT_BYTES;
    record[3] = record[4] = 24;
    put32(record + 6, NOW);
    put32(record + 10, NOW + 1800);
    put16(record + 14, COMPLICATION_MAX_BITMAP_BYTES);
    memset(record + 20, 'X', COMPLICATION_MAX_TEXT_BYTES);
    record[20 + COMPLICATION_MAX_TEXT_BYTES] = 0xc0;
    at += COMPLICATION_MAX_SLOT_BYTES;
  }
  assert(at == COMPLICATION_MAX_BYTES);
  seal(bytes, at);
  return at;
}
static size_t notice_packet(uint8_t *bytes) {
  const char *texts[] = {"Genesis", "Justice", "Signal", "See you soon", "10%"};
  memset(bytes, 0, COMPLICATION_MAX_BYTES);
  bytes[0] = 2;
  size_t at = COMPLICATION_HEADER_BYTES;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    uint8_t *record = bytes + at;
    record[0] = COMPLICATION_FLAG_TEXT;
    record[1] = COMPLICATION_STATUS_READY;
    record[2] = strlen(texts[i]);
    put32(record + 6, NOW);
    put32(record + 10, NOW + (i == 2 || i == 3 ? 12 : 120));
    memcpy(record + 20, texts[i], record[2]);
    at += 20 + record[2];
  }
  seal(bytes, at);
  return at;
}

int main(void) {
  Store store;
  reset_store(&store);
  WfcConfig config = config_for(&store);
  WatchfaceCore state;
  wfc_init(&state, &config, true, 0);
  assert(state.session_token == 2 && state.phone_connected);
  assert(state.context_rebaseline && state.context_awaiting_baseline);
  assert(!state.has_complications && store.notifications == 0);
  assert(!wfc_load_cache(&state, NOW));

  uint8_t bytes[COMPLICATION_MAX_BYTES];
  size_t length = fixture("complications-v2", bytes);
  assert(wfc_receive_complications(&state, bytes, length, NOW));
  assert(state.has_complications && state.complication_packet_length == length);
  assert(strcmp(state.complications.slots[0].text, "6°C") == 0);
  assert(strcmp(state.complications.slots[1].text, "73%") == 0);
  assert(state.complications.slots[1].display_kind == COMPLICATION_DISPLAY_PRECIPITATION);
  assert(state.was_fresh[0] && state.was_fresh[1]);
  assert(!state.was_fresh[2] && store.notifications == 1);

  WatchfaceCore reopened;
  wfc_init(&reopened, &config, false, state.session_token);
  assert(wfc_load_cache(&reopened, NOW + 100));
  assert(reopened.session_token == 3 && reopened.has_complications);
  assert(reopened.complications.slots[0].confirmed_at == NOW);
  assert(reopened.complications.slots[0].valid_until == NOW + 1800);
  // Loading does not revive contextual/private data or renew timestamps.
  assert(context_mode(&reopened.context, NOW + 100) == CONTEXT_NONE);
  wfc_init(&reopened, &config, true, 0);
  assert(wfc_load_cache(&reopened, NOW + 8000));
  assert(!reopened.was_fresh[0] && !reopened.was_fresh[1]);
  assert(!complication_is_fresh(&reopened.complications.slots[0], NOW + 8000));

  // All eight chunks: last header commit, exact cache round-trip, no settings keys.
  reset_store(&store);
  length = maximum_packet(bytes);
  assert(wfc_receive_complications(&state, bytes, length, NOW));
  assert(store.write_count == WFC_CACHE_CHUNKS);
  for (unsigned i = 0; i < WFC_CACHE_CHUNKS - 1; ++i) { assert(store.writes[i] == i + 1); }
  assert(store.writes[WFC_CACHE_CHUNKS - 1] == 0);
  wfc_init(&reopened, &config, true, 3);
  assert(wfc_load_cache(&reopened, NOW + 1));
  assert(memcmp(reopened.complication_packet, bytes, length) == 0);
  assert(reopened.complication_packet_length == length);

  // Interrupted writes erase every cache chunk rather than reviving mixed data.
  for (unsigned fail = 1; fail <= WFC_CACHE_CHUNKS; ++fail) {
    reset_store(&store);
    store.fail_write = fail;
    assert(wfc_receive_complications(&state, bytes, length, NOW));
    assert(state.has_complications); // Failed persistence must not blank live data.
    for (unsigned i = 0; i < WFC_CACHE_CHUNKS; ++i) { assert(store.length[i] == -1); }
    assert(store.removals == WFC_CACHE_CHUNKS);
    wfc_init(&reopened, &config, true, 0);
    assert(!wfc_load_cache(&reopened, NOW));
  }
  reset_store(&store);
  assert(wfc_receive_complications(&state, bytes, length, NOW));
  store.length[3] -= 1;
  wfc_init(&reopened, &config, true, 0);
  assert(!wfc_load_cache(&reopened, NOW));
  assert(!reopened.has_complications);
  bytes[50] ^= 1;
  assert(!wfc_receive_complications(&state, bytes, length, NOW));
  assert(!state.has_complications && state.complication_packet_length == 0);
  for (unsigned i = 0; i < WFC_CACHE_CHUNKS; ++i) { assert(store.length[i] == -1); }

  // Shared independent JavaScript binary fixture parses identically in native C.
  length = fixture("context-v2", bytes);
  assert(wfc_receive_context(&state, bytes, length, 1));
  assert(context_mode(&state.context, NOW) == CONTEXT_MUSIC);
  assert(context_phone_battery(&state.context.slots[4], NOW, NULL));

  length = notice_packet(bytes);
  assert(wfc_receive_context(&state, bytes, length, 1));
  assert(state.context_awaiting_baseline);
  assert(context_mode(&state.context, NOW) == CONTEXT_MUSIC);
  assert(wfc_receive_context(&state, bytes, length, state.session_token));
  assert(!state.context_awaiting_baseline);
  assert(context_mode(&state.context, NOW) == CONTEXT_NOTIFICATION);
  assert(wfc_request_marker(&state) == state.session_token);
  wfc_request_accepted(&state, NOW);
  assert(state.last_request_at == NOW);
  assert(wfc_connection_changed(&state, false));
  assert(context_mode(&state.context, NOW) == CONTEXT_NONE);
  assert(state.context_awaiting_baseline && state.context_rebaseline);
  // An ACK for a pre-disconnect generation cannot satisfy the next handshake.
  wfc_request_acknowledged(&state);
  assert(state.context_rebaseline);
  assert(!wfc_receive_context(&state, bytes, length, state.session_token));
  assert(!wfc_connection_changed(&state, false));
  const uint32_t previous = state.session_token;
  assert(wfc_connection_changed(&state, true));
  assert(state.session_token == previous + 1);
  assert(wfc_request_marker(&state) == state.session_token);
  wfc_request_acknowledged(&state);
  assert(!state.context_rebaseline && state.context_awaiting_baseline);
  assert(wfc_receive_context(&state, bytes, length, previous));
  assert(state.context_awaiting_baseline && context_mode(&state.context, NOW) == CONTEXT_MUSIC);
  bytes[40] ^= 1;
  assert(!wfc_receive_context(&state, bytes, length, state.session_token));
  assert(state.context_awaiting_baseline && context_mode(&state.context, NOW) == CONTEXT_NONE);
  bytes[40] ^= 1;
  assert(wfc_receive_context(&state, bytes, length, state.session_token));
  assert(!state.context_awaiting_baseline);
  assert(wfc_request_marker(&state) == 1);
  assert(wfc_prune_context(&state, NOW + 11) == NOW + 12);
  assert(context_mode(&state.context, NOW + 11) == CONTEXT_NOTIFICATION);
  assert(wfc_prune_context(&state, NOW + 12) == NOW + 120);
  assert(context_mode(&state.context, NOW + 12) == CONTEXT_MUSIC);
  assert(wfc_prune_context(&state, NOW + 120) == 0);
  assert(context_mode(&state.context, NOW + 120) == CONTEXT_NONE);
  const unsigned events = store.notifications;
  assert(wfc_prune_context(&state, NOW + 120) == 0 && store.notifications == events);
  wfc_context_query(&state);
  assert(state.context_rebaseline);
  assert(wfc_request_marker(&state) == state.session_token);
  wfc_request_failed(&state);
  wfc_request_acknowledged(&state);
  assert(state.context_rebaseline);

  // Ready -> stale requests once; denied/empty statuses cannot create polling.
  length = fixture("complications-v2", bytes);
  reset_store(&store);
  assert(wfc_receive_complications(&state, bytes, length, NOW));
  wfc_request_accepted(&state, NOW + 1700);
  assert(!wfc_tick(&state, NOW + 1799));
  assert(wfc_tick(&state, NOW + 1800));
  assert(!wfc_tick(&state, NOW + 1801));
  assert(!wfc_tick(&state, NOW + 3499));
  assert(wfc_tick(&state, NOW + 3500));
  assert(wfc_connection_changed(&state, false));
  assert(!wfc_tick(&state, NOW + 3501));

  // No storage callbacks is an explicitly supported RAM-only consumer.
  wfc_init(&reopened, NULL, true, CONTEXT_MAX_SESSION_TOKEN);
  assert(reopened.session_token == 2);
  assert(!wfc_load_cache(&reopened, NOW));
  assert(wfc_receive_complications(&reopened, bytes, length, NOW));
  assert(reopened.has_complications);
  assert(!wfc_receive_complications(&reopened, NULL, 0, NOW));
  wfc_clear_cache(&reopened);
  return 0;
}
