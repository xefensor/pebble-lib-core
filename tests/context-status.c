#include <assert.h>
#include "../include/readings.h"
#include "../include/context_data.h"

static void u32(uint8_t *out, uint32_t value) {
  for (unsigned i=0;i<4;++i) out[i]=(uint8_t)(value>>(8*i));
}
static void seal(uint8_t *bytes, size_t length) {
  bytes[2]=(uint8_t)length;bytes[3]=(uint8_t)(length>>8);
  const uint16_t crc=complications_crc16(bytes,length);
  bytes[4]=(uint8_t)crc;bytes[5]=(uint8_t)(crc>>8);
}
static size_t packet(uint8_t *bytes, unsigned version, bool ready) {
  memset(bytes,0,512);bytes[0]=(uint8_t)version;
  const size_t header=complications_record_header_bytes(version);
  size_t at=COMPLICATION_HEADER_BYTES;
  for(unsigned i=0;i<5;++i) {
    uint8_t *r=bytes+at;
    if(i<4 || ready) {
      const char *text=i==4?"15%":"Private";
      r[0]=COMPLICATION_FLAG_TEXT;r[1]=COMPLICATION_STATUS_READY;
      r[2]=(uint8_t)strlen(text);u32(r+6,100);u32(r+10,108);
      memcpy(r+header,text,r[2]);
    }
    at+=header+r[2];
  }
  seal(bytes,at);return at;
}
int main(void) {
  uint8_t bytes[512];WfcPhoneStatus status;
  assert(sizeof(status)<=12);
  for(unsigned version=1;version<=4;++version) {
    size_t length=packet(bytes,version,true);
    assert(wfc_context_phone_status_read(bytes,length,&status));
    assert(status.ready&&status.percent==15&&status.confirmed_at==100&&status.valid_until==108);
    assert(wfc_phone_status_fresh(&status,101));
    assert(wfc_phone_status_fresh(&status,70));
    assert(!wfc_phone_status_fresh(&status,69));
    assert(!wfc_phone_status_fresh(&status,108));
    assert(wfc_context_phone_status_read(bytes,length,NULL));
    WfcPhoneStatus before=status;
    // Validate discarded private roles too, even with a correct CRC.
    bytes[COMPLICATION_HEADER_BYTES+5]=COMPLICATION_DISPLAY_PRECIPITATION;
    seal(bytes,length);
    assert(!wfc_context_phone_status_read(bytes,length,&status));
    assert(!memcmp(&before,&status,sizeof(status)));
    length=packet(bytes,version,false);
    assert(wfc_context_phone_status_read(bytes,length,&status));
    assert(complications_zero((const uint8_t *)&status,sizeof(status)));
    length=packet(bytes,version,true);bytes[length-1]^=1;
    assert(!wfc_context_phone_status_read(bytes,length,&status));
    assert(!wfc_context_phone_status_read(bytes,length-1,&status));
  }
  assert(!wfc_context_phone_status_read(NULL,0,&status));
  return 0;
}
