#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../include/readings.h"
#include "../include/pebble-watchface-core.h"

#define FIRST_KEY 72
static const time_t NOW = 1793433600;
typedef struct {
  uint8_t bytes[WFC_CACHE_CHUNKS][WFC_CACHE_CHUNK_BYTES];
  int lengths[WFC_CACHE_CHUNKS];
  unsigned changes;
} Store;
static unsigned index_of(uint32_t key) {
  assert(key >= FIRST_KEY && key < FIRST_KEY + WFC_CACHE_CHUNKS);
  return key - FIRST_KEY;
}
static int size_of(void *context, uint32_t key) {
  return ((Store *)context)->lengths[index_of(key)];
}
static int read_bytes(void *context, uint32_t key, void *output, size_t capacity) {
  Store *store=context; const unsigned index=index_of(key);
  if (store->lengths[index] < 0) return -1;
  const size_t length=(size_t)store->lengths[index];
  if (length > capacity) return -1;
  memcpy(output,store->bytes[index],length);return (int)length;
}
static int write_bytes(void *context, uint32_t key, const void *input, size_t length) {
  Store *store=context; const unsigned index=index_of(key);
  assert(length <= WFC_CACHE_CHUNK_BYTES);
  memcpy(store->bytes[index],input,length);store->lengths[index]=(int)length;
  return (int)length;
}
static void remove_bytes(void *context, uint32_t key) {
  ((Store *)context)->lengths[index_of(key)]=-1;
}
static void changed(void *context) { ++((Store *)context)->changes; }
static size_t fixture(const char *name,uint8_t *bytes) {
  char path[100];snprintf(path,sizeof(path),"tests/fixtures/%s.bin",name);
  FILE *file=fopen(path,"rb");assert(file);
  const size_t size=fread(bytes,1,COMPLICATION_MAX_BYTES,file);
  assert(!ferror(file)&&feof(file)&&fclose(file)==0);return size;
}
int main(void) {
  Store store={0};
  for(unsigned i=0;i<WFC_CACHE_CHUNKS;i++)store.lengths[i]=-1;
  const WfcConfig config={.storage={.context=&store,.size=size_of,.read=read_bytes,
    .write=write_bytes,.remove=remove_bytes},.cache_first_key=FIRST_KEY,
    .on_changed=changed,.context=&store};
  WfcReadings lean,reopened;
  WatchfaceCore legacy;
  uint8_t bytes[COMPLICATION_MAX_BYTES];
  wfc_readings_init(&lean,&config,true);
  assert(lean.phone_connected&&!lean.has_complications&&!store.changes);
  assert(sizeof(WatchfaceCore)-sizeof(WfcReadings)>=sizeof(ComplicationSet));
  assert(!wfc_readings_load_cache(&lean,NOW));

  // The new entrypoint consumes the released wire and original cache namespace.
  size_t length=fixture("complications-v4",bytes);
  wfc_init(&legacy,&config,true,0);
  assert(wfc_receive_complications(&legacy,bytes,length,NOW));
  assert(wfc_readings_load_cache(&lean,NOW+1));
  assert(lean.complications.slots[0].confirmed_at==(uint32_t)NOW);
  assert(lean.complications.slots[0].observed_at==(uint32_t)NOW-300);
  assert(lean.complications.slots[0].cached);
  assert(strcmp(lean.complications.slots[0].text,legacy.complications.slots[0].text)==0);
  assert(wfc_readings_receive(&lean,bytes,length,NOW+2));
  assert(!lean.complications.slots[0].cached);
  wfc_init(&legacy,&config,false,0);
  assert(wfc_load_cache(&legacy,NOW+3));
  assert(strcmp(lean.complications.slots[0].text,legacy.complications.slots[0].text)==0);

  // Source permission boundaries also apply when a private source was selected
  // as an ordinary reading. An activity engine does not change this contract.
  length=fixture("context-v4",bytes);
  assert(wfc_readings_receive(&lean,bytes,length,NOW));
  wfc_readings_init(&reopened,&config,false);
  assert(wfc_readings_load_cache(&reopened,NOW+1));
  for(unsigned i=0;i<4;i++) {
    assert(!reopened.complications.slots[i].flags);
    assert(!reopened.complications.slots[i].text[0]);
  }
  assert(wfc_readings_connection_changed(&lean,false));
  for(unsigned i=0;i<4;i++)assert(!lean.complications.slots[i].flags);
  const unsigned changes=store.changes;
  assert(!wfc_readings_connection_changed(&lean,false)&&store.changes==changes);

  // Malformed transfers clear live readings and all persistent chunks.
  assert(!wfc_readings_receive(&lean,NULL,0,NOW));
  assert(!lean.has_complications&&!lean.complication_packet_length);
  for(unsigned i=0;i<WFC_CACHE_CHUNKS;i++)assert(store.lengths[i]==-1);

  // Expiry asks once; the host owns request delivery and the refresh timestamp.
  length=fixture("complications-v3",bytes);
  wfc_readings_init(&lean,NULL,true);
  assert(wfc_readings_receive(&lean,bytes,length,NOW));
  wfc_readings_request_accepted(&lean,NOW+1700);
  assert(!wfc_readings_tick(&lean,NOW+1799));
  assert(wfc_readings_tick(&lean,NOW+1800));
  assert(!wfc_readings_tick(&lean,NOW+1801));
  assert(wfc_readings_tick(&lean,NOW+3500));
  assert(wfc_readings_connection_changed(&lean,false));
  assert(!wfc_readings_tick(&lean,NOW+3501));
  wfc_readings_clear_cache(&lean); // RAM-only consumers are supported.
  return 0;
}
