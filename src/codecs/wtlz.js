/*==WTLZ==*/
// The project's own decoder for the compressed payloads in War Thunder's asset packs.
//
// THIS FILE IS GENERATED. Do not edit it here. It is src/decoder.mjs of the wt-codec-cleanroom
// repository, exported by that repository's tools/export.mjs:
//
//   source   wt-codec-cleanroom  src/decoder.mjs  @ f4075e467b8f21a08abbd2cc8f5172b30f8457a3
//   sha256   d5f9b909c39e9ee9417e44f5941cf70f318bf4bd4988875288dc58f72228e82e  (of that file, LF line endings)
//   date     2026-09-14
//
// Every format fact in it carries an EVIDENCE tag naming a numbered entry of that repository's
// LOG/, which holds the experiment that established it; that log, and that repository's commit
// history, are the record of independent creation (docs/WTLZ.md). A fix to the decoder goes there
// first — verified against the oracle and the corpus by that repository's tools — and is then
// re-exported; a hand edit here would be a format claim with no experiment behind it.
// `node tools/export.mjs --check <this file>` in that repository says whether this file is still
// exactly what the export writes.
//
// The only mechanical differences from the source: the `export` keywords are gone, the
// `_internals` object that only that repository's experiments use is dropped, and the whole text
// is wrapped in a function so that the page sees exactly one name, WTLZ, with one method:
//
//   WTLZ.decompress(src: Uint8Array, rawSize: number) -> Uint8Array of exactly rawSize bytes
//
// It throws on anything it cannot decode completely and correctly, never returns short output,
// never pads and never guesses. Pure JavaScript, no dependencies, no DOM, no globals of its own —
// which is what lets the decode worker lift this section by its markers (CLAUDE.md §2).
const WTLZ = (function(){
"use strict";
  // A decoder for the compressed-unit format used by War Thunder's asset packs.
  //
  //   decompress(src: Uint8Array, rawSize: number) -> Uint8Array of exactly rawSize bytes
  //
  // Throws on anything it cannot decode completely and correctly. It never returns short output,
  // never pads and never guesses: downstream this becomes a texture or a mesh, and a plausible
  // looking wrong one is undetectable, while a thrown error reaches the user as a message.
  //
  // Pure JavaScript, no dependencies, no build step, no imports.
  //
  // Every format fact carries an EVIDENCE tag naming the LOG/ entry that established it. Nothing in
  // here comes from reading another implementation; `npm run guard` checks that each tag resolves,
  // and the log entry behind each one contains the experiment and its numbers.

  // EVIDENCE: LOG/005 — a single unit emits at most 262144 bytes; 262144 accepted, 262145 refused
  const UNIT_OUTPUT_MAX = 262144;

  // EVIDENCE: LOG/007 — a coded unit is a six-byte header followed by `len` body bytes
  const HEADER_BYTES = 6;

  // EVIDENCE: LOG/008 — stored units carry a two-byte header and then literal output bytes
  const STORED_HEADER_BYTES = 2;

  // EVIDENCE: LOG/004 — `8c 0c 07 ff ff VV` emits the constant byte VV; the 24-bit field is 0x07FFFF
  // EVIDENCE: LOG/008 — 0x07FFFF never collided with a real length across 11,184 units
  const FILL_SENTINEL = 0x07ffff;

  // EVIDENCE: LOG/008 — header byte 0, bit 7: set on the first unit of a stream (1500/1500), clear
  // on every later unit (9684/9684)
  const FLAG_FIRST_UNIT = 0x80;

  // EVIDENCE: LOG/008 — header byte 0, bit 6: the unit is stored, not coded (138 units, 4 checked
  // byte-for-byte against the oracle's output)
  const FLAG_STORED = 0x40;

  // EVIDENCE: LOG/008 — header byte 1 is 0x0c in 11,184 of 11,184 units in the working set
  const HEADER_BYTE1 = 0x0c;

  // EVIDENCE: LOG/043 — byte 0 is the two flags above over a constant 0x0c. The three values that
  // occur are 0x0c, 0x8c and 0x4c, all with 0x0c in the low six bits, and sweeping byte 0 over all
  // 256 values on a fill unit and on a coded unit accepted 0x0c and 0x8c and nothing else.
  const HEADER_BYTE0_MASK = 0x3f;
  const HEADER_BYTE0_CONST = 0x0c;

  /**
   * Split a stream into its top-level units without decoding any of them.
   *
   * Returns an array of descriptors, each naming where the unit's header sits, how many source bytes
   * it occupies, and how many output bytes it produces. Throws if the chain does not fit the source.
   *
   * Exported for the Phase 1 boundary check in tools/. ABI.md wants `decompress` to be the module's
   * only export at Phase 6; this one goes behind a private name then.
   *
   * EVIDENCE: LOG/007 — boundaries located by splice and by prefix-at-exact-length on c000828,
   *   c002829 and c005161; ten boundaries predicted from the header, ten confirmed
   * EVIDENCE: LOG/008 — the three unit kinds, and the chain tiling all 1500 working-set streams with
   *   0..7 bytes of pack padding left over and no overrun
   */
  function parseUnits(src, rawSize) {
    if (!(src instanceof Uint8Array)) throw new TypeError("src must be a Uint8Array");
    if (!Number.isInteger(rawSize) || rawSize < 0)
      throw new RangeError(`rawSize must be a non-negative integer, got ${rawSize}`);

    const units = [];
    let at = 0;      // read cursor in src
    let out = 0;     // write cursor in the output

    while (out < rawSize) {
      if (at + STORED_HEADER_BYTES > src.length)
        throw new Error(`truncated unit header at ${at} (source is ${src.length} bytes)`);

      const b0 = src[at];
      const b1 = src[at + 1];

      // EVIDENCE: LOG/008 — bit 7 marks the first unit; refusing a mismatch is what keeps a stream
      // that is not this format, or a stream resynchronised at the wrong offset, from decoding
      const isFirst = units.length === 0;
      if (((b0 & FLAG_FIRST_UNIT) !== 0) !== isFirst)
        throw new Error(`unit ${units.length} at ${at}: first-unit bit is ${(b0 & FLAG_FIRST_UNIT) ? 1 : 0}`);
      if ((b0 & HEADER_BYTE0_MASK) !== HEADER_BYTE0_CONST)
        throw new Error(`unit ${units.length} at ${at}: header byte 0 is 0x${b0.toString(16)}, low six bits are not 0x0c`);
      if (b1 !== HEADER_BYTE1)
        throw new Error(`unit ${units.length} at ${at}: header byte 1 is 0x${b1.toString(16)}, expected 0x0c`);

      // EVIDENCE: LOG/007 — every unit but the last emits exactly 262144 bytes and the last emits
      // the remainder; boundaries land on exact multiples of 262144
      const emits = Math.min(UNIT_OUTPUT_MAX, rawSize - out);

      if (b0 & FLAG_STORED) {
        const body = at + STORED_HEADER_BYTES;
        if (body + emits > src.length)
          throw new Error(`stored unit at ${at} needs ${emits} bytes, source has ${src.length - body}`);
        units.push({ kind: "stored", at, body, emits, bytes: STORED_HEADER_BYTES + emits });
        at = body + emits;
      } else {
        if (at + HEADER_BYTES > src.length)
          throw new Error(`truncated unit header at ${at} (source is ${src.length} bytes)`);
        // EVIDENCE: LOG/007 — the 24-bit big-endian field at header offsets 2..4 is the body length
        const len = (src[at + 2] << 16) | (src[at + 3] << 8) | src[at + 4];
        if (len === FILL_SENTINEL) {
          units.push({ kind: "fill", at, value: src[at + 5], emits, bytes: HEADER_BYTES });
          at += HEADER_BYTES;
        } else {
          const body = at + HEADER_BYTES;
          if (body + len > src.length)
            throw new Error(`coded unit at ${at} needs ${len} body bytes, source has ${src.length - body}`);
          units.push({ kind: "coded", at, body, len, mode: src[at + 5], emits, bytes: HEADER_BYTES + len });
          at = body + len;
        }
      }
      out += emits;
    }
    return units;
  }


  // EVIDENCE: LOG/013 — a coded unit's body is a chain of chunks; a chunk is a mode byte, a 16-bit
  // big-endian content length and that many content bytes. The first chunk of a unit has no mode
  // byte of its own: the unit header's byte 5 is it.
  const CHUNK_LENGTH_BYTES = 2;

  // EVIDENCE: LOG/013 — one chunk decodes at any output size up to 131072 and refuses above it;
  // 4415 of the 5299 units that tile are two chunks covering the 262144 unit cap of LOG/005
  const CHUNK_OUTPUT_MAX = 131072;

  // EVIDENCE: LOG/013 — a mode with bit 7 set introduces a container chunk: a 16-bit length and that
  //   many content bytes
  // EVIDENCE: LOG/033 — a mode with bit 7 clear introduces an entropy block instead, which carries
  //   its own decoded size and its own compressed size, so it has no chunk-length field. Established
  //   by compressing inputs just over the 131072 cap, where the trailing chunk's decoded size is
  //   known independently: 131272 gave a field of 796 = 4*(200-1) against 200 bytes still owed.
  const MODE_CONTAINER = 0x80;

  // EVIDENCE: LOG/032 — an entropy block is [type][be16 4*(n-1)][be16 clen][payload], where n is the
  //   number of bytes it decodes to. Read off unit bodies for chosen inputs, where n is the input
  //   length: 512 -> 2044, 4096 -> 16380, 8928 -> 35708. The same three fields are a coded
  //   sub-stream's header, with the type in its flag byte.
  // EVIDENCE: LOG/067 — the general form of those five bytes is one big-endian field,
  //   [type: 4 bits][n-1: 18 bits][compressed length: 18 bits]: the type byte's low nibble tops the
  //   decoded length, and the two low bits of LOG/032's "4*(n-1)" top the compressed length. Blocks
  //   of 20000..131072 bytes carry type bytes 0x41, 0x42, 0x44 and 0x47, and a 131072-byte block
  //   with 65569 compressed bytes reads `ff fd 00 21`.
  const BLOCK_HEADER_BYTES = 4;
  const TYPE_NIBBLE = 0xf0;
  const SIZE_HI_NIBBLE = 0x0f;
  const SIZE_SHIFT = 2;
  const CLEN_HI_MASK = 0x03;

  /**
   * Split a coded unit's body into its chunks. Returns null if the chain does not tile the body
   * exactly.
   *
   * A chunk is either a container, whose output size the framing supplies, or an entropy block, whose
   * output size it carries. Both kinds can appear in one chain.
   *
   * EVIDENCE: LOG/013 — the container form, and each container emitting min(131072, bytes still owed)
   * EVIDENCE: LOG/033 — the block form; this walk tiles 5409 of 11025 coded units against LOG/013's
   *   5299, and is the shape the compressor emits for a chunk that is not a container
   * EVIDENCE: LOG/066 — a container's length field is 17 bits, the mode byte's bit 0 being its top
   *   bit; with that, all 11025 coded units of the working set tile, and a chosen 262144-byte input
   *   gives two chunks of 84295 and 84590 content bytes, each introduced by mode 0x89
   */
  function parseChunks(src, u) {
    const end = u.body + u.len;
    const out = [];
    let at = u.body;
    let mode = u.mode;
    let left = u.emits;

    while (left > 0) {
      if (mode & MODE_CONTAINER) {
        if (at + CHUNK_LENGTH_BYTES > end) return null;
        // EVIDENCE: LOG/066 — the seventeenth bit of the length is the mode byte's bit 0
        const len = ((mode & CONTAINER_LENGTH_HI) << 16) | (src[at] << 8) | src[at + 1];
        const content = at + CHUNK_LENGTH_BYTES;
        if (content + len > end) return null;
        const emits = Math.min(CHUNK_OUTPUT_MAX, left);
        out.push({ mode: mode & ~CONTAINER_LENGTH_HI, at, content, len, emits, block: false });
        at = content + len;
        left -= emits;
      } else {
        if (at + BLOCK_HEADER_BYTES > end) return null;
        // EVIDENCE: LOG/067 — [type: 4][n-1: 18][clen: 18], the type byte's low nibble on top
        const field = ((mode & SIZE_HI_NIBBLE) << 16) | (src[at] << 8) | src[at + 1];
        const len = ((field & CLEN_HI_MASK) << 16) | (src[at + 2] << 8) | src[at + 3];
        const content = at + BLOCK_HEADER_BYTES;
        const emits = (field >> SIZE_SHIFT) + 1;
        if (content + len > end || emits > left) return null;
        out.push({ mode: mode & TYPE_NIBBLE, at, content, len, emits, block: true });
        at = content + len;
        left -= emits;
      }
      // EVIDENCE: LOG/013 — one mode byte sits between consecutive chunks and nowhere else
      if (left > 0) {
        if (at >= end) return null;
        mode = src[at++];
      }
      if (out.length > MAX_CHUNKS_PER_UNIT) return null;
    }
    return at === end ? out : null;
  }

  // EVIDENCE: LOG/066 — bit 0 of a container's mode byte is bit 16 of its length field. The working
  //   set's unit modes 0x89, 0x91, 0xa9, 0xa1 and 0x81 are 0x88, 0x90, 0xa8, 0xa0 and 0x80 with a
  //   first chunk longer than 65535 bytes, and 5341 of those 5360 units hold two chunks.
  // EVIDENCE: LOG/097 — and bit 1 is bit 17: a 131072-byte verbatim chunk is mode 0x82 with `00 00`
  const CONTAINER_LENGTH_HI = 0x03;

  // EVIDENCE: LOG/005 — a unit emits at most 262144 bytes and LOG/013 gives a chunk at least one, so
  // no honest chain is longer than this; the bound exists so a mis-parse cannot loop
  const MAX_CHUNKS_PER_UNIT = 4096;


  // EVIDENCE: LOG/025 — the eight raw bytes are not part of a chunk's grammar; they appear once per
  // payload, at output position 0, where the match window has no history yet. 631 of 687 tiling
  // chunks at that position carry them and 1482 of 1658 elsewhere do not.
  const BOOTSTRAP_LITERALS = 8;
  // EVIDENCE: LOG/101 — a chunk ends in at least this many literals
  const TRAILING_LITERALS_MIN = 8;

  // EVIDENCE: LOG/024 — a sub-stream header is a flag byte and then lengths: flag 0x00 takes one
  //   length and carries the payload raw; a flag with a type nibble takes two, the decompressed
  //   length then the compressed one, and carries an entropy-coded payload.
  // EVIDENCE: LOG/067 — the flag is a type nibble over the top nibble of the length field
  // EVIDENCE: LOG/080 — two compact forms, told apart from those by bit 7 of the first byte:
  //   `1000 llll llllllll` is raw bytes with a 12-bit length, and `1ttt dddd dddddddd ddcccccc
  //   cccccccc` is a coded stream of type `t << 4`, clen `c`, decoding to `d + c + 1` bytes.
  //   Fifteen chosen chunks pinned (n, clen) through the oracle; `80 00` is an empty raw item.
  const ITEM_RAW_HEADER_BYTES = 3;
  const ITEM_CODED_HEADER_BYTES = 5;
  const ITEM_COMPACT_FLAG = 0x80;
  const ITEM_COMPACT_RAW_HEADER_BYTES = 2;
  const ITEM_COMPACT_CODED_HEADER_BYTES = 3;
  const COMPACT_TYPE_SHIFT = 4;
  const COMPACT_TYPE_MASK = 0x07;
  const COMPACT_RAW_LENGTH_HI = 0x0f;
  const COMPACT_CLEN_BITS = 10;
  const COMPACT_CLEN_MASK = (1 << COMPACT_CLEN_BITS) - 1;

  // EVIDENCE: LOG/079 — a chunk whose sub-streams begin with a byte `1nnnnnnn` codes every new
  //   distance as `(n + 1) * q + r`: q is the slot code below, read from the first sub-stream with
  //   its extra bits in the bit stream, and r is a byte of a second sub-stream that is present
  //   exactly when n > 0. Fourteen marker values, 63 slot values and both extra-bit fillings, with
  //   the distance read out of the output. LOG/061 skipped this byte; LOG/024's "flag 0x80" was
  //   this marker at n = 0 followed by a compact raw header.
  const STRIDE_MARKER_FLAG = 0x80;
  const STRIDE_MASK = 0x7f;

  // EVIDENCE: LOG/020 — with a plain distance sub-stream the match distance is its byte plus 8,
  //   established by construction at distances 8, 9, 10 and 12 with history to spare, and refused
  //   above the history rather than fitted to the corpus. A chunk with no distance sub-stream keeps
  //   the same arithmetic with a byte of 0, which is the distance 8 of LOG/016 and LOG/018.
  const MATCH_DISTANCE_BIAS = 8;

  // EVIDENCE: LOG/021 — the bit stream begins with the distance entries' extra bits, four per plain
  //   entry; replacing LOG/020's searched start offset with `4 * entries` decodes the same 230 chunks
  //   (none of which has more than one plain entry — LOG/070)
  // EVIDENCE: LOG/028 — those four bits are the distance's high nibble, not padding: with the entry
  //   byte held at 0 the distance ran 8, 24, 40, 56, 72, 136 as the nibble ran 0, 1, 2, 3, 4, 8
  // EVIDENCE: LOG/082 — the entry byte is a slot in families of sixteen: family f = v >> 4 takes
  //   4 + f extra bits, and d = 8 + (v & 15) + 16 * (16 * (2**f - 1) + extra). Measured at every
  //   family boundary to v = 159 (f = 9, 130824) with zero and all-ones extras; LOG/028 is family 0.
  const PLAIN_DISTANCE_EXTRA_BITS = 4;
  const PLAIN_FAMILY_SHIFT = 4;
  const PLAIN_LOW_MASK = 0x0f;
  const PLAIN_STEP = 16;
  // EVIDENCE: LOG/084 — families 10, 11 and 12 measured across four filler units
  // EVIDENCE: LOG/099 — and 13 and 14 across ten and seventeen; 15 would need 8 MB of history,
  //   more than any payload holds, and is refused
  const PLAIN_FAMILY_MAX = 15;

  // The bit stream is two readers, one from each end (LOG/071). What each holds, in read order:
  //   forward:  the extras of entries 0, 2, 4, …  then the even-indexed gammas
  //   backward: gamma(N + 1)  then the extras of entries 1, 3, 5, …  then the odd-indexed gammas
  // EVIDENCE: LOG/070 — the in-order reading of the nibbles is wrong from the second entry on
  //   (c021275 needs [2, 0, 12, 4] where it gives [2, 12, 0, 0]), and the stream's last byte — 0x40
  //   on all 473 chunks of the 506 byte-exact payloads — is read from the other end
  // EVIDENCE: LOG/071 — the backward reader opens with a plain Elias gamma of N + 1; the 0x40 of
  //   LOG/019 and LOG/070 is gamma(2), one gamma; the escaped lengths split between the readers
  // EVIDENCE: LOG/072 — a plain entry's nibble is read forward when the entry's index is even and
  //   backward when odd, verified on 1..8 entries and re-deriving c021275's [2, 0, 12, 4]
  // EVIDENCE: LOG/074 — each reader holds its extras first and its gammas after, not in token order,
  //   101 of 101 random shapes; slot extras split by entry index the same way, 60 of 60
  // EVIDENCE: LOG/075 — N counts every gamma, literal and match; element i of the gamma array is
  //   read forward when i is even and backward when odd, 278 of 278 random shapes
  // EVIDENCE: LOG/014 — an escaped length's gamma carries seven mantissa bits after its zero run
  const GAMMA_MANTISSA = 7;
  // EVIDENCE: LOG/071 — the header is the plain Elias gamma, one mantissa bit
  const HEADER_MANTISSA = 1;

  // EVIDENCE: LOG/027 — a slot-coded distance byte is a slot taking `slot >> 3` extra bits from the
  //   bit stream, and the families are contiguous: slots 4..7 are the distance itself, 8..15 cover
  //   8..23 two apart, 16..23 cover 24..55 four apart, and so on. Measured one slot at a time on a
  //   host whose literal run was lengthened until the history was deep enough, with the distance read
  //   out of the output rather than fitted.
  // EVIDENCE: LOG/079 — the same code measured over slots 1..63 in the stride form, at strides 1 and
  //   8: slots 1..7 are the value itself, and slot `a >= 8` is `8 * (2**n - 1) + (a & 7) * 2**n` plus
  //   n extra bits, n = a >> 3, up to seven bits. Slot 0 was refused at every bit value.
  // EVIDENCE: LOG/082 — and unchanged through slot 112 (fourteen bits, 131064) in a two-chunk unit.
  //   Slot 0 is the value 0: with a residue of 1..40 it decodes to the residue alone, and only a
  //   distance of 0 is refused.
  // EVIDENCE: LOG/084 — and through slot 127 (fifteen bits, 524279) across four filler units, the
  //   match window being the whole payload
  // EVIDENCE: LOG/099 — and through slot 143 (seventeen bits) across seventeen
  // EVIDENCE: LOG/104 — and through slot 152 (nineteen bits, 4194296) across the same seventeen;
  //   153 and up are unmeasured and refused
  const SLOT_MIN = 0;
  const SLOT_MAX = 153;

  // EVIDENCE: LOG/026 — bits 5..7 of a token byte select the distance from a list of recently used
  // ones, most recent first, initialised to 8. The value 7 reads the next entry from the distance
  // sub-stream and pushes it to the front; 1 and 2 promote the entry at that position; 0 keeps the
  // front entry. Recovered by asking which distances reproduce the oracle's own output on c000864,
  // whose eleven tokens admit exactly one consistent assignment.
  // EVIDENCE: LOG/083 — the list has seven entries: by construction, after seven new distances the
  //   selectors 0..6 give the seven most recent, each moved to the front, and an eighth new distance
  //   drops the oldest. A fresh list answers 8 to every selector.
  const DISTANCE_NEW = 7;
  const DISTANCE_REPS = 7;

  /**
   * Read one sub-stream header at `at`, in any of the four forms, returning the item or null if it
   * does not fit before `end`. `coded` items have no bytes yet; `materialize` fills them in.
   *
   * EVIDENCE: LOG/024 — the header form, from a byte-by-byte bit-flip map of c001401 and c005161,
   *   whose arithmetic closes on 256 and 459 bytes exactly, and from a construction sweep in which
   *   the decoded bytes of a plain sub-stream were read back out of the output
   * EVIDENCE: LOG/067 — [type: 4][n-1: 18][clen: 18] for coded, [type: 4][length: 20] for raw
   * EVIDENCE: LOG/080 — the two compact forms
   */
  function readItem(src, at, end) {
    if (at >= end) return null;
    const b = src[at];
    if ((b & ITEM_COMPACT_FLAG) === 0) {
      const type = b & TYPE_NIBBLE;
      const hi = b & SIZE_HI_NIBBLE;
      if (type === 0) {
        if (at + ITEM_RAW_HEADER_BYTES > end) return null;
        // EVIDENCE: LOG/067 — all sixteen bits of the length, plus the nibble: `00 d5 48` is 54600
        //   raw literals and `01 ec b9` is 126137, each in a chunk built to hold that many
        const len = (hi << 16) | (src[at + 1] << 8) | src[at + 2];
        const start = at + ITEM_RAW_HEADER_BYTES;
        if (start + len > end) return null;
        return { type, coded: false, buf: src, at: start, len, dec: len, next: start + len };
      }
      if (at + ITEM_CODED_HEADER_BYTES > end) return null;
      // EVIDENCE: LOG/032 — the field after the flag is 4*(n-1), not the decompressed length that
      //   LOG/024 read it as; measured both by construction and by the write-length probe
      // EVIDENCE: LOG/067 — `31 41 14 50 21` is 20550 literals in 20513 bytes, and `46 83 39 38 d6`
      //   is 106703 literals in 80086 bytes
      const field = (hi << 16) | (src[at + 1] << 8) | src[at + 2];
      const dec = (field >> SIZE_SHIFT) + 1;
      const len = ((field & CLEN_HI_MASK) << 16) | (src[at + 3] << 8) | src[at + 4];
      const start = at + ITEM_CODED_HEADER_BYTES;
      if (start + len > end) return null;
      return { type, coded: true, buf: null, at: start, len, dec, next: start + len };
    }
    const t = (b >> COMPACT_TYPE_SHIFT) & COMPACT_TYPE_MASK;
    if (t === 0) {
      if (at + ITEM_COMPACT_RAW_HEADER_BYTES > end) return null;
      const len = ((b & COMPACT_RAW_LENGTH_HI) << 8) | src[at + 1];
      const start = at + ITEM_COMPACT_RAW_HEADER_BYTES;
      if (start + len > end) return null;
      return { type: 0, coded: false, buf: src, at: start, len, dec: len, next: start + len };
    }
    if (at + ITEM_COMPACT_CODED_HEADER_BYTES > end) return null;
    const v = ((b & SIZE_HI_NIBBLE) << 16) | (src[at + 1] << 8) | src[at + 2];
    const len = v & COMPACT_CLEN_MASK;
    const dec = (v >> COMPACT_CLEN_BITS) + len + 1;
    const start = at + ITEM_COMPACT_CODED_HEADER_BYTES;
    if (start + len > end) return null;
    return { type: t << COMPACT_TYPE_SHIFT, coded: true, buf: null, at: start, len, dec, next: start + len };
  }

  // EVIDENCE: LOG/092 — a set of sub-streams may be interleaved by a schedule: `[L][80][item][L
  //   bytes]`, the item's bytes being tokens [n: 4][k: 4], each taking 2^n + x bytes from part
  //   k − 1 with x read as n bits from a two-ended reader over the L bytes (token i forward when i
  //   is even, backward when odd, MSB first); k = 0 ends a list. The readers' bytes, each rounded
  //   up, fill L exactly, and every part is consumed whole.
  // EVIDENCE: LOG/098 — the header is [L lo][f: 1 | L hi: 7]: L is fifteen bits, and with f clear
  //   the tokens come as two items, the part numbers k and then one width n per non-zero k, the
  //   reader's side alternating per width rather than per token. 310 sections and 42 trailers.
  const SCHEDULE_COMBINED_FLAG = 0x80;
  const SCHEDULE_LENGTH_HI_MASK = 0x7f;
  const SCHEDULE_HEADER_BYTES = 2;
  const SCHEDULE_BITS_SHIFT = 4;
  const SCHEDULE_PART_MASK = 0x0f;

  /**
   * Read a schedule at `at`: the two header bytes, the token item or items, and the L extra-bit
   * bytes. Returns { lists: [[{part, run}, ...], ...], next } or null when it is not that shape;
   * a schedule whose token item cannot be decoded returns false (the guard has been raised).
   *
   * EVIDENCE: LOG/092 — the shape, the token, the two-ended extra bits and the tiling rule
   * EVIDENCE: LOG/098 — the fifteen-bit L and the split form
   */
  function readSchedule(src, at, end, partCount) {
    if (at + SCHEDULE_HEADER_BYTES > end) return null;
    const L = src[at] | ((src[at + 1] & SCHEDULE_LENGTH_HI_MASK) << 8);
    const combined = (src[at + 1] & SCHEDULE_COMBINED_FLAG) !== 0;
    const item = readItem(src, at + SCHEDULE_HEADER_BYTES, end);
    if (!item) return null;
    if (!materialize(src, item)) return false;
    const parts = item.buf.subarray(item.at, item.at + item.len);
    let widths = null, bitsAt = item.next;
    if (!combined) {
      const wItem = readItem(src, item.next, end);
      if (!wItem) return null;
      if (!materialize(src, wItem)) return false;
      widths = wItem.buf.subarray(wItem.at, wItem.at + wItem.len);
      bitsAt = wItem.next;
    }
    if (bitsAt + L > end) return null;
    const totalBits = L * 8;
    let fpos = 0, bpos = 0;
    const bit = (i) => (src[bitsAt + (i >> 3)] >> (7 - (i & 7))) & 1;
    const fwd = (n) => { if (fpos + n > totalBits) return null; let v = 0; for (let i = 0; i < n; i++, fpos++) v = v * 2 + bit(fpos); return v; };
    const bwd = (n) => { if (bpos + n > totalBits) return null; let v = 0; for (let i = 0; i < n; i++, bpos++) v = v * 2 + ((src[bitsAt + L - 1 - (bpos >> 3)] >> (7 - (bpos & 7))) & 1); return v; };
    const lists = [];
    let list = [], w = 0;
    for (let t = 0; t < parts.length; t++) {
      const tok = parts[t];
      const k = combined ? tok & SCHEDULE_PART_MASK : tok;
      if (k === 0) { lists.push(list); list = []; continue; }
      if (k > partCount) return guard(`schedule names part ${k} of ${partCount}`);
      let n;
      if (combined) n = tok >> SCHEDULE_BITS_SHIFT;
      else { if (w >= widths.length) return guard("schedule widths exhausted"); n = widths[w]; }
      const side = combined ? t : w;
      w++;
      const x = (side & 1) === 0 ? fwd(n) : bwd(n);
      if (x === null) return guard("schedule extra bits exhausted");
      list.push({ part: k - 1, run: (1 << n) + x });
    }
    if (widths && w !== widths.length) return guard(`schedule has ${widths.length} widths for ${w} runs`);
    if (list.length) return guard("schedule does not end with a terminator");
    if (((fpos + 7) >> 3) + ((bpos + 7) >> 3) !== L) return guard(`schedule bits of ${L} bytes, readers used ${fpos} + ${bpos} bits`);
    return { lists, next: bitsAt + L };
  }

  /**
   * Apply a schedule's lists to materialized parts: one buffer per list, the parts' cursors
   * shared across lists in order. Every part must be consumed exactly. Returns the buffers or
   * false.
   *
   * EVIDENCE: LOG/092 — runs are taken from the parts in list order, and every part is consumed
   */
  function applySchedule(parts, lists) {
    const pos = parts.map(() => 0);
    const bufs = [];
    for (const list of lists) {
      let total = 0;
      for (const r of list) total += r.run;
      const buf = new Uint8Array(total);
      let o = 0;
      for (const r of list) {
        const p = parts[r.part];
        if (pos[r.part] + r.run > p.len) return guard(`schedule overruns part ${r.part}`);
        buf.set(p.buf.subarray(p.at + pos[r.part], p.at + pos[r.part] + r.run), o);
        o += r.run;
        pos[r.part] += r.run;
      }
      bufs.push(buf);
    }
    for (let i = 0; i < parts.length; i++) if (pos[i] !== parts[i].len) return guard(`schedule leaves part ${i} ${parts[i].len - pos[i]} bytes unread`);
    return bufs;
  }

  const asItem = (buf) => ({ type: 0, coded: false, buf, at: 0, len: buf.length, dec: buf.length });

  // EVIDENCE: LOG/081 — the token slot may hold `83 80` and then eight sub-streams, one per output
  //   position modulo 8, laid end to end. The first byte accepts only 0x83 and the second only
  //   0x80 (0xc0 reads the same); `83 8c` with c items, c = 2..16, occurs in the corpus and is not
  //   read.
  const TOKEN_GROUP_MARK = 0x83;
  const TOKEN_GROUP_EIGHT = 0x80;
  const TOKEN_GROUP_SECOND_MASK = 0xbf;
  const TOKEN_BINS = 8;

  /**
   * Split a chunk's content into its sub-streams and the offset at which the bit stream begins:
   *
   *   [stride marker]? [slots | plain distances] [residues]? [escapes] [literals] [tokens | group]
   *
   * Null if the content is not that shape.
   *
   * EVIDENCE: LOG/024 — four sub-streams in this order, with the bit stream after them
   * EVIDENCE: LOG/079 — the marker, and the residue stream that follows the slots when the stride
   *   is above 1; e516 decoded every stream of a five-stream chunk and e522 walked 9589 of them
   * EVIDENCE: LOG/081 — the eight-way token group
   */
  /**
   * Read an interleave section at `at`: a byte `0x80 | c`; with c = 0 the section is implicit and
   * the caller decides what follows; with c ≥ 2 it is c parts and a schedule, and the result
   * holds one materialized item per schedule list. Null if not that shape, false on a guard.
   *
   * EVIDENCE: LOG/092 — the flagged type-0x50 form is this section behind a sub-stream header
   * EVIDENCE: LOG/093 — the same section stands bare in the token slot (`83` before it) and in
   *   the literal slot of the split-literal chunk modes
   */
  function readSection(src, at, end) {
    if (at >= end) return null;
    const x = src[at];
    if ((x & SEQUENCE_FLAG) === 0) return null;
    const count = x & ~SEQUENCE_FLAG;
    at++;
    // EVIDENCE: LOG/093 — c = 0 is the implicit form (two plain items in the literal slot, eight in
    //   the token slot); LOG/092 — c ≥ 2 is c parts and a schedule
    if (count === 0) return { implicit: true, items: null, next: at };
    if (count < SEQUENCE_MIN_PARTS) return null;
    const parts = [];
    for (let i = 0; i < count; i++) {
      const part = readItem(src, at, end);
      if (!part) return null;
      if (!materialize(src, part)) return false;
      parts.push(part);
      at = part.next;
    }
    const sched = readSchedule(src, at, end, count);
    if (!sched) return sched;
    const bufs = applySchedule(parts, sched.lists);
    if (!bufs) return false;
    return { implicit: false, items: bufs.map(asItem), next: sched.next };
  }

  function parseChunkLayout(src, at, end, split = 0) {
    let stride = 0;                 // 0: no marker, plain distances of LOG/020
    if (src[at] & STRIDE_MARKER_FLAG) {
      stride = (src[at] & STRIDE_MASK) + 1;
      at++;
    }
    const take = () => { const it = readItem(src, at, end); if (it) at = it.next; return it; };
    const distances = take(); if (!distances) return null;
    let residues = null;
    if (stride > 1) { residues = take(); if (!residues) return null; }
    const escapes = take(); if (!escapes) return null;
    // lists: the literal streams. One for the plain modes; the split modes read a section whose
    // lists are the streams, or, implicitly, `split` plain items in order.
    let lists;
    if (split) {
      // EVIDENCE: LOG/093 — the literal slot is a section: implicit, `split` plain items in order
      //   (mode 0x90: the rest-literal stream then the first-literal stream); explicit, its lists
      const sec = readSection(src, at, end);
      if (!sec) return sec;
      at = sec.next;
      if (sec.implicit) {
        lists = [];
        for (let i = 0; i < split; i++) { const it = take(); if (!it) return null; lists.push(it); }
      } else {
        if (sec.items.length !== split) return guard(`literal section has ${sec.items.length} lists, the mode wants ${split}`);
        lists = sec.items;
      }
    } else {
      const it = take(); if (!it) return null;
      lists = [it];
    }
    const bins = [];
    if (src[at] === TOKEN_GROUP_MARK) {
      // EVIDENCE: LOG/081 — `83 80`: eight bins by output position modulo 8
      // EVIDENCE: LOG/093 — `83 8c`, c ≥ 2: an explicit section whose eight lists are the bins
      const sec = readSection(src, at + 1, end);
      if (!sec) return sec;
      at = sec.next;
      if (sec.implicit) {
        for (let i = 0; i < TOKEN_BINS; i++) { const it = take(); if (!it) return null; bins.push(it); }
      } else {
        if (sec.items.length !== TOKEN_BINS) return guard(`token section has ${sec.items.length} lists`);
        bins.push(...sec.items);
      }
    } else {
      const it = take(); if (!it) return null;
      bins.push(it);
    }
    // EVIDENCE: LOG/024 — the bit stream is whatever is left, 3 to 5 bytes on most chunks and 29 on
    // c005161's; there must be at least one byte of it
    if (at >= end) return null;
    return { stride, distances, residues, escapes, lists, bins, bits: at };
  }

  // A coded item's decoder. The deliverable reads types 0x20 and 0x40 (decodeHuffBlock); the
  // experiments in exp/ may install a black-box reader for the types not yet understood, so that
  // the token layer can be checked on real chunks before every coder is read. Never set in src/.
  let codedItemHook = null;
  // Experiments only: a transform applied to each literal byte as it is written (mode probing).
  let literalHook = null;
  // Experiments only: container modes to route through the mode-0x88 walk.
  let extraLzModes = null;
  // Experiments only: modes whose layout carries a byte and a second literal stream after the escapes.
  let splitLiteralModes = null;
  let extraDeltaModes = null;
  let extraLiteralLists = null;   // Map mode -> { count, pick(i, p) }
  // Experiments only: called with (chunk, tokenCount, rest) at the end of every successful walk.
  let walkStatsHook = null;

  /**
   * Give an item its bytes: raw items already point at the source; coded ones are decoded into a
   * buffer of their own. False if the item's coder is not one we read.
   *
   * EVIDENCE: LOG/032 — a coded sub-stream's payload is an entropy block of the flag's type, and
   *   its header carries the same three fields a block chunk's does
   * EVIDENCE: LOG/059 — only type 0x20 is read; every other flag is refused rather than guessed at
   * EVIDENCE: LOG/068 — and type 0x40, which is the same coder in two groups
   * EVIDENCE: LOG/086 — and type 0x10, the table-ANS coder
   */
  function materialize(src, item) {
    if (!item.coded) return true;
    if (item.dec < 1 || item.dec > CHUNK_OUTPUT_MAX) return guard("coded sub-stream length out of range");
    const scratch = new Uint8Array(item.dec);
    if (!decodeCoded(item.type, src, item.at, item.len, item.dec, scratch)) return false;
    item.buf = scratch;
    item.at = 0;
    item.len = item.dec;
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Type 0x10: table-based asymmetric numeral systems, five lanes interleaved (LOG/086)
  // ---------------------------------------------------------------------------------------------

  // EVIDENCE: LOG/086 — type 0x10 is a table-ANS coder: one table, five lanes, symbol p (below
  //   n − 5) in lane p mod 5, the last five symbols being the lanes' final states in lane order
  const BLOCK_TYPE_TANS = 0x10;
  const TANS_LANES = 5;

  // EVIDENCE: LOG/090 — byte 0: bits 5..6 are the size class c (table 256 << c, states 8 + c bits),
  //   bit 4 picks the header form, bit 0 adds 8 to the count width in the small form (LOG/096: in the
  //   large form it is the top bit of k - 1); bit 7 is never set and is refused
  const TANS_CLASS_SHIFT = 5;
  const TANS_CLASS_MASK = 0x03;
  const TANS_LARGE_HEADER = 0x10;
  const TANS_WIDTH_PLUS_8 = 0x01;
  const TANS_UNUSED_BIT = 0x80;
  const TANS_BASE_SLOTS = 256;
  const TANS_STATE_BITS = 8;
  const TANS_WIDTH_EXTRA = 8;

  // EVIDENCE: LOG/087 — bits 1..3 are k − 2 for the small form (2..7 symbols)
  const TANS_SMALL_K_SHIFT = 1;
  const TANS_SMALL_K_MASK = 0x07;
  const TANS_SMALL_K_BASE = 2;
  const TANS_SMALL_WIDTH_BITS = 3;

  // EVIDENCE: LOG/088 — in the large form bits 1..3 are the count-field width w, then from byte 1:
  //   [k − 1 : 7], the gap count in truncated binary over k, a bit for a non-zero base
  const TANS_LARGE_WIDTH_SHIFT = 1;
  const TANS_LARGE_WIDTH_MASK = 0x07;
  const TANS_LARGE_K_BITS = 7;
  const TANS_LARGE_K_HIGH = 0x01;       // byte 0 bit 0: k - 1 >= 128
  const TANS_LARGE_K_HIGH_STEP = 128;
  const TANS_ALPHABET = 256;

  // EVIDENCE: LOG/088 — the counts are a gamma-style code walked around a prediction: pred =
  //   A >> 2 with A = 10 at the start, A += min(V, 2·pred − 1) − pred after each count
  const TANS_PRED_INIT = 10;
  const TANS_PRED_SHIFT = 2;

  // EVIDENCE: LOG/086 — slot j of the walk is x = 64·(j & 3) + (j >> 2): four columns; LOG/090 — of
  //   L / 4 rows for the larger tables
  const TANS_COLUMNS = 4;

  const TANS_SYMBOL_BITS = 8;
  const TANS_MAX_UNARY = 24;

  /**
   * An MSB-first bit reader over a payload's header bytes.
   */
  function tansBits(pay, from) {
    let p = 0;
    return {
      bit() { const i = from + (p >> 3); if (i >= pay.length) return -1; const b = (pay[i] >> (7 - (p & 7))) & 1; p++; return b; },
      bits(n) { let v = 0; for (let i = 0; i < n; i++) { const b = this.bit(); if (b < 0) return -1; v = (v << 1) | b; } return v; },
      unary() { let z = 0; for (;;) { const b = this.bit(); if (b < 0 || z > TANS_MAX_UNARY) return -1; if (b) return z; z++; } },
      bytes() { return from + ((p + 7) >> 3); },
    };
  }

  /**
   * Read the small header: `[w:3]` then k − 1 × `[symbol:8][Δcount:w]` in rising count, then the
   * remaining symbol, which has the rest of the L slots. Returns symbols in rising value with their
   * counts and the header's byte length, or null.
   *
   * EVIDENCE: LOG/086 — the two-symbol form; LOG/087 — 3..7 symbols, the counts as differences in
   *   rising order, the table laid out by symbol value; LOG/090 — w + 8 with bit 0, and L = 256 << c
   */
  function readTansHeaderSmall(pay, L) {
    const k = ((pay[0] >> TANS_SMALL_K_SHIFT) & TANS_SMALL_K_MASK) + TANS_SMALL_K_BASE;
    const r = tansBits(pay, 1);
    let w = r.bits(TANS_SMALL_WIDTH_BITS);
    if (w < 0) return null;
    if (pay[0] & TANS_WIDTH_PLUS_8) w += TANS_WIDTH_EXTRA;
    const list = [];
    let acc = 0, total = 0;
    for (let i = 0; i < k - 1; i++) {
      const s = r.bits(TANS_SYMBOL_BITS), d = r.bits(w);
      if (s < 0 || d < 0) return null;
      acc += d;
      if (acc < 1) return null;
      total += acc;
      list.push({ s, V: acc });
    }
    const rest = r.bits(TANS_SYMBOL_BITS);
    if (rest < 0 || total >= L) return null;
    list.push({ s: rest, V: L - total });
    list.sort((a, b) => a.s - b.s);
    return { syms: list.map(e => e.s), counts: list.map(e => e.V), bytes: r.bytes() };
  }

  /**
   * The value at index `xp` (1-based) of the walk around `pred`: pred, pred − 1, pred + 1, pred − 2,
   * pred + 2, …, skipping values below 1.
   *
   * EVIDENCE: LOG/088 — the bounded zigzag, read against the oracle's own table
   */
  function tansZigzag(pred, xp) {
    if (xp === 1) return pred;
    let k = 1;
    for (let d = 1; ; d++) {
      if (pred - d >= 1) { k++; if (k === xp) return pred - d; }
      k++; if (k === xp) return pred + d;
    }
  }

  /**
   * Read the large header. Returns symbols in rising value with their counts and the header's byte
   * length, or null.
   *
   * EVIDENCE: LOG/088 — the fields, their order (all prefixes, then the symbol section's mantissas,
   *   then the counts'), the run/gap alphabet, the count code around the running prediction;
   *   LOG/096 — k up to 256 (byte 0 bit 0), the gap count's range, no list section for 256 symbols
   */
  function readTansHeaderLarge(pay, L) {
    const w = (pay[0] >> TANS_LARGE_WIDTH_SHIFT) & TANS_LARGE_WIDTH_MASK;
    const r = tansBits(pay, 1);
    // EVIDENCE: LOG/096 — in the large form byte 0 bit 0 is the eighth bit of k - 1, not a width flag
    let k = r.bits(TANS_LARGE_K_BITS) + 1;
    if (pay[0] & TANS_LARGE_K_HIGH) k += TANS_LARGE_K_HIGH_STEP;
    if (k < 1) return null;
    // the gap count in truncated binary over min(k, 257 - k) values: at most k - 1 gaps, and at
    // most one per absent symbol
    // EVIDENCE: LOG/096 — the range is 257 - k when k >= 129 (LOG/088 measured k for k <= 40)
    const gmax = Math.min(k - 1, TANS_ALPHABET - k);
    const m = gmax + 1;
    const nb = 32 - Math.clz32(m - 1);
    const u = (1 << nb) - m;
    let G = nb > 1 ? r.bits(nb - 1) : 0;
    if (G < 0) return null;
    if (nb > 0 && G >= u) { const b = r.bit(); if (b < 0) return null; G = ((G << 1) | b) - u; }
    if (G > gmax) return null;
    // EVIDENCE: LOG/096 — with all 256 symbols present there is no base flag: the list section is empty
    const B = k === TANS_ALPHABET ? 0 : r.bit();
    if (B < 0) return null;
    // the prefixes: one per count, then the base's, then a run's and a gap's per gap
    const zc = new Array(k);
    for (let i = 0; i < k; i++) { zc[i] = r.unary(); if (zc[i] < 0) return null; }
    let zb = 0;
    if (B) { zb = r.unary(); if (zb < 0) return null; }
    const zr = new Array(G), zg = new Array(G);
    for (let j = 0; j < G; j++) { zr[j] = r.unary(); zg[j] = r.unary(); if (zr[j] < 0 || zg[j] < 0) return null; }
    // the symbol section's mantissas: base + 1 = 2^(zb+1) + m; run = 2^zr + m; gap = 2^(zg+1) + m
    let base = 0;
    if (B) { const m = r.bits(zb + 1); if (m < 0) return null; base = (1 << (zb + 1)) + m - 1; }
    const syms = [base];
    let s = base;
    for (let j = 0; j < G; j++) {
      const mr = r.bits(zr[j]), mg = r.bits(zg[j] + 1);
      if (mr < 0 || mg < 0) return null;
      const run = (1 << zr[j]) + mr, gap = (1 << (zg[j] + 1)) + mg;
      for (let t = 1; t < run; t++) syms.push(++s);
      s += gap;
      syms.push(s);
      if (syms.length > k) return null;
    }
    while (syms.length < k) syms.push(++s);
    if (syms[k - 1] > 255) return null;
    // the counts' mantissas: X = 2^(z+w) + m, walked around the prediction from X − (2^w − 1)
    const counts = new Array(k);
    let A = TANS_PRED_INIT;
    for (let i = 0; i < k; i++) {
      const m = r.bits(zc[i] + w);
      if (m < 0) return null;
      const xp = (1 << (zc[i] + w)) + m - ((1 << w) - 1);
      // a count is at most L, and the walk reaches any value v by index 2v at most
      if (xp < 1 || xp > 2 * L) return null;
      const pred = A >> TANS_PRED_SHIFT;
      const V = tansZigzag(pred, xp);
      counts[i] = V;
      A += Math.min(V, 2 * pred - 1) - pred;
    }
    return { syms, counts, bytes: r.bytes() };
  }

  /**
   * Build the decoding table for symbols (in rising value) with slot counts summing to L: per
   * slot x the symbol, the bits to read and the next-state base.
   *
   * EVIDENCE: LOG/086 — the column-major walk and the next-state rule (a symbol's slots in rising
   *   x take f, f + 1, …; bits = log2(L) − ⌊log2 ns⌋; next = (ns << bits) − L)
   * EVIDENCE: LOG/089 — single-slot symbols on top in rising value; the walk over the others stops
   *   S cells short and its holes are closed by compacting the sequence in rising x
   * EVIDENCE: LOG/090 — L / 4 rows per column and log2(L)-bit states for the larger tables
   */
  function buildTansTable(syms, counts, L) {
    const k = syms.length;
    const rows = L / TANS_COLUMNS;
    const walk = new Int16Array(L).fill(-1);
    let j = 0, S = 0;
    for (let i = 0; i < k; i++) {
      if (counts[i] === 1) { S++; continue; }
      for (let t = 0; t < counts[i]; t++) {
        if (j >= L) return null;
        walk[((j & 3) * rows) + (j >> 2)] = i;
        j++;
      }
    }
    if (j !== L - S) return null;
    const assign = new Int16Array(L);
    let x = 0;
    for (let y = 0; y < L; y++) if (walk[y] >= 0) assign[x++] = walk[y];
    for (let i = 0; i < k; i++) if (counts[i] === 1) assign[x++] = i;
    const next = Int32Array.from(counts);
    const lg = 31 - Math.clz32(L);
    const sym = new Uint8Array(L), nb = new Uint8Array(L), nx = new Int32Array(L);
    for (let xx = 0; xx < L; xx++) {
      const i = assign[xx];
      const ns = next[i]++;
      const b = lg - (31 - Math.clz32(ns));
      sym[xx] = syms[i]; nb[xx] = b; nx[xx] = (ns << b) - L;
    }
    return { sym, nb, nx };
  }

  /**
   * Decode a type-0x10 block: `emits` symbols from the payload at `content` (`len` bytes) into `dst`
   * at `out`. False if the header, the table or the stream does not read.
   *
   * EVIDENCE: LOG/086 — five lanes; a lane's even-numbered decodes read the forward bit stream,
   *   odd-numbered the backward one; the last five outputs are the lanes' final states; the two
   *   streams' rounded-up bytes fill the stream exactly
   * EVIDENCE: LOG/090 — the two streams are LSB-first from either end, opening with the states
   *   (lanes 0, 2, 4 forward; 1, 3 backward) of 8 + c bits, the decodes reading on from there; a
   *   final state above 255 is refused
   */
  function decodeTansBlock(src, content, len, emits, dst, out) {
    if (len < 1 || content + len > src.length || emits < TANS_LANES || out + emits > dst.length) return false;
    const pay = src.subarray(content, content + len);
    const b0 = pay[0];
    if (b0 & TANS_UNUSED_BIT) return false;
    const c = (b0 >> TANS_CLASS_SHIFT) & TANS_CLASS_MASK;
    const L = TANS_BASE_SLOTS << c;
    const h = (b0 & TANS_LARGE_HEADER) ? readTansHeaderLarge(pay, L) : readTansHeaderSmall(pay, L);
    if (!h) return false;
    let total = 0;
    for (let i = 0; i < h.counts.length; i++) {
      if (h.counts[i] < 1) return false;
      total += h.counts[i];
      if (i && h.syms[i] <= h.syms[i - 1]) return false;
    }
    if (total !== L) return false;
    const T = buildTansTable(h.syms, h.counts, L);
    if (!T) return false;

    const s0 = h.bytes, end = len;
    const sb = TANS_STATE_BITS + c;
    const stream = end - s0;
    const totalBits = 8 * stream;
    if (TANS_LANES * sb > totalBits) return false;
    // The two streams as windows, the next unread bit of each at bit 0 of its word: the forward one
    // takes bytes from s0 upward, the backward one from the last byte downward, each byte's low bit
    // first (LOG/090). A field is at most 11 bits (the state width and the table's log), so a window
    // topped up to more than that never overflows. Bytes outside the stream read as zero; the bound
    // `fPos + n + bPos <= totalBits` is checked before every read, as it was.
    // EVIDENCE: LOG/106 — the same bits, read a byte at a time instead of one call per bit
    let fPos = 0, bPos = 0;
    let fw = 0, fh = 0, fk = s0;              // forward: window, bits in it, next byte
    let bw = 0, bh = 0, bk = end - 1;         // backward
    const states = new Int32Array(TANS_LANES);
    for (let lane = 0; lane < TANS_LANES; lane++) {
      if (fPos + sb + bPos > totalBits) return false;
      let v;
      if (lane & 1) {
        while (bh < sb) { bw |= (bk >= s0 ? pay[bk] : 0) << bh; bh += 8; bk--; }
        v = bw & ((1 << sb) - 1); bw >>>= sb; bh -= sb; bPos += sb;
      } else {
        while (fh < sb) { fw |= (fk < end ? pay[fk] : 0) << fh; fh += 8; fk++; }
        v = fw & ((1 << sb) - 1); fw >>>= sb; fh -= sb; fPos += sb;
      }
      if (v >= L) return false;
      states[lane] = v;
    }
    // Lane i % 5 decodes symbol i; a lane's even-numbered decodes read forward and its odd-numbered
    // ones backward, which is the parity of the group of five (LOG/086). A group is one loop step:
    // its five lanes are independent of one another, and read from one side.
    const body = emits - TANS_LANES;
    const sym = T.sym, nb = T.nb, nx = T.nx;
    let s0_ = states[0], s1 = states[1], s2 = states[2], s3 = states[3], s4 = states[4];
    const groups = (body / TANS_LANES) | 0;
    let i = out;
    for (let g = 0; g < groups; g++, i += TANS_LANES) {
      const b0 = nb[s0_], b1 = nb[s1], b2 = nb[s2], b3 = nb[s3], b4 = nb[s4];
      dst[i] = sym[s0_]; dst[i + 1] = sym[s1]; dst[i + 2] = sym[s2]; dst[i + 3] = sym[s3]; dst[i + 4] = sym[s4];
      const need = b0 + b1 + b2 + b3 + b4;
      if (fPos + need + bPos > totalBits) return false;
      let v0, v1, v2, v3, v4;
      if (g & 1) {
        // the group's bits are at most 55, so top the window up between lanes
        while (bh < b0) { bw |= (bk >= s0 ? pay[bk] : 0) << bh; bh += 8; bk--; }
        v0 = bw & ((1 << b0) - 1); bw >>>= b0; bh -= b0;
        while (bh < b1) { bw |= (bk >= s0 ? pay[bk] : 0) << bh; bh += 8; bk--; }
        v1 = bw & ((1 << b1) - 1); bw >>>= b1; bh -= b1;
        while (bh < b2) { bw |= (bk >= s0 ? pay[bk] : 0) << bh; bh += 8; bk--; }
        v2 = bw & ((1 << b2) - 1); bw >>>= b2; bh -= b2;
        while (bh < b3) { bw |= (bk >= s0 ? pay[bk] : 0) << bh; bh += 8; bk--; }
        v3 = bw & ((1 << b3) - 1); bw >>>= b3; bh -= b3;
        while (bh < b4) { bw |= (bk >= s0 ? pay[bk] : 0) << bh; bh += 8; bk--; }
        v4 = bw & ((1 << b4) - 1); bw >>>= b4; bh -= b4;
        bPos += need;
      } else {
        while (fh < b0) { fw |= (fk < end ? pay[fk] : 0) << fh; fh += 8; fk++; }
        v0 = fw & ((1 << b0) - 1); fw >>>= b0; fh -= b0;
        while (fh < b1) { fw |= (fk < end ? pay[fk] : 0) << fh; fh += 8; fk++; }
        v1 = fw & ((1 << b1) - 1); fw >>>= b1; fh -= b1;
        while (fh < b2) { fw |= (fk < end ? pay[fk] : 0) << fh; fh += 8; fk++; }
        v2 = fw & ((1 << b2) - 1); fw >>>= b2; fh -= b2;
        while (fh < b3) { fw |= (fk < end ? pay[fk] : 0) << fh; fh += 8; fk++; }
        v3 = fw & ((1 << b3) - 1); fw >>>= b3; fh -= b3;
        while (fh < b4) { fw |= (fk < end ? pay[fk] : 0) << fh; fh += 8; fk++; }
        v4 = fw & ((1 << b4) - 1); fw >>>= b4; fh -= b4;
        fPos += need;
      }
      s0_ = nx[s0_] + v0; s1 = nx[s1] + v1; s2 = nx[s2] + v2; s3 = nx[s3] + v3; s4 = nx[s4] + v4;
    }
    states[0] = s0_; states[1] = s1; states[2] = s2; states[3] = s3; states[4] = s4;
    // the last, partial group, lane by lane
    const odd = (groups & 1) !== 0;
    for (let lane = 0, k = groups * TANS_LANES; k < body; k++, lane++) {
      const x = states[lane];
      const b = nb[x];
      dst[out + k] = sym[x];
      let v = 0;
      if (b !== 0) {
        if (fPos + b + bPos > totalBits) return false;
        if (odd) {
          while (bh < b) { bw |= (bk >= s0 ? pay[bk] : 0) << bh; bh += 8; bk--; }
          v = bw & ((1 << b) - 1); bw >>>= b; bh -= b; bPos += b;
        } else {
          while (fh < b) { fw |= (fk < end ? pay[fk] : 0) << fh; fh += 8; fk++; }
          v = fw & ((1 << b) - 1); fw >>>= b; fh -= b; fPos += b;
        }
      }
      states[lane] = nx[x] + v;
    }
    for (let i = 0; i < TANS_LANES; i++) {
      if (states[i] > 255) return false;
      dst[out + body + i] = states[i];
    }
    return ((fPos + 7) >> 3) + ((bPos + 7) >> 3) === stream;
  }

  // EVIDENCE: LOG/085 — a type-0x50 payload is a count byte and that many sub-streams, in any header
  //   form, whose outputs are laid end to end; eleven built shapes and 6993 corpus streams. With bit
  //   7 of the count set a trailer follows that reorders the parts, and that form is refused.
  const BLOCK_TYPE_SEQUENCE = 0x50;
  const SEQUENCE_FLAG = 0x80;
  const SEQUENCE_MIN_PARTS = 2;

  /**
   * Decode a coded payload of `type` at `at` (`len` bytes) into `dst`, which is exactly `dec` bytes.
   * False if the type is not read or the payload does not decode.
   */
  function decodeCoded(type, src, at, len, dec, dst) {
    if (type === BLOCK_TYPE_HUFF3 || type === BLOCK_TYPE_HUFF6) {
      if (!decodeHuffBlock(type, src, at, len, dec, dst, 0)) return guard(`type-0x${type.toString(16)} sub-stream did not decode`);
      return true;
    }
    if (type === BLOCK_TYPE_TANS) {
      if (!decodeTansBlock(src, at, len, dec, dst, 0)) return guard("type-0x10 sub-stream did not decode");
      return true;
    }
    if (type === BLOCK_TYPE_RUNS) return decodeRunBlock(src, at, len, dec, dst, 0);
    if (type === BLOCK_TYPE_SEQUENCE) {
      if (len < 1) return guard("empty type-0x50 payload");
      const count = src[at] & ~SEQUENCE_FLAG;
      const scheduled = (src[at] & SEQUENCE_FLAG) !== 0;
      if (count < SEQUENCE_MIN_PARTS) return guard("type-0x50 with fewer than two parts");
      const end = at + len;
      let p = at + 1, out = 0;
      const parts = [];
      for (let i = 0; i < count; i++) {
        const part = readItem(src, p, end);
        if (!part) return guard("type-0x50 part does not fit");
        if (out + part.dec > dec) return guard("type-0x50 parts exceed the count");
        if (!materialize(src, part)) return false;
        parts.push(part);
        out += part.len;
        p = part.next;
      }
      if (out !== dec) return guard("type-0x50 parts fall short of the count");
      if (!scheduled) {
        // EVIDENCE: LOG/085 — the plain form: the parts' bytes one after another
        if (p !== end) return guard("type-0x50 parts do not tile the payload");
        let o = 0;
        for (const part of parts) { dst.set(part.buf.subarray(part.at, part.at + part.len), o); o += part.len; }
        return true;
      }
      // EVIDENCE: LOG/092 — the flagged form: the parts interleaved by the trailer's one list
      const sched = readSchedule(src, p, end, count);
      if (sched === false) return false;
      if (!sched) return guard("type-0x50 trailer is not a schedule");
      if (sched.next !== end) return guard("type-0x50 schedule does not tile the payload");
      if (sched.lists.length !== 1) return guard(`type-0x50 schedule has ${sched.lists.length} lists`);
      const bufs = applySchedule(parts, sched.lists);
      if (!bufs) return false;
      if (bufs[0].length !== dec) return guard("type-0x50 schedule does not cover the count");
      dst.set(bufs[0], 0);
      return true;
    }
    if (codedItemHook) {
      if (!codedItemHook(type, src.subarray(at, at + len), dec, dst)) return guard(`hook could not decode a type-0x${type.toString(16)} sub-stream`);
      return true;
    }
    return guard(`coded sub-stream type 0x${type.toString(16)}`);
  }

  // EVIDENCE: LOG/018 — a token byte's literal count is bits 3..4, and the value 3 escapes to the
  // next byte of sub-stream 2; its match length is bits 0..2, and the value 7 escapes to the bit
  // stream. Read off a 256-value sweep: 0x02 -> L8 M4, 0x09 -> L9 M3, 0x10 -> L10 M2, and the high
  // bits 5..7 change nothing (0x02, 0x22, 0x42 ... all give the same output)
  const TOKEN_LITERAL_ESCAPE = 3;

  const TOKEN_MATCH_ESCAPE = 7;

  // EVIDENCE: LOG/018 — an escaped literal count is the sub-stream 2 byte plus 3, measured on 24
  // hosts; an escaped match length is the bit stream's gamma plus 200
  // EVIDENCE: LOG/073 — sub-stream 2 is read from both ends: literal escapes from the front in token
  //   order, match escapes from the back in token order. A match escape byte below 0xff is the
  //   length itself plus 9 (twelve values, 0 -> 9 up to 254 -> 263); 0xff says the length is a gamma
  //   plus 200. Every byte of the stream is read by one side or the other on 913 of 913 chunks.
  // EVIDENCE: LOG/075 — a literal escape byte of 0xff likewise says the count is a gamma, plus 194,
  //   continuing the byte's 3..257; the two kinds of gamma share one array, literal ones taken from
  //   its front in token order and match ones from its back in token order
  const LITERAL_COUNT_BIAS = 3;
  const LITERAL_GAMMA_BIAS = 194;
  const MATCH_LENGTH_BIAS = 200;
  const MATCH_ESCAPE_BYTE_BIAS = 9;
  const ESCAPE_GAMMA = 0xff;

  // EVIDENCE: LOG/018 — a plain match length is bits 0..2 plus 2 (0x10 -> M2, 0x02 -> M4, 0x06 -> M8)
  const MATCH_LENGTH_MIN = 2;

  /**
   * Decode one chunk by walking its token stream, writing at `out` in a buffer whose bytes before
   * `out` are already decoded output. Returns true if it did, false if the chunk is not a shape we
   * can read — the caller turns a false into a refusal.
   *
   * The guard that makes this safe is arithmetic: every token's literals and match are bounded by
   * what is left, and the leftover literals must land exactly on `emits`, which the framing of
   * LOG/013 supplies independently of anything read here. A mis-parse overshoots or undershoots and
   * the chunk is refused. LOG/015 and LOG/017 are two rules that lacked such a check and returned
   * wrong buffers instead of throwing.
   *
   * EVIDENCE: LOG/018 — 147 of 147 chunks meeting this guard decode byte-exactly, none wrongly
   * EVIDENCE: LOG/025 — the bootstrap literals are emitted only at output position 0
   */
  // The guard that last refused a chunk. It exists so `decompress`'s error can name the rule that
  // stopped it rather than only the chunk: PLAN.md's failure clusters are read straight out of
  // `npm run verify`, and "which guard" is the part that was missing.
  let lastGuard = "";
  const guard = (name) => { lastGuard = name; return false; };

  function decodeTokenChunk(src, c, dst, out) {
    const end = c.content + c.len;
    let at = 0;                     // output position within this chunk
    let content = c.content;
    if (out === 0) {
      if (c.emits < BOOTSTRAP_LITERALS) return false;
      if (content + BOOTSTRAP_LITERALS > end) return false;
      dst.set(src.subarray(content, content + BOOTSTRAP_LITERALS), out);
      content += BOOTSTRAP_LITERALS;
      at = BOOTSTRAP_LITERALS;
    }
    // EVIDENCE: LOG/097 — a chunk as long as its output is its output, verbatim: 39 corpus chunks
    //   and ten built ones of 12..70000 bytes, byte for byte against the oracle
    // EVIDENCE: LOG/102 — and only under mode 0x80: all 39 corpus and eleven built verbatim chunks are
    //   0x80, and the oracle refuses the same bytes under every other container mode
    if (c.len === c.emits && c.mode === CHUNK_MODE_LZ_DELTA) {
      dst.set(src.subarray(c.content, end), out);
      return true;
    }
    const parsed = parseChunkLayout(src, content, end, literalListCount(c.mode));
    if (parsed === false) return false;
    if (!parsed) return guard("sub-streams do not tile the chunk");
    const { distances, residues, escapes, lists, bins } = parsed;
    for (const item of [distances, residues, escapes, ...lists, ...bins]) if (item && !materialize(src, item)) return false;
    if (residues && residues.len !== distances.len) return guard("residue stream count differs from the slot stream's");
    return walkTokens(src, c, parsed, dst, out, at);
  }

  /**
   * A bit reader over one stream, most significant bit first within a byte, walking either up from
   * the stream's first byte (`dir` = 1, `base` = that byte) or down from its last (`dir` = -1,
   * `base` = the last byte). `pos` counts the bits it has consumed. Every read is bounded by the
   * whole stream, `bytes` bytes; the accounting between the two ends of a stream is the caller's
   * tiling check (LOG/076), as before.
   *
   * The next 25..32 unread bits sit at the top of a 32-bit word, so a fixed field is one shift and
   * a gamma's zero run is one count of leading zeros. Bytes past the stream read as zero; a read
   * that would need them is refused by the bound before it is made, as it was bit by bit.
   *
   * EVIDENCE: LOG/071 — the two readers, one from each end, MSB first within a byte
   * EVIDENCE: LOG/106 — reading the same bits one call at a time was half the decoder's time
   */
  class BitsMsb {
    constructor(src, base, dir, bytes) {
      this.src = src; this.base = base; this.dir = dir; this.bytes = bytes;
      this.total = bytes * 8;
      this.pos = 0;         // bits consumed so far
      this.k = 0;           // the next byte of this reader's walk
      this.word = 0;        // unread bits, the next one at bit 31
      this.have = 0;        // how many of `word`'s top bits are unread stream bits
    }
    refill() {
      while (this.have <= 24) {
        const b = this.k < this.bytes ? this.src[this.base + this.dir * this.k] : 0;
        this.k++;
        this.word |= b << (24 - this.have);
        this.have += 8;
      }
    }
    /** `n` bits, most significant first, or null when the stream has fewer than `n` left. */
    bits(n) {
      if (this.pos + n > this.total) return null;
      if (n === 0) return 0;
      if (n > 25) { const hi = this.bits(n - 16); return hi * 65536 + this.bits(16); }
      if (this.have < n) this.refill();
      const v = this.word >>> (32 - n);
      this.word <<= n; this.have -= n; this.pos += n;
      return v;
    }
    /**
     * Elias gamma with a widened mantissa: the zero run z, then z + `mantissa` bits as the value,
     * the first of them the 1 that ended the run. Null when the stream runs out first.
     *
     * EVIDENCE: LOG/014 — the width rule, read off a 65536-value sweep; LOG/016 — confirmed by
     *   bit-flipping over z = 2..10. The published code is P. Elias, IEEE Trans. Inf. Theory 21(2),
     *   1975; which variant the stream uses is what LOG/014 measured.
     */
    gamma(mantissa) {
      let zeros = 0;
      for (;;) {
        if (this.have <= 24) this.refill();
        const z = Math.clz32(this.word);
        if (z < this.have) { zeros += z; this.word <<= z; this.have -= z; break; }
        zeros += this.have; this.word = 0; this.have = 0;
        if (this.pos + zeros >= this.total) break;
      }
      if (this.pos + zeros > this.total) zeros = this.total - this.pos;
      const width = zeros + mantissa;
      if (this.pos + zeros + width > this.total) return null;
      // A value wider than 31 bits is above any length or count a chunk can hold, and the walk
      // would refuse it; refusing it here keeps the arithmetic in integers.
      if (width > 31) return null;
      this.pos += zeros;
      return this.bits(width);
    }
  }

  // Which literal list the i-th literal of a run at output position p is read from: one list; the
  // split modes' first-literal list; by position modulo 4 or 16; by the previous byte's high nibble;
  // or an experiment's own rule (extraLiteralLists).
  const LIST_ONE = 0, LIST_BY_FIRST = 1, LIST_BY_MOD4 = 2, LIST_BY_MOD16 = 3, LIST_BY_CONTEXT = 4, LIST_BY_HOOK = 5;

  /**
   * The extra bits of every second distance entry from `first` on, through one reader, into
   * `dists`. False when the reader runs out or an entry is refused (the guard is raised).
   *
   * EVIDENCE: LOG/021 — the distance entries' extra bits come before the gammas
   * EVIDENCE: LOG/072, LOG/074 — entry i's extras are read forward when i is even and backward
   *   when odd, plain nibbles and slot extras alike
   */
  function readDistanceExtras(r, first, distances, residues, stride, dists) {
    const buf = distances.buf, base = distances.at, n = distances.len;
    const resBuf = residues ? residues.buf : null, resBase = residues ? residues.at : 0;
    // The reader's window in locals for the loop — the same reads as r.bits(), written back below
    const src = r.src, rBase = r.base, dir = r.dir, bytes = r.bytes, total = r.total;
    let pos = r.pos, k = r.k, word = r.word, have = r.have;
    let ok = true;
    for (let i = first; i < n; i += 2) {
      const v = buf[base + i];
      let width, extra;
      if (stride === 0) {
        // EVIDENCE: LOG/028, LOG/082 — d = 8 + (v & 15) + 16 * (16 * (2**f - 1) + extra), f = v >> 4,
        //   with 4 + f extra bits; families from 10 up are unmeasured and refused
        const f = v >> PLAIN_FAMILY_SHIFT;
        if (f >= PLAIN_FAMILY_MAX) { ok = guard(`plain distance family ${f}`); break; }
        width = PLAIN_DISTANCE_EXTRA_BITS + f;
      } else if (v >= SLOT_MIN && v < SLOT_MAX) {
        // EVIDENCE: LOG/027, LOG/079 — the slot's family is `v >> 3`, which is both the number of
        //   extra bits and the log of the family's step; the family's first value is 8 * (2**n - 1),
        //   and slots below 8 are the value itself
        width = v >> 3;
      } else {
        // EVIDENCE: LOG/084, LOG/099, LOG/104 — slots past the measured bound are refused rather
        //   than extrapolated from the pattern
        ok = guard(`distance slot ${v} above ${SLOT_MAX - 1}`); break;
      }
      // width fixed bits, most significant first, as r.bits(width): at most 19 here
      if (pos + width > total) { ok = false; break; }
      if (width === 0) extra = 0;
      else {
        while (have <= 24) { word |= (k < bytes ? src[rBase + dir * k] : 0) << (24 - have); have += 8; k++; }
        extra = word >>> (32 - width); word <<= width; have -= width; pos += width;
      }
      if (stride === 0) {
        const f = v >> PLAIN_FAMILY_SHIFT;
        dists[i] = MATCH_DISTANCE_BIAS + (v & PLAIN_LOW_MASK) + PLAIN_STEP * (PLAIN_STEP * ((1 << f) - 1) + extra);
      } else {
        const step = 1 << width;
        const q = width ? 8 * (step - 1) + (v - 8 * width) * step + extra : v;
        // EVIDENCE: LOG/079 — the distance is the stride times the slot value plus the residue byte
        dists[i] = stride * q + (resBuf ? resBuf[resBase + i] : 0);
      }
    }
    r.pos = pos; r.k = k; r.word = word; r.have = have;
    return ok;
  }

  /**
   * The token walk itself, over a parsed and materialized layout. `at` is the output position
   * within the chunk at which the first token starts.
   *
   * The loop runs once per token and once more for the leftover literals (LOG/018), so the literal
   * run is written by one piece of code; the end-of-stream checks sit before that final run, where
   * they were.
   *
   * EVIDENCE: LOG/018 — the grammar; LOG/026 — the recent-distance list; LOG/071 through LOG/076 —
   *   the two-way bit stream; LOG/079 — the stride distances; LOG/081 — the token bins
   */
  function walkTokens(src, c, parsed, dst, out, at) {
    const end = c.content + c.len;
    const { stride, distances, residues, escapes, lists, bins } = parsed;
    const mode = c.mode;
    const emits = c.emits;

    // The literal lists, laid end to end in one buffer, with a read cursor and an end per list
    const nLists = lists.length;
    const litPos = new Int32Array(nLists);
    const litEnd = new Int32Array(nLists);
    let lit;
    if (nLists === 1) { lit = lists[0].buf; litPos[0] = lists[0].at; litEnd[0] = lists[0].at + lists[0].len; }
    else {
      let litTotal = 0;
      for (let k = 0; k < nLists; k++) { litPos[k] = litTotal; litTotal += lists[k].len; litEnd[k] = litTotal; }
      lit = new Uint8Array(litTotal);
      for (let k = 0; k < nLists; k++) lit.set(lists[k].buf.subarray(lists[k].at, lists[k].at + lists[k].len), litPos[k]);
    }
    // EVIDENCE: LOG/093 — mode 0x90: two lists, the first literal of a run from the second
    // EVIDENCE: LOG/094 — the four- and sixteen-list modes and their selectors
    const hookPick = extraLiteralLists && extraLiteralLists.has(mode) ? extraLiteralLists.get(mode).pick : null;
    const select = hookPick ? LIST_BY_HOOK
      : mode === CHUNK_MODE_LZ_SPLIT ? LIST_BY_FIRST
      : mode === CHUNK_MODE_LZ_MOD4 ? LIST_BY_MOD4
      : mode === CHUNK_MODE_LZ_CONTEXT ? LIST_BY_CONTEXT
      : mode === CHUNK_MODE_LZ_MOD16 ? LIST_BY_MOD16
      : LIST_ONE;
    const plain = select === LIST_ONE && !literalHook;   // the one-list modes, written directly
    const delta = isDeltaMode(mode);

    // Two bit readers, one from each end of the stream (LOG/071). Both are bounded by the whole
    // stream; the exact accounting between them is the tiling check at the end (LOG/076).
    const streamBytes = end - parsed.bits;
    const fwd = new BitsMsb(src, parsed.bits, 1, streamBytes);
    const bwd = new BitsMsb(src, end - 1, -1, streamBytes);

    // EVIDENCE: LOG/071 — the backward reader opens with gamma(N + 1)
    // EVIDENCE: LOG/075 — N is the number of gammas of both kinds, which is the number of 0xff bytes
    //   in the escape stream once every byte of it is read (LOG/073); a header that disagrees is a
    //   parse that went wrong before this point, and is refused
    let gammaCount = 0;
    const escBuf = escapes.buf;
    for (let i = 0, p = escapes.at, e = escapes.at + escapes.len; p < e; p++) if (escBuf[p] === ESCAPE_GAMMA) gammaCount++;
    const header = bwd.gamma(HEADER_MANTISSA);
    if (header === null) return false;
    if (header !== gammaCount + 1) return guard(`bit stream header counts ${header - 1} gammas, the escape stream holds ${gammaCount}`);

    // EVIDENCE: LOG/021 — the distance entries' extra bits come before the gammas
    // EVIDENCE: LOG/072, LOG/074 — entry i's extras are read forward when i is even and backward
    //   when odd, plain nibbles and slot extras alike
    // The two readers are independent streams, so the even entries are read first, all through the
    // forward reader, and then the odd ones through the backward reader: each reader sees its own
    // entries in the same order as before.
    const nDists = distances.len;
    const dists = new Int32Array(nDists);
    if (!readDistanceExtras(fwd, 0, distances, residues, stride, dists)) return false;
    if (!readDistanceExtras(bwd, 1, distances, residues, stride, dists)) return false;

    // EVIDENCE: LOG/075 — the gamma array: element i from the forward reader when i is even and the
    //   backward when odd, after each reader's extras (LOG/074). Literal gammas are taken from its
    //   front in token order and match gammas from its back in token order, below.
    const gammas = new Int32Array(gammaCount);
    for (let i = 0; i < gammaCount; i += 2) { const v = fwd.gamma(GAMMA_MANTISSA); if (v === null) return false; gammas[i] = v; }
    for (let i = 1; i < gammaCount; i += 2) { const v = bwd.gamma(GAMMA_MANTISSA); if (v === null) return false; gammas[i] = v; }
    let gFront = 0, gBack = gammaCount - 1;            // the gamma array's two cursors
    let escFront = escapes.at, escBack = escapes.at + escapes.len - 1;   // the escape stream's two cursors (LOG/073)

    let di = 0;                     // read cursor in the distance entries
    // EVIDENCE: LOG/026 — the recent-distance list, most recent first, initialised to 8
    // EVIDENCE: LOG/083 — seven entries; they are held in locals, r0 the most recent
    let r0 = MATCH_DISTANCE_BIAS, r1 = r0, r2 = r0, r3 = r0, r4 = r0, r5 = r0, r6 = r0;

    // EVIDENCE: LOG/081 — the token sub-streams laid end to end, bin c starting where the items
    //   before it end, and a token read from the bin of its start position modulo 8. A lone token
    //   stream is the same thing with one bin. The bins are copied into one buffer so that a token
    //   is one read.
    const nBins = bins.length;
    const binPos = new Int32Array(nBins);
    const binEnd = new Int32Array(nBins);
    let tokenCount = 0, tok;
    if (nBins === 1) { tok = bins[0].buf; binPos[0] = bins[0].at; tokenCount = bins[0].len; binEnd[0] = bins[0].at + tokenCount; }
    else {
      for (let i = 0; i < nBins; i++) { binPos[i] = tokenCount; tokenCount += bins[i].len; binEnd[i] = tokenCount; }
      tok = new Uint8Array(tokenCount);
      for (let i = 0; i < nBins; i++) tok.set(bins[i].buf.subarray(bins[i].at, bins[i].at + bins[i].len), binPos[i]);
    }
    const binMask = nBins === 1 ? 0 : TOKEN_BINS - 1;

    // Matches are copied eight bytes at a time through this view when the distance allows it
    const view = new DataView(dst.buffer, dst.byteOffset, dst.byteLength);
    const oEnd = out + emits;

    let o = out + at;               // the absolute output position; `at` is the same within the chunk
    for (let k = 0; ; k++) {
      let nlit, mlen, b = 0;
      if (k < tokenCount) {
        const bin = at & binMask;
        if (binPos[bin] >= binEnd[bin]) return guard(`token bin ${bin} exhausted`);
        b = tok[binPos[bin]++];

        nlit = (b >> 3) & 3;
        if (nlit === TOKEN_LITERAL_ESCAPE) {
          // EVIDENCE: LOG/073 — literal escapes are read from the front of the escape stream
          if (escFront > escBack) return guard("escape stream exhausted");
          const v = escBuf[escFront++];
          if (v === ESCAPE_GAMMA) {
            // EVIDENCE: LOG/075 — 0xff: the next gamma from the array's front, plus 194
            if (gFront > gBack) return guard("gamma array exhausted");
            nlit = gammas[gFront++] + LITERAL_GAMMA_BIAS;
          } else {
            nlit = v + LITERAL_COUNT_BIAS;
          }
        }
        mlen = b & 7;
        if (mlen === TOKEN_MATCH_ESCAPE) {
          // EVIDENCE: LOG/073 — match escapes are read from the back of the escape stream; a byte
          //   below 0xff is the length plus 9, and 0xff is the next gamma from the array's back, plus 200
          if (escBack < escFront) return guard("escape stream exhausted");
          const v = escBuf[escBack--];
          if (v === ESCAPE_GAMMA) {
            if (gBack < gFront) return guard("gamma array exhausted");
            mlen = gammas[gBack--] + MATCH_LENGTH_BIAS;
          } else {
            mlen = v + MATCH_ESCAPE_BYTE_BIAS;
          }
        } else {
          mlen += MATCH_LENGTH_MIN;
        }
        if (at + nlit + mlen > emits) return guard("token overshoots the chunk");
      } else {
        // The tokens are read. Everything the walk consumed must be exactly used up.
        // EVIDENCE: LOG/026 — every distance entry must be read by some token; a chunk that leaves one
        // behind has been parsed wrongly somewhere, and refusing it is what keeps the count honest
        if (di !== nDists) return guard("distance entries left unread");
        // EVIDENCE: LOG/081 — every bin is read to its end; a token that fell in the wrong bin leaves one
        //   short and another over, and either is refused
        for (let i = 0; i < nBins; i++) if (binPos[i] !== binEnd[i]) return guard(`token bin ${i} left ${binEnd[i] - binPos[i]} unread`);
        // EVIDENCE: LOG/073 — every byte of the escape stream is read by one side or the other, on 913
        //   of 913 all-raw chunks; one left over means the walk went wrong somewhere
        if (escFront !== escBack + 1) return guard("escape bytes left unread");
        if (gFront !== gBack + 1) return guard("gammas left unread");
        // EVIDENCE: LOG/076 — the stream is exactly the two readers' bytes, each rounded up to a whole
        //   byte: twelve shapes, each accepted at that one length. This replaces LOG/042's 8..15-bit
        //   bound, which was the one-gamma special case (a one-byte backward half plus forward padding),
        //   and keeps what LOG/041 needed: a parse that ran to the wrong depth does not tile.
        const fwdBytes = (fwd.pos + 7) >> 3;
        const bwdBytes = (bwd.pos + 7) >> 3;
        if (fwdBytes + bwdBytes !== streamBytes) return guard(`bit stream of ${streamBytes} bytes, readers used ${fwdBytes} + ${bwdBytes}`);
        // EVIDENCE: LOG/018 — when the token bytes run out the literals still unread are emitted,
        // and that has to land exactly on the chunk's output size
        let rest = 0;
        for (let i = 0; i < nLists; i++) rest += litEnd[i] - litPos[i];
        if (at + rest !== emits) return guard(`leftover literals land on ${at + rest}, not ${emits}`);
        // EVIDENCE: LOG/101 — the leftover run is at least eight bytes: the minimum over 20,887 chunks,
        //   hit by 7072 of them, and the oracle refuses the escape values that would take it below
        if (rest < TRAILING_LITERALS_MIN) return guard(`only ${rest} trailing literals`);
        if (walkStatsHook) walkStatsHook(c, tokenCount, rest);
        // EVIDENCE: LOG/091 — the leftover run is transformed the same way as a token's literals
        // EVIDENCE: LOG/093 — and draws from the lists by the same rule, every list ending together
        nlit = rest; mlen = 0;
      }

      // The literals of this run.
      // EVIDENCE: LOG/091 — mode 0x80 adds each literal to the byte reps[0] back; 0x88 writes it as is
      if (nlit !== 0) {
        if (plain) {
          let p = litPos[0];
          if (p + nlit > litEnd[0]) return guard("literal list 0 exhausted");
          if (delta) { for (let i = 0; i < nlit; i++, o++) dst[o] = (lit[p++] + dst[o - r0]) & 0xff; }
          else if (nlit >= 32) { dst.set(lit.subarray(p, p + nlit), o); p += nlit; o += nlit; }
          else for (let i = 0; i < nlit; i++, o++) dst[o] = lit[p++];
          litPos[0] = p;
        } else {
          for (let i = 0; i < nlit; i++, o++) {
            const l = select === LIST_BY_FIRST ? (i === 0 ? SPLIT_FIRST_LIST : 0)
              : select === LIST_BY_MOD4 ? o & MOD4_MASK
              : select === LIST_BY_MOD16 ? o & MOD16_MASK
              : select === LIST_BY_CONTEXT ? dst[o - 1] >> CONTEXT_SHIFT
              : select === LIST_BY_HOOK ? hookPick(i, o, dst)
              : 0;
            if (litPos[l] >= litEnd[l]) return guard(`literal list ${l} exhausted`);
            const v = lit[litPos[l]++];
            dst[o] = literalHook ? literalHook(v, dst, o, r0, mode) : delta ? (v + dst[o - r0]) & 0xff : v;
          }
        }
        at += nlit;
      }
      if (k === tokenCount) return true;

      // EVIDENCE: LOG/026, LOG/083 — 7 reads a new entry; 0..6 pick that position of the list and
      //   move it to the front
      const sel = (b >> 5) & 7;
      if (sel === DISTANCE_NEW) {
        if (di >= nDists) return guard("distance entries exhausted");
        r6 = r5; r5 = r4; r4 = r3; r3 = r2; r2 = r1; r1 = r0; r0 = dists[di++];
      } else if (sel !== 0) {
        let t;
        switch (sel) {
          case 1: t = r1; r1 = r0; break;
          case 2: t = r2; r2 = r1; r1 = r0; break;
          case 3: t = r3; r3 = r2; r2 = r1; r1 = r0; break;
          case 4: t = r4; r4 = r3; r3 = r2; r2 = r1; r1 = r0; break;
          case 5: t = r5; r5 = r4; r4 = r3; r3 = r2; r2 = r1; r1 = r0; break;
          default: t = r6; r6 = r5; r5 = r4; r4 = r3; r3 = r2; r2 = r1; r1 = r0; break;
        }
        r0 = t;
      }
      const d = r0;
      // EVIDENCE: LOG/025 — a match may reach back into output written before this chunk, so the
      // bound is the global output position rather than the position within the chunk
      if (d > o || d < 1) return guard("match distance reaches before the output");
      let s = o - d;
      const mEnd = o + mlen;
      if (d >= 8 && mEnd + 8 <= oEnd) {
        // Eight bytes a step, running up to seven bytes past the match. With d >= 8 every byte read
        // was written before this match began; the bytes past its end lie inside this chunk and are
        // written again by what follows — later tokens, or the trailing run of at least eight literals
        // (LOG/101) — before the walk can return true.
        while (o < mEnd) {
          view.setUint32(o, view.getUint32(s, true), true);
          view.setUint32(o + 4, view.getUint32(s + 4, true), true);
          o += 8; s += 8;
        }
        o = mEnd;
      } else {
        for (let i = 0; i < mlen; i++) dst[o++] = dst[s++];
      }
      at += mlen;
    }
  }


  // ---------------------------------------------------------------------------------------------
  // The entropy layer: type-0x20 blocks
  // ---------------------------------------------------------------------------------------------

  // EVIDENCE: LOG/045 — bit 0 of a table selects its form. Form 0 is the plain list read below; form
  // 1 is the coded length array, which is not read yet (LOG/046) and is refused rather than guessed.
  const TABLE_FORM_PLAIN = 0;

  // EVIDENCE: LOG/045 — form 0 is `[bit 0 = 0][bits 1..9 = k][bits 10..12 = b]`, then k entries of
  // `[symbol: 8 bits][code length - 1: b bits]`, read most significant bit first from the first
  // payload byte. Established by brute-forcing every bit offset that tracks a symbol across five
  // alphabet families, and confirmed by decoding six blocks of 4096 chosen symbols exactly.
  const TABLE_K_BITS = 9;
  const TABLE_B_BITS = 3;
  const TABLE_SYMBOL_BITS = 8;

  // A code longer than this cannot be assembled in a 32-bit integer. This is a bound on the
  // implementation, not a fact about the format: a table asking for more is refused, which keeps a
  // mis-parse from silently wrapping around. The Kraft check below is the real constraint.
  const MAX_CODE_BITS = 30;

  // A table of 2^maxLen entries, [length: 8][symbol: 8], decodes a symbol in one lookup (LOG/106).
  // EVIDENCE: LOG/106 — the deepest code in 185,221 working-set tables and 142,947 bench-set tables
  //   is 11 bits. This bounds the lookup table, not the format: a deeper table decodes the slow way.
  const HUFF_LUT_MAX_BITS = 11;
  const HUFF_LUT_LENGTH_SHIFT = 8;
  const HUFF_LUT_SYMBOL_MASK = 0xff;

  /**
   * Read `n` bits from `u` at bit offset `p`, most significant bit first.
   *
   * EVIDENCE: LOG/045 — a table is read most significant bit first from the first payload byte; the
   *   symbol offsets 13, 22, 31 and 40 only line up on byte-crossing fields in that order
   */
  function bitsMSB(u, p, n) {
    // EVIDENCE: LOG/045 — a table is read most significant bit first from the first payload byte
    let v = 0;
    for (let i = 0; i < n; i++) {
      const q = p + i;
      if ((q >> 3) >= u.length) return null;
      v = (v << 1) | ((u[q >> 3] >> (7 - (q & 7))) & 1);
    }
    return v >>> 0;
  }

  /**
   * Read a form-0 table. Returns { syms, lens, bytes } or null if this is not one, where `bytes` is
   * how many bytes of the payload it occupied.
   */
  function readPlainTable(pay) {
    if (bitsMSB(pay, 0, 1) !== TABLE_FORM_PLAIN) return null;
    const k = bitsMSB(pay, 1, TABLE_K_BITS);
    const b = bitsMSB(pay, 1 + TABLE_K_BITS, TABLE_B_BITS);
    if (k === null || b === null || k < 1) return null;
    const syms = new Array(k);
    const lens = new Array(k);
    let p = 1 + TABLE_K_BITS + TABLE_B_BITS;
    for (let i = 0; i < k; i++) {
      const s = bitsMSB(pay, p, TABLE_SYMBOL_BITS);
      if (s === null) return null;
      p += TABLE_SYMBOL_BITS;
      const d = b === 0 ? 0 : bitsMSB(pay, p, b);
      if (d === null) return null;
      p += b;
      syms[i] = s;
      lens[i] = d + 1;
      if (lens[i] > MAX_CODE_BITS) return null;
    }
    return { syms, lens, bytes: (p + 7) >> 3 };
  }

  // EVIDENCE: LOG/046 — a form-1 table opens `[bit 0 = 1][bits 1..3 = F][bits 4..11 = k-1]`
  const TABLE_FORM_CODED = 1;
  const TABLE_F_BITS = 3;
  const TABLE_K1_BITS = 8;

  // EVIDENCE: LOG/055 — after the header comes `v = runs - 1` in truncated binary, where `runs`
  //   counts alternating present/absent runs of the symbol set from symbol 0 to the last symbol
  //   present.
  // EVIDENCE: LOG/065 — the code's range depends on k and caps above k = 128: LOG/055's [0, 2k) is
  //   right below and wrong above, where the field is 7 bits at k = 130..190 and 6 at k = 200.
  // EVIDENCE: LOG/069 — the range is `2 * min(k, 257 - k)`: sixty gapped alphabets above k = 128
  //   each parse at that one value and no other, and run counts placed on the truncated-binary
  //   threshold at k = 40..128 parse only at 2k.
  // Truncated binary (the "phase-in code", Salomon, *Data Compression*, §2.9) is textbook; what is
  // measured is that this field carries runs-1 over that range.
  // EVIDENCE: LOG/069 — the range is 2k up to k = 128 and 2(257 - k) from 129 to 255
  const RUN_RANGE_PIVOT = 257;
  const TABLE_FULL_ALPHABET = 256;

  function readTruncBin(pay, p, n) {
    const w = 31 - Math.clz32(n);
    const u = 2 ** (w + 1) - n;
    const lo = bitsMSB(pay, p, w);
    if (lo === null) return null;
    if (lo < u) return { v: lo, bits: w };
    const hi = bitsMSB(pay, p, w + 1);
    if (hi === null) return null;
    return { v: hi - u, bits: w + 1 };
  }

  // EVIDENCE: LOG/056 — the length array is a Rice code of a zigzag-folded prediction error: k unary
  //   quotients in one region and k F-bit remainders in another, so the array's extra bits number
  //   exactly k*F. Measured over seven (k, F) combinations and confirmed by 484 rebuilt tables.
  // EVIDENCE: LOG/057 — the prediction is an integrator: P = 8 - floor((A+1)/4) over A, the running
  //   sum of P - L. 484 of 484 tables from k = 5 to 80 reproduce their quotient and remainder streams
  //   exactly, as do all 4347 Kraft-complete assignments at k=7.
  const PREDICT_INITIAL = 8;
  const PREDICT_GAIN = 4;

  // EVIDENCE: LOG/057 — the accumulator is bounded in practice by the code depths, but a corrupt
  //   stream can drive it anywhere; this bound keeps the prediction inside the range a code length
  //   can occupy rather than letting it wander into a wrong-but-plausible table.
  const PREDICT_MIN = 1;
  const PREDICT_MAX = MAX_CODE_BITS;

  const unzigzag = v => (v % 2 === 0 ? v / 2 : -(v + 1) / 2);

  // EVIDENCE: LOG/059 — a run's length is Elias-gamma coded, and the two run kinds use different
  //   members of the family: a *present* run of n symbols is plain gamma, `z` extra bits and
  //   n = 2^z + e, while an *absent* run takes `z+1` extra bits and n = 2^(z+1) - 1 + e, which is
  //   LOG/047's code. The codes sit in one region and the extra bits in another, in the order
  //   [quotients][run codes][remainders][run extras].
  const RUN_MAX_Z = 24;

  /**
   * Read a form-1 table. Returns { syms, lens, bytes } or null.
   *
   * The four regions are read in the order the format writes them: the k unary quotients, then the
   * run codes for the symbol set, then the k Rice remainders, then the run codes' extra bits.
   */
  function readCodedTable(pay) {
    if (bitsMSB(pay, 0, 1) !== TABLE_FORM_CODED) return null;
    const F = bitsMSB(pay, 1, TABLE_F_BITS);
    const k1 = bitsMSB(pay, 1 + TABLE_F_BITS, TABLE_K1_BITS);
    if (F === null || k1 === null) return null;
    const k = k1 + 1;
    if (k < 1) return null;

    let p = 1 + TABLE_F_BITS + TABLE_K1_BITS;
    // EVIDENCE: LOG/069 — at k = 256 there is no field: 7463 corpus tables and a chosen block parse
    //   only with a zero-width field there, and the symbol set is the whole alphabet
    let runs = 1;
    if (k < TABLE_FULL_ALPHABET) {
      const field = readTruncBin(pay, p, 2 * Math.min(k, RUN_RANGE_PIVOT - k));
      if (!field) return null;
      runs = field.v + 1;
      p += field.bits;
    }

    // region 1: k unary quotients
    const q = new Array(k);
    for (let i = 0; i < k; i++) {
      let z = 0;
      for (;;) {
        const b = bitsMSB(pay, p + z, 1);
        if (b === null) return null;
        if (b === 1) break;
        if (++z > RUN_MAX_Z) return null;
      }
      q[i] = z;
      p += z + 1;
    }

    // region 2: one run code per coded run; the last run is implied by k
    const nRuns = runs - 1;
    const rz = new Array(nRuns);
    for (let i = 0; i < nRuns; i++) {
      let z = 0;
      for (;;) {
        const b = bitsMSB(pay, p + z, 1);
        if (b === null) return null;
        if (b === 1) break;
        if (++z > RUN_MAX_Z) return null;
      }
      rz[i] = z;
      p += z + 1;
    }

    // region 3: k remainders of F bits
    const lens = new Array(k);
    {
      let A = 0;
      for (let i = 0; i < k; i++) {
        let r = 0;
        if (F > 0) {
          r = bitsMSB(pay, p, F);
          if (r === null) return null;
          p += F;
        }
        const P = PREDICT_INITIAL - Math.floor((A + 1) / PREDICT_GAIN);
        if (P < PREDICT_MIN || P > PREDICT_MAX) return null;
        const L = P + unzigzag((q[i] << F) | r);
        if (L < 1 || L > MAX_CODE_BITS) return null;
        lens[i] = L;
        A += P - L;
      }
    }

    // region 4: the run codes' extra bits, then the symbol set they describe
    // EVIDENCE: LOG/055 — the runs alternate and the last one is present, so the parity of `runs`
    //   says whether the first is present; the last run's length is whatever leaves k symbols.
    const firstPresent = (runs % 2) === 1;

    const runLen = new Array(nRuns);
    for (let i = 0; i < nRuns; i++) {
      const z = rz[i];
      const isPresent = firstPresent === ((i % 2) === 0);
      const width = isPresent ? z : z + 1;
      if (width > 30) return null;
      let e = 0;
      if (width > 0) {
        e = bitsMSB(pay, p, width);
        if (e === null) return null;
        p += width;
      }
      runLen[i] = isPresent ? 2 ** z + e : 2 ** (z + 1) - 1 + e;
    }

    const syms = [];
    let at = 0;
    let present = firstPresent;
    for (let i = 0; i < nRuns; i++) {
      const n = runLen[i];
      if (n < 1 || at + n > 256) return null;
      if (present) for (let j = 0; j < n; j++) { if (syms.length >= k) return null; syms.push(at + j); }
      at += n;
      present = !present;
    }
    if (!present) return null;                 // the implied final run must be a present one
    const tail = k - syms.length;
    // EVIDENCE: LOG/101 — the implied final run is a present run of at least one symbol: never
    //   empty over 185,079 tables, and the oracle refuses the table whose runs leave it empty
    if (tail < 1 || at + tail > 256) return null;
    for (let j = 0; j < tail; j++) syms.push(at + j);
    if (syms.length !== k) return null;

    return { syms, lens, bytes: (p + 7) >> 3 };
  }

  /**
   * Build the canonical decode tables for a table's entries.
   *
   * EVIDENCE: LOG/045 — the code is canonical over the entries in *table* order: shortest length
   *   first, ties broken by position in the table rather than by symbol value. The k=4 case with
   *   lengths 1,2,3,3 and the one with symbols 7,60,131,200 both exercise the tie-break, and both
   *   reproduce 4096 chosen symbols exactly.
   *
   * Canonical Huffman itself is textbook — Schwartz and Kallick, CACM 7(3), 1964 — and long predates
   * this format; what is measured is the ordering above.
   *
   * Returns null when the lengths are not a complete prefix code, which is the check that makes a
   * mis-parsed table fail loudly instead of producing a plausible wrong buffer.
   */
  function buildCanonical(syms, lens) {
    let maxLen = 0;
    for (const L of lens) if (L > maxLen) maxLen = L;
    if (maxLen === 0 || maxLen > MAX_CODE_BITS) return null;

    // Kraft equality, in integers: the lengths must sum to exactly one complete code.
    let kraft = 0;
    for (let i = 0; i < lens.length; i++) kraft += 1 << (maxLen - lens[i]);   // maxLen <= 30, so this is exact
    if (kraft !== 1 << maxLen) return null;

    // The entries by (length, position): a counting sort, which keeps table order within a length
    const n = lens.length;
    const count = new Int32Array(maxLen + 2);
    for (let i = 0; i < n; i++) count[lens[i]]++;
    const next = new Int32Array(maxLen + 2);
    for (let L = 1; L <= maxLen; L++) next[L + 1] = next[L] + count[L];
    const order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[next[lens[i]]++] = i;

    const firstCode = new Int32Array(maxLen + 2).fill(-1);
    const firstIndex = new Int32Array(maxLen + 2).fill(-1);
    const symbols = new Int32Array(n);
    // EVIDENCE: LOG/106 — no table in the corpus has a code longer than 11 bits, so one table of
    //   2^maxLen entries indexed by the next maxLen stream bits decodes every symbol in one step;
    //   a deeper table keeps the bit-by-bit walk below. An entry is [length: 8][symbol: 8].
    const lut = maxLen <= HUFF_LUT_MAX_BITS ? new Uint16Array(1 << maxLen) : null;

    let code = 0;
    let prev = lens[order[0]];
    for (let i = 0; i < n; i++) {
      const L = lens[order[i]];
      code <<= (L - prev);
      prev = L;
      if (firstCode[L] < 0) { firstCode[L] = code; firstIndex[L] = i; }
      const sym = syms[order[i]];
      symbols[i] = sym;
      if (lut) {
        // The stream's first bit is the code's most significant one and the table index's least
        // significant one (the reader below keeps the next bit at bit 0), so the code goes in reversed
        let rev = 0;
        for (let j = 0, cc = code; j < L; j++, cc >>= 1) rev = (rev << 1) | (cc & 1);
        const entry = (L << 8) | sym;
        for (let hi = 0, step = 1 << L; rev + hi < lut.length; hi += step) lut[rev + hi] = entry;
      }
      code++;
    }
    return { maxLen, firstCode, firstIndex, count, symbols, lut };
  }

  /**
   * The one-step form of decodeHuffStream, for a code whose table was built: the next `maxLen`
   * stream bits index the table, which says the symbol and how many of them to consume.
   *
   * EVIDENCE: LOG/044 — the same two bit orders: each byte low bit first, the forward stream walking
   *   bytes upward from the first and the backward stream downward from the last. The window keeps
   *   the next unread bit at bit 0, so a byte goes in as it is from either end.
   * EVIDENCE: LOG/106 — one lookup per symbol in place of one step per bit
   *
   * Returns the number of bits consumed, or -1 if the stream ran out.
   */
  function decodeHuffStreamLut(bytes, backward, cw, n, dst, at, stride) {
    const total = bytes.length * 8;
    const lut = cw.lut;
    const mask = lut.length - 1;
    let p = 0;
    let w = at;
    let word = 0, have = 0;
    let next = backward ? bytes.length - 1 : 0;
    for (let i = 0; i < n; i++) {
      // Top the window up to 25..32 bits; past the end the bytes are zero, and a code that needs
      // them fails the bound below
      if (backward) {
        while (have <= 24) { word |= (next >= 0 ? bytes[next] : 0) << have; have += 8; next--; }
      } else {
        while (have <= 24) { word |= (next < bytes.length ? bytes[next] : 0) << have; have += 8; next++; }
      }
      const e = lut[word & mask];
      const len = e >>> HUFF_LUT_LENGTH_SHIFT;
      if (len === 0 || p + len > total) return -1;
      dst[w] = e & HUFF_LUT_SYMBOL_MASK;
      w += stride;
      word >>>= len; have -= len; p += len;
    }
    return p;
  }

  /**
   * Decode `n` symbols out of one stream into `dst`, writing at `at` and every `stride` bytes after.
   *
   * EVIDENCE: LOG/044 — a forward stream takes bits from the low bit of each byte upward; the
   *   backward stream is its exact mirror, taken from the last byte down; in both, the code is
   *   accumulated most significant bit first. All eight combinations were enumerated and exactly one
   *   matched each stream, with no partial matches.
   *
   * Returns the number of bits consumed, or -1 if the stream ran out or produced no code.
   */
  function decodeHuffStream(bytes, backward, cw, n, dst, at, stride) {
    if (cw.lut) return decodeHuffStreamLut(bytes, backward, cw, n, dst, at, stride);
    const total = bytes.length * 8;
    let p = 0;
    let w = at;
    for (let i = 0; i < n; i++) {
      let code = 0;
      let len = 0;
      for (;;) {
        if (p >= total) return -1;
        const j = backward ? total - 1 - p : p;
        const bit = backward
          ? (bytes[j >> 3] >> (7 - (j & 7))) & 1
          : (bytes[j >> 3] >> (j & 7)) & 1;
        p++;
        code = (code << 1) | bit;
        len++;
        if (len > cw.maxLen) return -1;
        const c = cw.count[len];
        if (c > 0 && code >= cw.firstCode[len] && code - cw.firstCode[len] < c) {
          dst[w] = cw.symbols[cw.firstIndex[len] + (code - cw.firstCode[len])];
          w += stride;
          break;
        }
      }
    }
    return p;
  }

  // EVIDENCE: LOG/044 — a type-0x20 payload is `[table][le16 S][stream 0: S bytes][shared region]`,
  //   with stream 1 read forward from the first byte of the shared region and stream 2 backward from
  //   its last. There is one length field because the third boundary is where the two cursors meet.
  const STREAM_LENGTH_BYTES = 2;

  // EVIDENCE: LOG/036 — output position i goes to stream 0 when i mod 3 is 0, to stream 1 when it is
  //   2, and to stream 2 when it is 1. Established by exhaustive check against 4096 known symbols,
  //   every other assignment having failed outright.
  const STREAM_OF_RESIDUE = [0, 2, 1];

  // EVIDENCE: LOG/040 — 458 of the working set's coded sub-streams carry this type, the largest
  //   entropy cluster after 0x50 and 0x10
  const BLOCK_TYPE_HUFF3 = 0x20;

  // The bits each of the three streams used in the last decodeHuffGroupLut call
  const huffUsed = new Int32Array(3);

  /**
   * The three streams of a group decoded in step: one round writes output positions 3j, 3j + 1
   * and 3j + 2 from streams 0, 2 and 1, so the writes are sequential and the three windows are
   * independent work for the processor. The last one or two symbols, when `emits` is not a
   * multiple of three, come from streams 0 and 2 in that order.
   *
   * Each stream is bounded by its own bytes, as in decodeHuffStream: stream 0 by the S bytes,
   * streams 1 and 2 each by the whole shared region; the caller's tiling check pins the two
   * (LOG/051). False if any stream runs out; the bits used go to `huffUsed`.
   *
   * EVIDENCE: LOG/044 — the bit orders and which stream reads from where; LOG/036 — position i
   *   goes to stream 0, 2, 1 as i mod 3 is 0, 1, 2
   * EVIDENCE: LOG/106 — three symbols a round in place of three passes
   */
  function decodeHuffGroupLut(s0, shared, cw, emits, dst, out) {
    const lut = cw.lut, mask = lut.length - 1;
    const S = s0.length, SL = shared.length;
    const total0 = S * 8, totalS = SL * 8;
    let w0 = 0, h0 = 0, n0 = 0, p0 = 0;            // stream 0: forward over s0
    let w1 = 0, h1 = 0, n1 = 0, p1 = 0;            // stream 1: forward over the shared region
    let w2 = 0, h2 = 0, n2 = SL - 1, p2 = 0;       // stream 2: backward over the shared region
    const rounds = (emits / 3) | 0;
    let o = out;
    for (let j = 0; j < rounds; j++) {
      while (h0 <= 24) { w0 |= (n0 < S ? s0[n0] : 0) << h0; h0 += 8; n0++; }
      while (h1 <= 24) { w1 |= (n1 < SL ? shared[n1] : 0) << h1; h1 += 8; n1++; }
      while (h2 <= 24) { w2 |= (n2 >= 0 ? shared[n2] : 0) << h2; h2 += 8; n2--; }
      const e0 = lut[w0 & mask], e2 = lut[w2 & mask], e1 = lut[w1 & mask];
      const l0 = e0 >>> HUFF_LUT_LENGTH_SHIFT, l2 = e2 >>> HUFF_LUT_LENGTH_SHIFT, l1 = e1 >>> HUFF_LUT_LENGTH_SHIFT;
      p0 += l0; p1 += l1; p2 += l2;
      if (l0 === 0 || l1 === 0 || l2 === 0 || p0 > total0 || p1 > totalS || p2 > totalS) return false;
      dst[o] = e0 & HUFF_LUT_SYMBOL_MASK; dst[o + 1] = e2 & HUFF_LUT_SYMBOL_MASK; dst[o + 2] = e1 & HUFF_LUT_SYMBOL_MASK;
      o += 3;
      w0 >>>= l0; h0 -= l0; w1 >>>= l1; h1 -= l1; w2 >>>= l2; h2 -= l2;
    }
    const tail = emits - 3 * rounds;
    if (tail >= 1) {
      while (h0 <= 24) { w0 |= (n0 < S ? s0[n0] : 0) << h0; h0 += 8; n0++; }
      const e0 = lut[w0 & mask], l0 = e0 >>> HUFF_LUT_LENGTH_SHIFT;
      p0 += l0;
      if (l0 === 0 || p0 > total0) return false;
      dst[o] = e0 & HUFF_LUT_SYMBOL_MASK;
    }
    if (tail === 2) {
      while (h2 <= 24) { w2 |= (n2 >= 0 ? shared[n2] : 0) << h2; h2 += 8; n2--; }
      const e2 = lut[w2 & mask], l2 = e2 >>> HUFF_LUT_LENGTH_SHIFT;
      p2 += l2;
      if (l2 === 0 || p2 > totalS) return false;
      dst[o + 1] = e2 & HUFF_LUT_SYMBOL_MASK;
    }
    huffUsed[0] = p0; huffUsed[1] = p1; huffUsed[2] = p2;
    return true;
  }

  /**
   * Decode one three-stream group — `[le16 S][stream 0: S bytes][shared region]` — of `emits`
   * symbols with the code `cw`, writing at `out`. Returns true if the group's bytes were consumed
   * exactly.
   *
   * EVIDENCE: LOG/044 — the body's shape; LOG/036 — the interleave; LOG/051 — the byte tiling
   */
  function decodeHuffGroup(pay, cw, emits, dst, out) {
    if (STREAM_LENGTH_BYTES > pay.length) return false;
    const S = pay[0] | (pay[1] << 8);
    const base = STREAM_LENGTH_BYTES;
    if (base + S > pay.length) return false;
    const s0 = pay.subarray(base, base + S);
    const shared = pay.subarray(base + S);
    if (shared.length === 0) return false;

    // how many symbols each stream carries, from the residue classes alone: positions 0, 3, 6, …
    // go to stream STREAM_OF_RESIDUE[0], positions 1, 4, 7, … to STREAM_OF_RESIDUE[1], and so on
    const counts = [0, 0, 0];
    counts[STREAM_OF_RESIDUE[0]] = ((emits + 2) / 3) | 0;
    counts[STREAM_OF_RESIDUE[1]] = ((emits + 1) / 3) | 0;
    counts[STREAM_OF_RESIDUE[2]] = (emits / 3) | 0;

    if (out + emits > dst.length) return false;
    let used0, used1, used2;
    if (cw.lut) {
      if (!decodeHuffGroupLut(s0, shared, cw, emits, dst, out)) return false;
      used0 = huffUsed[0]; used1 = huffUsed[1]; used2 = huffUsed[2];
    } else {
      used0 = decodeHuffStream(s0, false, cw, counts[0], dst, out + 0, 3);
      if (used0 < 0) return false;
      used1 = decodeHuffStream(shared, false, cw, counts[1], dst, out + 2, 3);
      if (used1 < 0) return false;
      used2 = decodeHuffStream(shared, true, cw, counts[2], dst, out + 1, 3);
      if (used2 < 0) return false;
    }

    // EVIDENCE: LOG/051 — each stream occupies exactly ceil(bits/8) bytes, and the shared region is
    //   exactly the two of them abutting. Established by construction over all 64 pad pairs and
    //   confirmed on six compressor-built blocks, which obey it on the nose. LOG/044's "6 to 12 bits"
    //   of slack is these two independent pads summed, not a bound on the total.
    //
    // This is the check that makes a mis-parsed table or a corrupt length field fail here rather than
    // produce a plausible buffer: it pins the byte counts exactly instead of merely forbidding the
    // two cursors from crossing.
    if (S !== ((used0 + 7) >> 3)) return false;
    if (shared.length !== ((used1 + 7) >> 3) + ((used2 + 7) >> 3)) return false;
    return true;
  }

  // EVIDENCE: LOG/068 — a type-0x40 payload is [table][le24 L1][group 1: L1 bytes][group 2], the
  //   first group carrying the first ceil(n/2) symbols and the second the rest; each group is a
  //   type-0x20 body over the one table. Nine chosen blocks over 2..64 symbols rebuilt group by
  //   group as type-0x20 blocks decode to the input halves through the oracle and through this code.
  const BLOCK_TYPE_HUFF6 = 0x40;
  const GROUP_LENGTH_BYTES = 3;

  /**
   * Decode a type-0x20 or type-0x40 entropy block into `dst` at `out`, or return false.
   *
   * Both table forms are read: form 0 (LOG/045) and form 1 (LOG/046, LOG/055, LOG/056, LOG/057).
   * Every type-0x20 table in the working set is form 1, so form 1 is the one that carries coverage.
   */
  function decodeHuffBlock(type, src, content, len, emits, dst, out) {
    if (len < 1 || content + len > src.length) return false;
    const pay = src.subarray(content, content + len);

    const t = readPlainTable(pay) || readCodedTable(pay);
    if (!t) return false;
    const cw = buildCanonical(t.syms, t.lens);
    if (!cw) return false;

    if (type === BLOCK_TYPE_HUFF3) {
      return decodeHuffGroup(pay.subarray(t.bytes), cw, emits, dst, out);
    }
    // EVIDENCE: LOG/068 — two groups, split at ceil(n/2), the first sized by a 24-bit field
    if (t.bytes + GROUP_LENGTH_BYTES > pay.length) return false;
    const L1 = pay[t.bytes] | (pay[t.bytes + 1] << 8) | (pay[t.bytes + 2] << 16);
    const g1 = t.bytes + GROUP_LENGTH_BYTES;
    if (g1 + L1 > pay.length) return false;
    const n1 = Math.ceil(emits / 2);
    if (!decodeHuffGroup(pay.subarray(g1, g1 + L1), cw, n1, dst, out)) return false;
    return decodeHuffGroup(pay.subarray(g1 + L1), cw, emits - n1, dst, out + n1);
  }

  // ---------------------------------------------------------------------------------------------
  // Type 0x30: the run coder (LOG/035, LOG/095)
  // ---------------------------------------------------------------------------------------------
  // EVIDENCE: LOG/029 — a one-byte payload is a constant run of that byte
  // EVIDENCE: LOG/035 — the payload is a literal region and a bit stream read from the end
  // EVIDENCE: LOG/095 — byte 0 is 0x00 for a raw region (from byte 1, implicit length) and otherwise
  //   a sub-stream header whose decoded bytes are the literals; the bit code below; the run symbol
  //   starts at 0x00 and is replaced by the next literal on the switch escape
  const BLOCK_TYPE_RUNS = 0x30;
  const RUNS_RAW_REGION = 0x00;
  const RUNS_INITIAL_SYMBOL = 0x00;
  const RUNS_SHORT_MIN = 3;            // p >= 3: a short item, run p, literal field f -> 15 - f
  const RUNS_SHORT_LITERAL_MAX = 15;
  const RUNS_LONG = 1;                 // p = 1: six bits run, six bits literals
  const RUNS_LONG_PLUS_64 = 2;         // p = 2: the same with 64 added to the run
  const RUNS_LONG_BIAS = 64;
  const RUNS_LONG_BITS = 6;
  const RUNS_ESCAPE = 0;               // p = 0: a four-bit escape follows
  const ESC_FIFTEEN_LITERALS = 0;
  const ESC_SWITCH_SYMBOL = 1;
  const ESC_LITERALS_64 = 2;           // eight bits k: 64 (k + 1) literals
  // EVIDENCE: LOG/105 — q = 2..8 is one item: 16384 (q - 2) + 64 (k + 1) literals
  const ESC_LITERALS_64_MAX = 8;
  const ESC_LITERALS_HIGH_UNIT = 256;  // one step of q is 256 units of 64 (16384 bytes)
  const ESC_RUN_128 = 9;               // eight bits k: a run of 128 (k + 1)
  // EVIDENCE: LOG/103 — q = 9..12 is one item: a run of 128 (256 (q - 9) + k + 1); q = 12, k = 255
  //   fills a 131072 chunk exactly. q = 13..15 are not accepted at the sizes the pattern predicts
  const ESC_RUN_128_MAX = 12;
  const ESC_RUN_HIGH_UNIT = 256;       // one step of q is 256 units of 128 (32768 bytes)
  const ESC_COUNT_BITS = 8;
  const ESC_LITERALS_UNIT = 64;
  const ESC_RUN_UNIT = 128;
  const ESC_FIFTEEN = 15;

  /**
   * Decode a type-0x30 payload of `len` bytes at src[at] into dst[out .. out + dec).
   *
   * EVIDENCE: LOG/095 — the whole reading; 2364 of 2364 corpus payloads exact against the oracle
   */
  function decodeRunBlock(src, at, len, dec, dst, out) {
    if (len < 1) return guard("empty type-0x30 payload");
    if (len === 1) { dst.fill(src[at], out, out + dec); return true; }
    const end = at + len;
    // The literal region
    let lits, litAt, litEnd, bitsStart;
    if (src[at] === RUNS_RAW_REGION) {
      lits = src; litAt = at + 1; litEnd = end;        // raw: the bits' bytes bound it from the end
      bitsStart = at + 1;
    } else {
      const item = readItem(src, at, end);
      if (!item || !item.coded) return guard("type-0x30 literal item is not a coded sub-stream");
      if (!materialize(src, item)) return false;
      lits = item.buf; litAt = item.at; litEnd = item.at + item.len;
      bitsStart = item.next;
    }
    // The bit reader, from the last byte backward, MSB first within a byte
    const reader = new BitsMsb(src, end - 1, -1, end - bitsStart);
    const bits = (n) => { const v = reader.bits(n); return v === null ? -1 : v; };
    const raw = src[at] === RUNS_RAW_REGION;
    let sym = RUNS_INITIAL_SYMBOL;
    let o = out;
    const outEnd = out + dec;
    // Items while something is left to read: for a raw region, until the literal cursor and the bit
    // reader's bytes meet; for a coded one, until the literals are used and the bits' bytes are
    for (;;) {
      const bitBytes = (reader.pos + 7) >> 3;
      if (raw) { if (litAt + bitBytes >= end) break; }
      else if (litAt >= litEnd && bitsStart + bitBytes >= end) break;
      const p = bits(4);
      if (p < 0) return guard("type-0x30 bit stream exhausted");
      let run, count;
      if (p >= RUNS_SHORT_MIN) {
        const f = bits(4);
        if (f < 0) return guard("type-0x30 bit stream exhausted");
        run = p; count = RUNS_SHORT_LITERAL_MAX - f;
      } else if (p === RUNS_LONG || p === RUNS_LONG_PLUS_64) {
        run = bits(RUNS_LONG_BITS); count = bits(RUNS_LONG_BITS);
        if (run < 0 || count < 0) return guard("type-0x30 bit stream exhausted");
        if (p === RUNS_LONG_PLUS_64) run += RUNS_LONG_BIAS;
      } else {
        const q = bits(4);
        if (q < 0) return guard("type-0x30 bit stream exhausted");
        if (q === ESC_SWITCH_SYMBOL) {
          if (litAt >= litEnd) return guard("type-0x30 symbol switch past the literals");
          sym = lits[litAt++];
          continue;
        } else if (q === ESC_FIFTEEN_LITERALS) { run = 0; count = ESC_FIFTEEN; }
        else if (q >= ESC_LITERALS_64 && q <= ESC_LITERALS_64_MAX) { const k = bits(ESC_COUNT_BITS); if (k < 0) return guard("type-0x30 bit stream exhausted"); run = 0; count = ESC_LITERALS_UNIT * (ESC_LITERALS_HIGH_UNIT * (q - ESC_LITERALS_64) + k + 1); }
        else if (q >= ESC_RUN_128 && q <= ESC_RUN_128_MAX) { const k = bits(ESC_COUNT_BITS); if (k < 0) return guard("type-0x30 bit stream exhausted"); run = ESC_RUN_UNIT * (ESC_RUN_HIGH_UNIT * (q - ESC_RUN_128) + k + 1); count = 0; }
        else return guard(`type-0x30 escape ${q}`);
      }
      if (o + count + run > outEnd) return guard("type-0x30 item overruns the output");
      if (litAt + count > litEnd) return guard("type-0x30 literals exhausted");
      if (count > 32) { dst.set(lits.subarray(litAt, litAt + count), o); o += count; litAt += count; }
      else for (let i = 0; i < count; i++) dst[o++] = lits[litAt++];
      if (run > 32) dst.fill(sym, o, o + run);
      else for (let i = 0; i < run; i++) dst[o + i] = sym;
      o += run;
    }
    const bitBytes = (reader.pos + 7) >> 3;
    if (raw) { if (litAt + bitBytes !== end) return guard("type-0x30 literals and bits do not meet"); }
    else { if (litAt !== litEnd) return guard("type-0x30 coded literals left unread"); if (bitsStart + bitBytes !== end) return guard("type-0x30 bits do not fill the payload"); }
    if (o !== outEnd) return guard("type-0x30 output falls short");
    return true;
  }

  // EVIDENCE: LOG/013 — mode 0x88 is the commonest chunk mode, 5352 of the 9717 chunks that parse
  const CHUNK_MODE_LZ = 0x88;
  // EVIDENCE: LOG/091 — mode 0x80 is the same walk with each literal added to the byte reps[0] back
  const CHUNK_MODE_LZ_DELTA = 0x80;
  // EVIDENCE: LOG/093 — mode 0x90 is the delta walk with the first literal of every run in a
  //   stream of its own, behind an interleave section
  const CHUNK_MODE_LZ_SPLIT = 0x90;
  // EVIDENCE: LOG/094 — 0x98: four lists by output position mod 4, delta; 0xa0: sixteen lists by
  //   the previous byte's high nibble, plain; 0xa8: sixteen lists by output position mod 16, delta
  const CHUNK_MODE_LZ_MOD4 = 0x98;
  const CHUNK_MODE_LZ_CONTEXT = 0xa0;
  const CHUNK_MODE_LZ_MOD16 = 0xa8;
  const isDeltaMode = (m) => m === CHUNK_MODE_LZ_DELTA || m === CHUNK_MODE_LZ_SPLIT || m === CHUNK_MODE_LZ_MOD4 || m === CHUNK_MODE_LZ_MOD16 || (extraDeltaModes && extraDeltaModes.has(m));
  const isContainerMode = (m) => m === CHUNK_MODE_LZ || m === CHUNK_MODE_LZ_DELTA || m === CHUNK_MODE_LZ_SPLIT || m === CHUNK_MODE_LZ_MOD4 || m === CHUNK_MODE_LZ_CONTEXT || m === CHUNK_MODE_LZ_MOD16;
  // How many literal lists a mode's chunk carries, and which list the i-th literal of a run at
  // output position p is read from.
  // EVIDENCE: LOG/093 — mode 0x90: two lists, the first literal of a run from the second
  // EVIDENCE: LOG/094 — the four- and sixteen-list modes and their selectors
  const SPLIT_FIRST_LIST = 1;
  const MOD4_LISTS = 4, MOD4_MASK = 3;
  const MOD16_LISTS = 16, MOD16_MASK = 15;
  const CONTEXT_LISTS = 16, CONTEXT_SHIFT = 4;
  function literalListCount(m) {
    if (m === CHUNK_MODE_LZ_SPLIT) return 2;
    if (m === CHUNK_MODE_LZ_MOD4) return MOD4_LISTS;
    if (m === CHUNK_MODE_LZ_CONTEXT) return CONTEXT_LISTS;
    if (m === CHUNK_MODE_LZ_MOD16) return MOD16_LISTS;
    if (extraLiteralLists && extraLiteralLists.has(m)) return extraLiteralLists.get(m).count;
    return 0;
  }

  /**
   * Decode every chunk of a coded unit, or return false if any one of them is not understood.
   *
   * EVIDENCE: LOG/013 — the chunk chain and each chunk's output size
   */
  function decodeChunkedUnit(src, u, dst, out) {
    const cs = parseChunks(src, u);
    if (!cs) return false;
    let at = out;
    for (const c of cs) {
      if (c.block) {
        // EVIDENCE: LOG/033 — a block chunk is the entropy layer. Types 0x20 and 0x40 are read
        //   (LOG/044, LOG/045, LOG/068) and type 0x10 (LOG/086); any other block is refused, not
        //   guessed at
        if (c.mode === BLOCK_TYPE_TANS) {
          if (!decodeTansBlock(src, c.content, c.len, c.emits, dst, at)) return guard("type-0x10 block chunk did not decode");
        } else if (c.mode === BLOCK_TYPE_RUNS) {
          // EVIDENCE: LOG/095 — the run coder as a block chunk
          if (!decodeRunBlock(src, c.content, c.len, c.emits, dst, at)) return false;
        } else if (c.mode === BLOCK_TYPE_SEQUENCE) {
          // EVIDENCE: LOG/100 — the sequence form as a block chunk, four payloads against the oracle
          const scratch = new Uint8Array(c.emits);
          if (!decodeCoded(c.mode, src, c.content, c.len, c.emits, scratch)) return false;
          dst.set(scratch, at);
        } else {
          if (c.mode !== BLOCK_TYPE_HUFF3 && c.mode !== BLOCK_TYPE_HUFF6) return guard(`block chunk type 0x${c.mode.toString(16)}`);
          if (!decodeHuffBlock(c.mode, src, c.content, c.len, c.emits, dst, at)) return guard(`type-0x${c.mode.toString(16)} block chunk did not decode`);
        }
      } else {
        if (!isContainerMode(c.mode) && !(extraLzModes && extraLzModes.has(c.mode))) return guard(`chunk mode 0x${c.mode.toString(16)}`);
        if (!decodeTokenChunk(src, c, dst, at)) return false;
      }
      at += c.emits;
    }
    return true;
  }


  // EVIDENCE: LOG/010 — mode byte 0x30 selects the shape decoded below
  const MODE_LITERAL_RUN = 0x30;

  // EVIDENCE: LOG/010 — be16 of the unit body's first two bytes is 4 * (emits - 1): `7f fc` pins the
  // unit's output to exactly 8192, and rawSize 8191, 8193, 4096, 16384 and 262144 are all refused
  const SUBHEADER_SCALE = 4;

  // EVIDENCE: LOG/010 — the four-byte tail begins `3e 09` in all seven corpus units of this shape and
  // in every accepted construction; sweeping either byte alone finds no other accepted value
  const TAIL_MARK_0 = 0x3e;
  const TAIL_MARK_1 = 0x09;

  // EVIDENCE: LOG/010 — the rule predicts the oracle exactly for n = 1..63 and fails for every n from
  // 64 to 120, which is the six bits XX has for n
  const LITERAL_RUN_MAX = 63;

  /**
   * Decode the one coded shape established so far: `n` literal bytes followed by zeros.
   *
   * Returns true if the unit had this shape and was decoded, false if it did not — the caller turns
   * a false into a refusal. Every field is checked before anything is written, so a unit that merely
   * resembles this shape is rejected rather than half-decoded.
   *
   * EVIDENCE: LOG/010 — grammar, the (XX, YY) rule, and its range, all established by constructing
   *   streams absent from the corpus and predicting the oracle's output
   */
  function decodeLiteralRun(src, u, dst, out) {
    if (u.mode !== MODE_LITERAL_RUN) return false;
    const b = u.body;

    // EVIDENCE: LOG/010 — the body's own length field is bodyLen - 4 in every unit of this shape
    const subLen = (src[b + 2] << 8) | src[b + 3];
    if (subLen !== u.len - 4) return false;

    // EVIDENCE: LOG/010 — `7f fc` decodes only at an output length of exactly 8192
    const scaled = (src[b] << 8) | src[b + 1];
    if (scaled !== SUBHEADER_SCALE * (u.emits - 1)) return false;

    // EVIDENCE: LOG/010 — all 256 values tried for this byte; only 0x00 is accepted
    if (src[b + 4] !== 0x00) return false;

    const n = u.len - 9;
    if (n < 1 || n > LITERAL_RUN_MAX || n > u.emits) return false;

    const tail = b + u.len - 4;
    if (src[tail] !== TAIL_MARK_0 || src[tail + 1] !== TAIL_MARK_1) return false;
    // EVIDENCE: LOG/010 — XX = n + 64*((-n) & 3) and YY = 0x30 - ceil(n/4), the unique exact pair
    // found by sweeping all 65536 (XX, YY) combinations for each n from 1 to 40
    if (src[tail + 2] !== ((n + 64 * ((-n) & 3)) & 0xff)) return false;
    if (src[tail + 3] !== ((0x30 - Math.ceil(n / 4)) & 0xff)) return false;

    dst.set(src.subarray(b + 5, b + 5 + n), out);
    dst.fill(0, out + n, out + u.emits);
    return true;
  }

  /**
   * Decode one complete payload.
   *
   * EVIDENCE: LOG/002 — rawSize is authoritative: the decoder emits exactly that many bytes or
   *   refuses. One accepted length out of 22 probed on c000238.
   */
  function decompress(src, rawSize) {
    const units = parseUnits(src, rawSize);
    const dst = new Uint8Array(rawSize);
    let out = 0;

    for (const u of units) {
      if (u.kind === "fill") {
        // EVIDENCE: LOG/004 — header byte 5 is the byte to repeat; sweeping it over all 256 values
        // produced 256 distinct constant outputs
        dst.fill(u.value, out, out + u.emits);
      } else if (u.kind === "stored") {
        // EVIDENCE: LOG/008 — the bytes after a stored unit's two-byte header are the output verbatim
        dst.set(src.subarray(u.body, u.body + u.emits), out);
      } else if ((lastGuard = "", !decodeLiteralRun(src, u, dst, out) && !decodeChunkedUnit(src, u, dst, out))) {
        // A failed chunk may already have written part of `dst`; that is harmless because the only
        // path out of here throws, and `decompress` never returns a buffer it did not fill.
        // The unit is refused either way; naming the chunk that stopped us makes the failure
        // clusters of PLAN.md Phase 3 readable straight out of `npm run verify`.
        const cs = parseChunks(src, u);
        const where = cs
          ? `chunks [${cs.map((c) => `0x${c.mode.toString(16)}/${c.len}B${c.block ? " block" : ""}`).join(", ")}]`
          : `body does not tile as a chunk chain`;
        throw new Error(
          `coded unit at ${u.at} (mode 0x${u.mode.toString(16)}, ${u.len} bytes, ${where}): ` +
          (lastGuard ? `refused by: ${lastGuard}` : `the entropy layer is not implemented — PLAN.md Phase 2`)
        );
      }
      out += u.emits;
    }

    if (out !== rawSize) throw new Error(`produced ${out} bytes, expected ${rawSize}`);
    return dst;
  }

  return { decompress };
})();
/*==ENDWTLZ==*/
