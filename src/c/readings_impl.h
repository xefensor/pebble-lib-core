/* Shared implementation for the legacy and lean native state types.
 * Included once per translation unit with a concrete type and function prefix.
 * There are no layout casts, SDK callbacks or context allocations here. */

static void changed(WFC_READINGS_TYPE *state) {
  if (state->config.on_changed != NULL) { state->config.on_changed(state->config.context); }
}

static void record_freshness(WFC_READINGS_TYPE *state, time_t now) {
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    state->was_fresh[i] = state->has_complications &&
        complication_is_fresh(&state->complications.slots[i], now);
  }
}

void WFC_READINGS_FN(clear_cache)(WFC_READINGS_TYPE *state) {
  if (state->config.storage.remove == NULL) { return; }
  for (unsigned i = 0; i < WFC_CACHE_CHUNKS; ++i) {
    state->config.storage.remove(state->config.storage.context, state->config.cache_first_key + i);
  }
}

static bool save_cache(WFC_READINGS_TYPE *state) {
  const WfcStorage *storage = &state->config.storage;
  if (storage->write == NULL || storage->remove == NULL) { return false; }
  if (!state->complication_packet_length) { return false; }
  const size_t count = (state->complication_packet_length + WFC_CACHE_CHUNK_BYTES - 1) /
      WFC_CACHE_CHUNK_BYTES;
  // Commit the header chunk last; torn writes cannot revive a mixed snapshot.
  for (size_t pass = 1; pass <= count; ++pass) {
    const size_t index = pass == count ? 0 : pass;
    const size_t offset = index * WFC_CACHE_CHUNK_BYTES;
    const size_t remaining = state->complication_packet_length - offset;
    const size_t length = remaining < WFC_CACHE_CHUNK_BYTES ? remaining : WFC_CACHE_CHUNK_BYTES;
    if (storage->write(storage->context, state->config.cache_first_key + index,
                       state->complication_packet + offset, length) != (int)length) {
      WFC_READINGS_FN(clear_cache)(state);
      return false;
    }
  }
  for (size_t i = count; i < WFC_CACHE_CHUNKS; ++i) {
    storage->remove(storage->context, state->config.cache_first_key + i);
  }
  return true;
}

// Persist scalar values and metadata, never large bitmap or private payloads.
// Incoming bytes have already passed the complete decoder before this copy.
static size_t cache_packet(const uint8_t *input, size_t length, uint8_t *output,
                           size_t capacity) {
  // Legacy live snapshots remain readable, but their unknown source identity
  // cannot establish that a value is safe to persist.
  if (input[0] != 3 && input[0] != 4) return 0;
  const size_t header = complications_record_header_bytes(input[0]);
  if (capacity < COMPLICATION_HEADER_BYTES) return 0;
  memmove(output, input, COMPLICATION_HEADER_BYTES);
  size_t from = COMPLICATION_HEADER_BYTES, to = COMPLICATION_HEADER_BYTES;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    const uint8_t *record = input + from;
    const unsigned flags = record[0];
    const size_t text = record[2];
    const size_t metadata = input[0] >= 3 ? record[22] + record[23] : 0;
    const size_t bitmap = flags & COMPLICATION_FLAG_BITMAP
        ? COMPLICATION_PALETTE_BYTES + complications_u16(record + 14) : 0;
    const size_t retained = header + text + metadata;
    const size_t next = from + retained + bitmap;
    if (next > length || to + retained > capacity) return 0;
    const bool private_source = record[24] == COMPLICATION_SOURCE_MUSIC ||
                                record[24] == COMPLICATION_SOURCE_NOTIFICATION;
    if (private_source) {
      memset(output + to, 0, header);
      output[to + 1] = COMPLICATION_STATUS_UNAVAILABLE;
      to += header;
    } else if (record[1] == COMPLICATION_STATUS_READY &&
               !(flags & (COMPLICATION_FLAG_TEXT | COMPLICATION_FLAG_TIMESTAMP))) {
      // An image-only reading has no cached value. V4 can still retain its
      // public identity; copy before clearing so in-place compaction is safe.
      if (input[0] == 4) {
        memmove(output + to,record,retained);
        memset(output + to,0,20); output[to + 1]=COMPLICATION_STATUS_UNAVAILABLE;
        output[to + 21]=0; memset(output + to + 28,0,28);
        to += retained;
      } else {
        memset(output + to,0,header); output[to + 1]=COMPLICATION_STATUS_UNAVAILABLE;
        to += header;
      }
    } else {
      memmove(output + to, record, retained);
      output[to] &= ~(COMPLICATION_FLAG_BITMAP | COMPLICATION_FLAG_IMAGE);
      output[to + 3] = output[to + 4] = 0;
      output[to + 14] = output[to + 15] = 0;
      to += retained;
    }
    from = next;
  }
  if (from != length || to > UINT16_MAX) return 0;
  output[2] = (uint8_t)to; output[3] = (uint8_t)(to >> 8);
  const uint16_t crc = complications_crc16(output, to);
  output[4] = (uint8_t)crc; output[5] = (uint8_t)(crc >> 8);
  return to;
}

bool WFC_READINGS_FN(load_cache)(WFC_READINGS_TYPE *state, time_t now) {
  const WfcStorage *storage = &state->config.storage;
  if (storage->size == NULL || storage->read == NULL) { return false; }
  const uint32_t first_key = state->config.cache_first_key;
  const int first_length = storage->size(storage->context, first_key);
  if (first_length < COMPLICATION_HEADER_BYTES || first_length > WFC_CACHE_CHUNK_BYTES ||
      storage->read(storage->context, first_key, state->complication_packet,
                    WFC_CACHE_CHUNK_BYTES) != first_length) { return false; }
  if (state->complication_packet[0] != 3 && state->complication_packet[0] != 4) {
    state->has_complications = false; state->complication_packet_length = 0;
    memset(&state->complications, 0, sizeof(state->complications));
    memset(state->was_fresh, 0, sizeof(state->was_fresh));
    memset(state->complication_packet, 0, sizeof(state->complication_packet));
    WFC_READINGS_FN(clear_cache)(state);
    return false;
  }
  const size_t length = complications_u16(state->complication_packet + 2);
  if (length < COMPLICATION_HEADER_BYTES || length > WFC_CACHE_BYTES ||
      first_length != (int)(length < WFC_CACHE_CHUNK_BYTES ? length : WFC_CACHE_CHUNK_BYTES)) {
    return false;
  }
  const size_t count = (length + WFC_CACHE_CHUNK_BYTES - 1) / WFC_CACHE_CHUNK_BYTES;
  for (size_t i = 1; i < count; ++i) {
    const size_t offset = i * WFC_CACHE_CHUNK_BYTES;
    const size_t remaining = length - offset;
    const size_t chunk = remaining < WFC_CACHE_CHUNK_BYTES ? remaining : WFC_CACHE_CHUNK_BYTES;
    if (storage->size(storage->context, first_key + i) != (int)chunk ||
        storage->read(storage->context, first_key + i,
                      state->complication_packet + offset, chunk) != (int)chunk) { return false; }
  }
  if (!complications_read(state->complication_packet, length, &state->complications)) { return false; }
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    if (state->complications.slots[i].source_kind == COMPLICATION_SOURCE_MUSIC ||
        state->complications.slots[i].source_kind == COMPLICATION_SOURCE_NOTIFICATION) {
      state->has_complications = false; state->complication_packet_length = 0;
      memset(state->was_fresh, 0, sizeof(state->was_fresh));
      memset(&state->complications, 0, sizeof(state->complications));
      memset(state->complication_packet, 0, sizeof(state->complication_packet));
      WFC_READINGS_FN(clear_cache)(state);
      return false;
    }
  }
  state->has_complications = true;
  state->complication_packet_length = length;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i)
    state->complications.slots[i].cached = state->complications.slots[i].status == COMPLICATION_STATUS_READY;
  record_freshness(state, now);
  changed(state);
  return true;
}

bool WFC_READINGS_RECEIVE(WFC_READINGS_TYPE *state, const uint8_t *bytes,
                               size_t length, time_t now) {
  if (length <= COMPLICATION_MAX_BYTES && complications_read(bytes, length, &state->complications)) {
    state->has_complications = true;
    state->complication_packet_length = cache_packet(bytes, length, state->complication_packet,
                                                    sizeof(state->complication_packet));
    record_freshness(state, now);
    if (state->complication_packet_length) save_cache(state);
    else WFC_READINGS_FN(clear_cache)(state);
    changed(state);
    return true;
  }
  state->has_complications = false;
  state->complication_packet_length = 0;
  memset(&state->complications, 0, sizeof(state->complications));
  memset(state->was_fresh, 0, sizeof(state->was_fresh));
  WFC_READINGS_FN(clear_cache)(state);
  changed(state);
  return false;
}

bool WFC_READINGS_FN(tick)(WFC_READINGS_TYPE *state, time_t now) {
  bool expired = false;
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    const bool fresh = state->has_complications && complication_is_fresh(&state->complications.slots[i], now);
    if (state->was_fresh[i] && !fresh && state->complications.slots[i].status == COMPLICATION_STATUS_READY) {
      expired = true;
    }
    state->was_fresh[i] = fresh;
  }
  if (expired) { changed(state); }
  return expired || (state->phone_connected && now >= state->last_request_at + WFC_REFRESH_SECONDS);
}

static void clear_private_readings(WFC_READINGS_TYPE *state) {
  for (unsigned i = 0; i < COMPLICATION_SLOT_COUNT; ++i) {
    ComplicationSlot *slot = &state->complications.slots[i];
    if (complication_is_selected(slot) &&
        (slot->source_kind == COMPLICATION_SOURCE_GENERIC ||
         slot->source_kind == COMPLICATION_SOURCE_MUSIC ||
         slot->source_kind == COMPLICATION_SOURCE_NOTIFICATION)) {
      memset(slot, 0, sizeof(*slot));
      slot->status = COMPLICATION_STATUS_UNAVAILABLE;
      state->was_fresh[i] = false;
    }
  }
}
