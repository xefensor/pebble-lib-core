#include "readings.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  const char *files[]={"complications-v2","complications-v3","complications-v4",
      "maximum-v3","maximum-v4","image-only-v3","image-only-v4"};
  for(unsigned n=0;n<sizeof(files)/sizeof(*files);++n) {
    char path[160];snprintf(path,sizeof(path),"tests/fixtures/%s.bin",files[n]);
    FILE *file=fopen(path,"rb");assert(file);
    uint8_t bytes[COMPLICATION_MAX_BYTES+1];const size_t length=fread(bytes,1,sizeof(bytes),file);
    assert(length<=COMPLICATION_MAX_BYTES&&!ferror(file)&&feof(file)&&fclose(file)==0);
    ComplicationSet full;ComplicationSlot prefix[2];
    assert(complications_read(bytes,length,&full));
    assert(complications_read_prefix(bytes,length,prefix,2));
    assert(!memcmp(prefix,full.slots,sizeof(prefix)));
    /* A corrupt non-displayed record must reject the whole transfer and leave
     * the previous pair intact, even with a valid envelope checksum. */
    size_t at=COMPLICATION_HEADER_BYTES;
    for(unsigned i=0;i<2;++i) {
      const uint8_t *r=bytes+at;
      at+=complications_record_header_bytes(bytes[0])+r[2]+(bytes[0]>=3?r[22]+r[23]:0)+
          ((r[0]&COMPLICATION_FLAG_BITMAP)?COMPLICATION_PALETTE_BYTES+complications_u16(r+14):0);
    }
    bytes[at+1]=255;
    const uint16_t crc=complications_crc16(bytes,length);bytes[4]=crc;bytes[5]=crc>>8;
    ComplicationSlot previous[2];memcpy(previous,prefix,sizeof(prefix));
    assert(!complications_read_prefix(bytes,length,prefix,2));
    assert(!memcmp(previous,prefix,sizeof(prefix)));
  }
  assert(sizeof(WfcReadings)-sizeof(WfcReadingPair)>=3*sizeof(ComplicationSlot));
  return 0;
}
