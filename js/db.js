/* Alba Field 2 · almacenamiento local (IndexedDB). Los datos nunca salen del teléfono salvo que el usuario los envíe.
   Modelo: jornadas → stations → photos / audios. Archivos binarios en "blobs" (misma clave que la foto o el audio). */
const DB = (() => {
  const NAME = 'geofield', VER = 2;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['records', 'blobs', 'jornadas', 'stations', 'photos', 'audios'])
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('layers')) d.createObjectStore('layers', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error('Cierre otras pestañas de Alba Field y vuelva a abrir'));
    });
    return dbp;
  }
  function req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function tx(stores, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(stores, mode);
      let out;
      Promise.resolve(fn(t)).then(v => { out = v; }, e => { try { t.abort(); } catch (_) {} rej(e); });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
    });
  }
  return {
    open,
    async get(store, key) { return tx([store], 'readonly', t => req(t.objectStore(store).get(key))); },
    async all(store) { return tx([store], 'readonly', t => req(t.objectStore(store).getAll())); },
    async put(store, val) { return tx([store], 'readwrite', t => req(t.objectStore(store).put(val))); },
    async del(store, key) { return tx([store], 'readwrite', t => req(t.objectStore(store).delete(key))); },
    /* Metadatos + archivo en UNA transacción: o se guarda todo o nada. */
    async saveWithBlob(store, rec, blobs) {
      return tx([store, 'blobs'], 'readwrite', t => {
        t.objectStore('blobs').put({ id: rec.id, ...blobs });
        t.objectStore(store).put(rec);
      });
    },
    async putMany(store, list) { return tx([store], 'readwrite', t => { for (const v of list) t.objectStore(store).put(v); }); },
    async kv(k, fallback = null) { const v = await this.get('kv', k); return v ? v.v : fallback; },
    async setKv(k, v) { return this.put('kv', { k, v }); },
  };
})();
