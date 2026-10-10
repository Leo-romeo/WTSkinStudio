$("btnGameFolder").onclick = () => openGameFolder(false);

// ---------- Remember the game folder between visits (IndexedDB stores the handle) ----------
function idb(){
  return new Promise((res, rej) => {
    const rq = indexedDB.open("wtss", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("kv");
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
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

