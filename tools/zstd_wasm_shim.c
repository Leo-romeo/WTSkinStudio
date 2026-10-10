/*
 * WASM shim around zstd's single-file decoder.
 *
 * Exports just enough to decode War Thunder's dictionary-compressed BLKs from a
 * browser: a persistent DCtx + DDict pair (the game's `<sha>.dict` is digested
 * once and reused across thousands of files) and one allocating decode call that
 * copes with frames whose content size is not recorded in the header.
 */
#include <stdint.h>
#include <stdlib.h>

#include "zstddeclib.c"

#define EXPORT __attribute__((visibility("default"), used))

EXPORT void *zdec_malloc(uint32_t n) { return malloc(n); }
EXPORT void zdec_free(void *p) { free(p); }

EXPORT void *zdec_dctx_new(void) { return ZSTD_createDCtx(); }
EXPORT void zdec_dctx_free(void *c) { ZSTD_freeDCtx((ZSTD_DCtx *)c); }

EXPORT void *zdec_ddict_new(const void *dict, uint32_t dictSize) {
  return ZSTD_createDDict(dict, dictSize);
}
EXPORT void zdec_ddict_free(void *d) { ZSTD_freeDDict((ZSTD_DDict *)d); }

/* Decode one frame into a freshly malloc'd buffer. On success writes the buffer
 * pointer to out[0] and its length to out[1] and returns 0; the caller owns the
 * buffer and must zdec_free it. Negative return = failure, out[] left zeroed. */
EXPORT int32_t zdec_decompress(void *dctxp, void *ddictp, const void *src,
                               uint32_t srcSize, uint32_t *out) {
  ZSTD_DCtx *dctx = (ZSTD_DCtx *)dctxp;
  size_t rc;
  out[0] = 0;
  out[1] = 0;
  if (!dctx || !src || !srcSize) return -1;

  rc = ZSTD_DCtx_reset(dctx, ZSTD_reset_session_only);
  if (ZSTD_isError(rc)) return -2;
  if (ddictp) {
    rc = ZSTD_DCtx_refDDict(dctx, (const ZSTD_DDict *)ddictp);
    if (ZSTD_isError(rc)) return -3;
  }

  unsigned long long hint = ZSTD_getFrameContentSize(src, srcSize);
  size_t cap;
  if (hint == ZSTD_CONTENTSIZE_ERROR) return -4;
  if (hint == ZSTD_CONTENTSIZE_UNKNOWN || hint == 0)
    cap = (size_t)srcSize * 4 + 4096;
  else
    cap = (size_t)hint;

  char *buf = (char *)malloc(cap);
  if (!buf) return -5;

  ZSTD_inBuffer in = {src, srcSize, 0};
  ZSTD_outBuffer o = {buf, cap, 0};
  for (;;) {
    size_t left = ZSTD_decompressStream(dctx, &o, &in);
    if (ZSTD_isError(left)) { free(buf); return -6; }
    if (left == 0) break;              /* frame decoded in full */
    if (o.pos == o.size) {             /* content size was unknown/short */
      size_t ncap = cap * 2 + 4096;
      char *nb = (char *)realloc(buf, ncap);
      if (!nb) { free(buf); return -7; }
      buf = nb; cap = ncap;
      o.dst = buf; o.size = cap;
      continue;
    }
    if (in.pos == in.size) { free(buf); return -8; }  /* truncated input */
  }

  out[0] = (uint32_t)(uintptr_t)buf;
  out[1] = (uint32_t)o.pos;
  return 0;
}
