/* Alba Field · motor de envío de fotos y audios a Drive.
   Se usa desde la página y desde el service worker (envío en segundo plano cuando vuelve la señal).
   Reglas:
   - Un archivo que falla NO detiene a los demás: queda en espera con reintento progresivo (1, 2, 4… hasta 30 min).
   - Solo se detiene todo si la clave/carpeta/URL están mal (no tiene sentido seguir) o si fallan 3 seguidos por señal.
   - Cada archivo se marca como enviado apenas llega: si se corta la señal, se retoma donde quedó. */
const Sync = (() => {
  const ts = v => (v ? Date.parse(v) || 0 : 0);
  const needs = x => x.send !== false && !x.voided && (!x.uploaded_at || ts(x.edited_at) > ts(x.uploaded_at));
  const safeName = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'X';
  const jorPath = j => [j.project, j.campaign, safeName(j.component).toUpperCase(), j.specialist, j.date];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const nameOf = (store, x) => store === 'photos' ? x.photo_name + '.jpg' : x.file_name;

  async function pending() {
    const [p, a] = await Promise.all([DB.all('photos'), DB.all('audios')]);
    return [...p.filter(needs).map(x => ['photos', x]), ...a.filter(needs).map(x => ['audios', x])];
  }
  /* Un solo envío a la vez entre la página y el segundo plano */
  async function run(opts = {}) {
    if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
      return navigator.locks.request('albafield-sync', { ifAvailable: true }, lock => lock ? runLocked(opts) : { busy: true });
    }
    return runLocked(opts);
  }
  async function runLocked({ manual = false, onStep = () => {}, log = () => {} } = {}) {
    const c = await Drive.cfg();
    if (!Drive.ready(c)) return { skipped: 'config', ok: 0, failed: 0, touched: [] };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { skipped: 'offline', ok: 0, failed: 0, touched: [] };
    let ver;
    try { ver = await Drive.version(manual); }
    catch (e) { log(`✗ ${e.message}`); return { aborted: e.message, kind: e.kind, ok: 0, failed: 0, touched: [] }; }
    const jor = new Map((await DB.all('jornadas')).map(j => [j.id, j]));
    const now = Date.now();
    const items = (await pending())
      .filter(([, x]) => manual || !x.next_try_at || ts(x.next_try_at) <= now)
      .sort((a, b) => (a[1].fail_count || 0) - (b[1].fail_count || 0) || (a[1].time_utc || '').localeCompare(b[1].time_utc || ''));
    let ok = 0, failed = 0, consec = 0, aborted = null, kind = null;
    const touched = new Set();
    for (const [i, [store, x]] of items.entries()) {
      const j = jor.get(x.jornada_id); if (!j) continue;
      const name = nameOf(store, x);
      onStep(i + 1, items.length, name);
      let done = false, err = null, res = null;
      const started = new Date().toISOString();       // instantánea: si se edita durante el envío, queda pendiente
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const b = await DB.get('blobs', x.id);
          const blob = b && (store === 'photos' ? b.stamped : b.audio);
          if (!blob) throw Object.assign(new Error('Archivo no encontrado en el teléfono'), { kind: 'server' });
          const sub = store === 'photos' ? 'FOTOS' : 'AUDIOS';
          res = await Drive.upload([...jorPath(j), sub], name, blob, { ver, onPart: (k, n) => onStep(i + 1, items.length, `${name} · parte ${k}/${n}`) });
          if (store === 'photos' && c.orig && b.original) await Drive.upload([...jorPath(j), 'FOTOS', 'ORIGINALES'], x.photo_name + '_original.jpg', b.original, { ver });
          done = true;
        } catch (e) {
          err = e;
          if (e.kind !== 'net' || attempt === 2) break;
          onStep(i + 1, items.length, `${name} · reintentando…`);
          await sleep(attempt ? 10000 : 3000);
        }
      }
      const fresh = (await DB.get(store, x.id)) || x;          // se relee: no pisar cambios hechos mientras tanto
      if (done) {
        Object.assign(fresh, { uploaded_at: started, drive_id: res && res.id, sync_error: null, fail_count: 0, next_try_at: null });
        await DB.put(store, fresh);
        ok++; consec = 0; touched.add(j.id);
        continue;
      }
      failed++;
      const n = (fresh.fail_count || 0) + 1;
      Object.assign(fresh, { sync_error: err.message, fail_count: n, last_try_at: new Date().toISOString(), next_try_at: new Date(Date.now() + Math.min(30, 2 ** (n - 1)) * 60000).toISOString() });
      await DB.put(store, fresh);
      log(`✗ ${name}: ${err.message}`);
      if (err.kind === 'auth') { aborted = err.message; kind = 'auth'; break; }
      if (err.kind === 'net' && ++consec >= 3) { aborted = 'La señal no alcanza por ahora: se continuará cuando mejore'; kind = 'net'; break; }
      if (err.kind !== 'net') consec = 0;
    }
    const left = (await pending()).length;
    return { ok, failed, aborted, kind, touched: [...touched], ver, left };
  }
  return { run, pending, needs, jorPath, safeName };
})();
