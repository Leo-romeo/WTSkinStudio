/*==ENCODE==*/
// ---- The last two export-side encoders ----
// These sit together, and in their own section, because the export worker lifts them by marker
// alongside /*==DDS==*/ (ROADMAP 1.3). Everything in here must stay pure and DOM-free, which is why
// getUVMask — the thing that produces padSeams' mask — is not in this section. It reads the flip
// checkbox. It no longer rasterises through a canvas, which used to be the reason (4.23(b)).
function writeTGA(rgba, w, h){
  const out = new Uint8Array(18 + w * h * 4);
  out[2] = 2;
  out[12] = w & 255; out[13] = w >> 8; out[14] = h & 255; out[15] = h >> 8;
  out[16] = 32; out[17] = 0x28; // 8 alpha bits, top-left origin
  let p = 18;
  for (let i = 0; i < w * h; i++) { out[p++] = rgba[i*4+2]; out[p++] = rgba[i*4+1]; out[p++] = rgba[i*4]; out[p++] = rgba[i*4+3]; }
  return out;
}
function padSeams(rgba, w, h, mask, maxDist){
  const filled = mask.slice();
  let frontier = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (filled[i]) continue;
    if ((x > 0 && filled[i-1]) || (x < w-1 && filled[i+1]) || (y > 0 && filled[i-w]) || (y < h-1 && filled[i+w])) frontier.push(i);
  }
  for (let ring = 0; ring < maxDist && frontier.length; ring++) {
    const next = [], newly = [];
    for (const i of frontier) {
      if (filled[i]) continue;
      const x = i % w, y = (i / w) | 0;
      let src = -1;
      if (x > 0 && filled[i-1] === 1) src = i-1;
      else if (x < w-1 && filled[i+1] === 1) src = i+1;
      else if (y > 0 && filled[i-w] === 1) src = i-w;
      else if (y < h-1 && filled[i+w] === 1) src = i+w;
      if (src < 0) continue;
      rgba[i*4] = rgba[src*4]; rgba[i*4+1] = rgba[src*4+1]; rgba[i*4+2] = rgba[src*4+2]; rgba[i*4+3] = rgba[src*4+3];
      filled[i] = 2; newly.push(i);
      if (x > 0 && !filled[i-1]) next.push(i-1);
      if (x < w-1 && !filled[i+1]) next.push(i+1);
      if (y > 0 && !filled[i-w]) next.push(i-w);
      if (y < h-1 && !filled[i+w]) next.push(i+w);
    }
    for (const i of newly) filled[i] = 1;
    frontier = next;
  }
}
/*==ENDENCODE==*/
