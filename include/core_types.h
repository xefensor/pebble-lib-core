#pragma once

#include "complication_data.h"

#define WFC_CACHE_CHUNKS 8
#define WFC_CACHE_CHUNK_BYTES 256
#define WFC_CACHE_BYTES (WFC_CACHE_CHUNKS * WFC_CACHE_CHUNK_BYTES)
#define WFC_REFRESH_SECONDS (30 * 60)

typedef struct {
  void *context;
  int (*size)(void *context, uint32_t key);
  int (*read)(void *context, uint32_t key, void *buffer, size_t length);
  int (*write)(void *context, uint32_t key, const void *buffer, size_t length);
  void (*remove)(void *context, uint32_t key);
} WfcStorage;

typedef struct {
  WfcStorage storage;
  uint32_t cache_first_key;
  void (*on_changed)(void *context);
  void *context;
} WfcConfig;

