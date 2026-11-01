#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../include/context_data.h"

static const uint32_t NOW = 1793433600;

static void put16(uint8_t *at, unsigned value) {
  at[0] = value; at[1] = value >> 8;
}
static void put32(uint8_t *at, uint32_t value) {
  for (unsigned i = 0; i < 4; ++i) { at[i] = value >> (i * 8); }
}

// The independent fixture builds a complete mixed music/notification/status
// snapshot and seals the standard complication checksum.
static size_t fixture(uint8_t *bytes, size_t records[5]) {
  const char *texts[] = {"Genesis", "Justice", "Signal · Alex", "See you soon", "0%"};
  size_t length = 6;
  memset(bytes, 0, COMPLICATION_MAX_BYTES);
  bytes[0] = 1;
  for (unsigned i = 0; i < 5; ++i) {
    records[i] = length;
    uint8_t *at = bytes + length;
    at[0] = COMPLICATION_FLAG_TEXT;
    at[1] = COMPLICATION_STATUS_READY;
    at[2] = strlen(texts[i]);
    put32(at + 6, NOW);
    put32(at + 10, NOW + (i == 2 || i == 3 ? 12 : 120));
    memcpy(at + 20, texts[i], at[2]);
    length += 20 + at[2];
  }
  put16(bytes + 2, length);
  put16(bytes + 4, complications_crc16(bytes, length));
  return length;
}
static void assert_rejected(uint8_t *bytes, size_t length) {
  put16(bytes + 4, complications_crc16(bytes, length));
  ComplicationSet output, original;
  memset(&output, 0xa5, sizeof(output));
  original = output;
  assert(!context_read(bytes, length, &output));
  assert(memcmp(&output, &original, sizeof(output)) == 0);
}

int main(void) {
  assert(context_next_session_token(0) == 2);
  assert(context_next_session_token(1) == 2);
  assert(context_next_session_token(2) == 3);
  assert(context_next_session_token(CONTEXT_MAX_SESSION_TOKEN - 1) == CONTEXT_MAX_SESSION_TOKEN);
  assert(context_next_session_token(CONTEXT_MAX_SESSION_TOKEN) == 2);
  assert(context_next_session_token(UINT32_MAX) == 2);
  assert(context_session_token_matches(2, 2));
  assert(context_session_token_matches(CONTEXT_MAX_SESSION_TOKEN, CONTEXT_MAX_SESSION_TOKEN));
  assert(!context_session_token_matches(1, 1));
  assert(!context_session_token_matches(2, 3));
  assert(!context_session_token_matches(3, 2));
  assert(!context_session_token_matches(UINT32_MAX, UINT32_MAX));
  uint8_t bytes[COMPLICATION_MAX_BYTES];
  size_t records[5];
  size_t length = fixture(bytes, records);
  ComplicationSet data;
  assert(context_read(bytes, length, &data));
  bytes[0] = 2;
  put16(bytes + 4, complications_crc16(bytes, length));
  assert(context_read(bytes, length, &data));
  bytes[records[0] + 5] = COMPLICATION_DISPLAY_PRECIPITATION;
  assert_rejected(bytes, length);
  length = fixture(bytes, records);
  assert(context_mode(&data, NOW) == CONTEXT_NOTIFICATION);
  assert(context_next_expiry(&data, NOW) == NOW + 12);
  assert(context_mode(&data, NOW + 11) == CONTEXT_NOTIFICATION);
  assert(context_mode(&data, NOW + 12) == CONTEXT_MUSIC);
  assert(context_next_expiry(&data, NOW + 12) == NOW + 120);
  assert(context_mode(&data, NOW + 120) == CONTEXT_NONE);
  assert(context_next_expiry(&data, NOW + 120) == 0);
  assert(context_mode(NULL, NOW) == CONTEXT_NONE);
  assert(context_next_expiry(NULL, NOW) == 0);
  // Before the reconnect handshake, old queued notices cannot replay. Other
  // current readings are still usable. Only a valid marked frame opens it.
  bool awaiting = true;
  assert(context_receive(bytes, length, &data, &awaiting, false));
  assert(awaiting && context_mode(&data, NOW) == CONTEXT_MUSIC);
  assert(data.slots[2].status == COMPLICATION_STATUS_EMPTY);
  assert(data.slots[3].status == COMPLICATION_STATUS_EMPTY);
  assert(context_phone_battery(&data.slots[4], NOW, NULL));
  bytes[50] ^= 1;
  assert(!context_receive(bytes, length, &data, &awaiting, true));
  assert(awaiting && context_mode(&data, NOW) == CONTEXT_MUSIC);
  bytes[50] ^= 1;
  assert(context_receive(bytes, length, &data, &awaiting, true));
  assert(!awaiting && context_mode(&data, NOW) == CONTEXT_NOTIFICATION);
  assert(context_receive(bytes, length, &data, &awaiting, false));
  assert(!awaiting && context_mode(&data, NOW) == CONTEXT_NOTIFICATION);
  awaiting = true; // A later connection epoch must establish the baseline again.
  assert(context_receive(bytes, length, &data, &awaiting, context_session_token_matches(2, 3)));
  assert(awaiting && context_mode(&data, NOW) == CONTEXT_MUSIC);
  assert(context_receive(bytes, length, &data, &awaiting, context_session_token_matches(3, 3)));
  assert(!context_receive(bytes, length, NULL, &awaiting, true));
  assert(!context_receive(bytes, length, &data, NULL, true));
  unsigned percent = 99;
  assert(context_phone_battery(&data.slots[4], NOW, &percent) && percent == 0);
  assert(!context_phone_battery(&data.slots[4], NOW + 120, NULL));
  assert(!context_phone_battery(&data.slots[4], NOW - 31, NULL));
  assert(context_mode(&data, NOW - 31) == CONTEXT_NONE);

  // A notification cannot gain a two-minute music lease, or remain through a
  // normal generic complication cache window.
  length = fixture(bytes, records);
  put32(bytes + records[2] + 10, NOW + 13);
  assert_rejected(bytes, length);
  length = fixture(bytes, records);
  put32(bytes + records[3] + 10, NOW + 120);
  assert_rejected(bytes, length);
  length = fixture(bytes, records);
  put32(bytes + records[0] + 10, NOW + 121);
  assert_rejected(bytes, length);
  length = fixture(bytes, records);
  put32(bytes + records[4] + 10, NOW + 7200);
  assert_rejected(bytes, length);

  // No timestamp may be smuggled in as a media title or phone percentage.
  length = fixture(bytes, records);
  bytes[records[1]] |= COMPLICATION_FLAG_TIMESTAMP;
  put32(bytes + records[1] + 16, NOW + 10);
  assert_rejected(bytes, length);

  // Percentages are a narrow low-battery status value, not arbitrary text.
  length = fixture(bytes, records);
  bytes[records[4] + 20] = 'x';
  assert_rejected(bytes, length);
  length = fixture(bytes, records);
  bytes[records[4] + 21] = 'x';
  assert_rejected(bytes, length);
  length = fixture(bytes, records);
  bytes[records[4] + 20] = '9';
  put16(bytes + 4, complications_crc16(bytes, length));
  assert(context_read(bytes, length, &data));
  assert(context_phone_battery(&data.slots[4], NOW, &percent) && percent == 9);

  // A valid empty packet immediately releases all transient display state.
  memset(bytes, 0, 106);
  bytes[0] = 1;
  put16(bytes + 2, 106);
  put16(bytes + 4, complications_crc16(bytes, 106));
  assert(context_read(bytes, 106, &data));
  assert(context_mode(&data, NOW) == CONTEXT_NONE);
  assert(!context_phone_battery(&data.slots[4], NOW, NULL));
  bytes[50] ^= 1;
  assert(!context_read(bytes, 106, &data));

  FILE *v3 = fopen("tests/fixtures/context-v3.bin", "rb"); assert(v3);
  length = fread(bytes, 1, sizeof(bytes), v3); fclose(v3);
  assert(context_read(bytes,length,&data));
  assert(data.slots[0].pixel_bytes == 800 && data.slots[0].text_length > 48);
  assert(context_mode(&data,NOW) == CONTEXT_NOTIFICATION);
  awaiting = true;
  assert(context_receive(bytes,length,&data,&awaiting,false));
  assert(data.slots[2].flags == 0 && data.slots[3].flags == 0);
  assert(context_mode(&data,NOW) == CONTEXT_MUSIC);
  FILE *v4 = fopen("tests/fixtures/context-v4.bin","rb");assert(v4);
  length=fread(bytes,1,sizeof(bytes),v4);fclose(v4);
  assert(context_read(bytes,length,&data));
  assert(strcmp(data.slots[2].text,"Xef")==0&&strcmp(data.slots[2].label,"Signal")==0);
  assert(data.slots[4].detail==COMPLICATION_DETAIL_PHONE_BATTERY);
  assert(context_mode(&data,NOW)==CONTEXT_NOTIFICATION);
  awaiting=true;assert(context_receive(bytes,length,&data,&awaiting,false));
  assert(data.slots[2].flags==0&&data.slots[2].label[0]==0);
  assert(context_mode(&data,NOW)==CONTEXT_MUSIC);
  return 0;
}
