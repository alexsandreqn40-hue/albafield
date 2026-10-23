/* Alba Field · almacenamiento local (IndexedDB). Los datos nunca salen del teléfono salvo que el usuario los entregue. */
const DB = (() => {
  const NAME = 'geofield', VER = 1;
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('records')) d.createObjectStore('records', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
        if (!d.objectStoreNames.contains('layers')) d.createObjectStore('layers', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
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
    /* Registro + fotos en UNA transacción: o se guarda todo o nada. */
    async saveRecord(rec, blobs) {
      return tx(['records', 'blobs'], 'readwrite', t => {
        t.objectStore('blobs').put({ id: rec.id, ...blobs });
        t.objectStore('records').put(rec);
      });
    },
    async kv(k, fallback = null) { const v = await this.get('kv', k); return v ? v.v : fallback; },
    async setKv(k, v) { return this.put('kv', { k, v }); },
  };
})();
