$("btnGameFolder").onclick = () => openGameFolder(false);

// ---------- Remember the game folder between visits (IndexedDB stores the handle) ----------
// One connection for the page, opened on first use and reused (ROADMAP 1.25). It used to open a new
// one per call and nobody closed them: measured 2026-10-24, a page with only the boot's calls behind
// it made `deleteDatabase("wtss")` wait 29 s, and a version upgrade would wait the same way. The
// cached connection steps aside on `versionchange` (a delete or an upgrade, from any tab) and the
// next call reopens; `close` is the browser dropping it. Callers never close it. Kept on the function,
// not in a binding of its own (CLAUDE.md §2: no new globals). tools/t168.
function idb(){
  if (idb.conn) return idb.conn;
  const p = idb.conn = new Promise((res, rej) => {
    const rq = indexedDB.open("wtss", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
    rq.onsuccess = () => {
      const db = rq.result;
      const drop = () => { if (idb.conn === p) idb.conn = null; };
      db.onversionchange = () => { db.close(); drop(); };
      db.onclose = drop;
      res(db);
    };
    rq.onerror = () => { if (idb.conn === p) idb.conn = null; rej(rq.error); };
  });
  return p;
}
// A miss and a failure are different answers and used to be the same one. `idbGet` still returns
// null for both — every caller treats that as "nothing stored", which is the right recovery — but a
// failure now says so, because "the app forgot your game folder" and "there was nothing to
// remember" look identical from the outside and only one of them is a problem.
async function idbGet(k){
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const q = db.transaction("kv").objectStore("kv").get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch (e) {
    reportFailure("Could not read this browser's saved data (" + k + ")", e, "idb");
    return null;
  }
}
// `t.oncomplete = t.onerror = r` resolved on failure as well as on success, so the catch below was
// unreachable for the case it existed for: a write that was refused looked exactly like one that
// worked. Rejecting is the fix; the report is what makes it visible.
async function idbSet(k, v){
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction("kv", "readwrite");
      t.objectStore("kv").put(v, k);
      t.oncomplete = res;
      t.onerror = t.onabort = () => rej(t.error);
    });
    clearFailure("idb");
  } catch (e) {
    reportFailure("Could not save to this browser's storage (" + k + ") — it will not be remembered next time", e, "idb");
  }
}
async function idbDel(k){
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const t = db.transaction("kv", "readwrite");
      t.objectStore("kv").delete(k);
      t.oncomplete = res;
      t.onerror = t.onabort = () => rej(t.error);
    });
  } catch (e) {
    reportFailure("Could not clear this browser's saved data (" + k + ")", e, "idb");
  }
}

