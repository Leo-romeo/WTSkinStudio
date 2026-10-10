/*==MATCH==*/
"use strict";
// ---------- Search that forgives (ROADMAP 3.5) ----------
// The vehicle search was a chain of String.includes, so a typo, a missing hyphen or a transposition
// found nothing at all. Measured 2026-09-26 on a synthetic install before this existed: "f4e",
// "abrahms", "su30", "t34", "tiger 2" and "leopard2a6" each came back "No matches", while "f-4e" and
// "leopard 2a6" worked — the name was right there, and one keystroke kept it out of reach.
//
// This is the one matcher both result lists use (the vehicles and the UserSkins folder). It is pure
// — no DOM, no app state — so tools/t96_search.mjs lifts this section into Node and holds it against a
// fixed unit list, the way the codecs are held.
//
// A hit lands in one of five tiers and the tier is what results are ranked by first, so the
// exact/prefix float the old search had is still the top of the order ("f-4e" puts the F-4E above
// the F-4EJ):
//   5 exact     a whole name, separators ignored — "f4e", "f-4e" and "f 4e" are all the F-4E
//   4 prefix    the start of a name — "su30" is the start of Su-30SM, "t34" of T-34 (1941)
//   3 words     every typed word starts a word of the name, or several run together — "phantom",
//               "leo 2a6", "tiger 2" (a roman numeral also answers to its digit)
//   2 contains  the typed letters sit together inside a name — "30sm"
//   1 near      every typed word is a small edit from a word, counting letters only — "abrahms",
//               "tigre", "leopadr 2a6"
// A score is tier * 100 plus a finer order inside the tier; 0 is no match.
const Match = {
  // The game writes series numbers in roman and nobody types them that way: "tiger 2" is the
  // Tiger II and "spitfire 9" the Spitfire Mk IX. A roman word keeps its own spelling as well.
  // Marks run past ten and often carry a letter: measured 2026-09-27 over the real roster (3 294
  // vehicles), whole numerals up to ten alone let "spitfire 9" find 1 of the 4 Mk IX Spitfires (the
  // other three are "IXc"), and "spitfire 14", "spitfire 18" and "sunderland 3" nothing at all
  // ("XIVe", "XVIIIe", "IIIa"). So a numeral up to 39 answers to its digits, with the one letter
  // after it when the numeral has two or more — "ixc" is also "9c". Not after one: "it" and "il"
  // begin Italian and Israeli unit ids, "xe" is Vietnamese and "xm" an American prefix. Asked the
  // roster's own names with a number in them (2 668 queries), the rule with two letters or more
  // changes 25 answers by 63 hits and loses none; letting one letter through too changed 77 by
  // 573, reading those words as "1t", "1l", "10e" and "10m" — "leopard 1" found the Italian and
  // Israeli Leopard 2s. "Typhoon Mk Ia" pays for that: "typhoon 1" did not find it before either.
  // Only x, v and i: c, l, d and m begin too many ordinary words. Not a numeral: null.
  ONES: { "": 0, i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 },
  roman(x){
    const m = /^(x{0,3})(ix|iv|v?i{0,3})([a-z]?)$/.exec(x);
    if (!m || !(m[1] || m[2]) || (m[3] && m[1].length + m[2].length < 2)) return null;
    return String(m[1].length * 10 + Match.ONES[m[2]]) + m[3];
  },
  // Fewer characters than this — separators not counted — is not a search yet, and lists everything
  // the way an empty box does. Two is what the old box used.
  MIN: 2,
  // What a user means by a name: lower case, accents off, and every run of anything that is not a
  // letter or a digit one break between words. "F-4E", "f_4e" and "f 4e" are the same two words.
  words(s){
    return String(s == null ? "" : s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  },
  // An identifier's key, cheaply: a texture stem or a bare model id is ASCII already, and there are
  // 70 000 of them, so this skips the Unicode work `words` does for a display name.
  key(s){ return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, ""); },
  // One name, prepared once: its words, and the same words run together from each word on — so "f4"
  // is found at the start of "f 4e" — whose first entry is the key an exact or prefix match compares.
  // A name with a roman numeral in it carries a second spelling with the digits.
  field(s){
    const w = Match.words(s);
    const seq = ws => { const runs = new Array(ws.length); let acc = ""; for (let i = ws.length - 1; i >= 0; i--) runs[i] = acc = ws[i] + acc; return { w: ws, runs }; };
    const f = { seqs: [seq(w)], keys: [w.join("")], at: 0 };
    const a = w.map(x => Match.roman(x) || x);
    if (a.some((x, i) => x !== w[i])) { f.seqs.push(seq(a)); f.keys.push(a.join("")); }
    return f;
  },
  // A record is what one row is searched by: `main` its names (exact and prefix apply to them),
  // `more` words that only count as words — a nation, an operator. The same string twice is kept once.
  // `main` is in the order a user knows the names — the one on screen first, ids last — and each
  // name remembers its place (`at`) even when a repeat before it is dropped, because an exact or
  // prefix hit on an earlier name ranks above one on a later name (see `score`).
  record(main, more){
    const seen = new Set();
    const prep = list => {
      const out = [];
      (list || []).forEach((s, i) => {
        if (!s) return;
        const k = String(s).toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        const f = Match.field(s); f.at = i; out.push(f);
      });
      return out;
    };
    return { main: prep(main), more: prep(more) };
  },
  // Prepared records are cached on the row they describe. Weakly, so a rescan that builds new rows
  // takes the old ones' records with it (CLAUDE.md §3.8).
  memo: new WeakMap(),
  of(obj, build){
    let r = Match.memo.get(obj);
    if (!r) { r = build(obj); Match.memo.set(obj, r); }
    return r;
  },
  // What was typed, or null while it is too short to be a search.
  query(s){
    const words = Match.words(s), key = words.join("");
    return key.length >= Match.MIN ? { words, key } : null;
  },
  // Inside the exact and prefix tiers a hit on an earlier name ranks first: the name on screen, then
  // the full name, then the ids. Measured 2026-09-27 over the real roster: with every prefix hit
  // equal, "mig" listed the J-2, J-4, J-6A and Lim-5P — Chinese and Polish MiGs whose unit ids begin
  // "mig-" — above the MiG-15, because the tie went to the alphabet.
  //
  // And a prefix that ends where a word of the name ends ranks one step above one that ends inside a
  // word — never above an earlier name, which is two steps up. "m1" is the whole first word of "M1
  // Abrams" but only part of "M-17"'s "17"; with the two tied, the alphabet put the M-17 escort ship
  // first (found by the review of 2026-09-27; main had listed the Abrams first).
  score(q, rec){
    let best = 0;
    for (const f of rec.main) {
      const lead = Math.max(0, 49 - f.at);
      for (let j = 0; j < f.keys.length; j++) {
        const k = f.keys[j];
        if (k === q.key) return 500 + lead;             // the earliest exact name: nothing can beat it
        if (k.startsWith(q.key)) {
          const rest = k.length - q.key.length, edge = f.seqs[j].runs.some(r => r.length === rest) ? 1 : 0;
          if (400 + 2 * lead + edge > best) best = 400 + 2 * lead + edge;
        }
      }
    }
    if (best) return best;
    let sum = 0, words = true, near = true;
    for (const qw of q.words) {
      let b = 0;
      for (const f of rec.main) { const s = Match.word(qw, f); if (s > b) b = s; if (b === 3) break; }
      // A nation or an operator is a word, and the start of one only from three letters on: "is" and
      // "us" begin whole research trees ("Israel", "USA", "USSR"), so "is-2" listed nine F-4E, F-15 and
      // F-16 skins for their Israeli versions and a "II" (the review of 2026-09-27, on the real
      // install) — the whole answer, in a skins list that had no IS-2 to put first.
      if (b < 3) for (const f of rec.more) {
        let s = Match.word(qw, f);
        if (s === 2 && qw.length < 3) s = 0;
        if (s > b) b = s;
        if (b === 3) break;
      }
      if (b < 2) words = false;
      if (!b) near = false;
      sum += b;
    }
    if (words) return 300 + Math.min(99, sum);            // whole words beat word starts
    // Two characters inside a name is noise ("4e" is in half the roster); three is a search.
    if (q.key.length >= 3) for (const f of rec.main) for (const k of f.keys) {
      const i = k.indexOf(q.key);
      if (i > 0) best = Math.max(best, 250 - Math.min(i, 49));   // nearer the start ranks higher
    }
    if (best) return best;
    return near ? 100 + Math.min(99, sum) : 0;
  },
  // A name that is only a key — a texture stem, a model with no unit record — answers the three
  // tiers a key can: exact, prefix, contains.
  keyScore(q, k){
    if (k === q.key) return 500;
    if (k.startsWith(q.key)) return 400;
    const i = q.key.length >= 3 ? k.indexOf(q.key) : -1;
    return i > 0 ? 250 - Math.min(i, 49) : 0;
  },
  // How one typed word sits in one prepared name: 3 a whole word, 2 the start of a word (or of words
  // run together), 1 a small edit from a word, 0 not there. A single letter is a word or nothing: as
  // the start of any word, the "a" of "a-10" found "F16A all kinds of…" by its "all" (the review of
  // 2026-09-27). A single digit may still start one — "spitfire 9" is the Mk IXc, which reads "9c".
  word(qw, f){
    let best = 0;
    const letter = qw.length === 1 && !(qw >= "0" && qw <= "9");
    for (const s of f.seqs) {
      const w = s.w, runs = s.runs;
      for (let i = 0; i < w.length; i++) {
        if (w[i] === qw) return 3;
        if (letter) continue;
        if (best < 2 && runs[i].startsWith(qw)) best = 2;
        else if (best < 1 && (Match.near(qw, w[i]) || (i < w.length - 1 && Match.near(qw, runs[i])))) best = 1;
      }
    }
    return best;
  },
  // Letters are forgiven, digits never: "f-15" is not a typo of "f-16", and a search that offered it
  // would be worse than one that found nothing. One edit from four letters, two from eight; nothing
  // under four, where one edit reaches half the roster. The first letter has to agree, or be swapped
  // with the second — that is where people type most carefully, and it keeps the tier from filling
  // with names that merely share a length. Compared against every start of `w` near the typed
  // length as well as the whole word, so a word still being typed is forgiven too ("abrs").
  near(qw, w){
    const n = qw.length, tol = n >= 8 ? 2 : n >= 4 ? 1 : 0;
    if (!tol || !w) return false;
    if (w[0] !== qw[0] && !(w[0] === qw[1] && w[1] === qw[0])) return false;
    return Match.nearest(qw, w, tol) <= tol;
  },
  // The smallest edit distance between `a` and any start of `b` whose length is within `max` of a's —
  // one table, whose last row holds all of those at once. Optimal string alignment: a swap of two
  // neighbours is one edit. An edit that touches a digit costs max + 1. Stops as soon as a whole row
  // is past `max`, which is where nearly every comparison ends.
  _r: [new Int32Array(64), new Int32Array(64), new Int32Array(64)],     // scratch, allocated once (§3.6)
  nearest(a, b, max){
    const n = a.length, m = Math.min(b.length, n + max), big = max + 1;
    if (m < n - max) return big;
    if (Match._r[0].length <= m) Match._r = [0, 1, 2].map(() => new Int32Array(2 * m + 2));
    let [pp, p, c] = Match._r;
    const digit = k => k >= 48 && k <= 57;
    p[0] = 0;
    for (let j = 1; j <= m; j++) p[j] = Math.min(big, p[j - 1] + (digit(b.charCodeAt(j - 1)) ? big : 1));
    for (let i = 1; i <= n; i++) {
      const ai = a.charCodeAt(i - 1), dA = digit(ai);
      c[0] = Math.min(big, p[0] + (dA ? big : 1));
      let low = c[0];
      for (let j = 1; j <= m; j++) {
        const bj = b.charCodeAt(j - 1), dB = digit(bj);
        let v = ai === bj ? p[j - 1] : p[j - 1] + (dA || dB ? big : 1);        // keep or substitute
        const del = p[j] + (dA ? big : 1); if (del < v) v = del;               // drop a typed character
        const ins = c[j - 1] + (dB ? big : 1); if (ins < v) v = ins;           // a character left out
        if (i > 1 && j > 1 && ai !== bj && ai === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === bj) {
          const sw = pp[j - 2] + (dA || dB ? big : 1); if (sw < v) v = sw;     // two neighbours swapped
        }
        c[j] = v > big ? big : v;
        if (c[j] < low) low = c[j];
      }
      if (low > max) return big;
      const t = pp; pp = p; p = c; c = t;
    }
    let best = big;
    for (let j = Math.max(0, n - max); j <= m; j++) if (p[j] < best) best = p[j];
    return best;
  },
};
/*==ENDMATCH==*/
