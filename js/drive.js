/* Alba Field · envío a Google Drive mediante un receptor de Google Apps Script del propio usuario.
   No requiere registrar aplicaciones ni tarjeta: el script corre en la cuenta Google del dueño de la carpeta.
   Este archivo funciona tanto en la página como en el service worker (envío en segundo plano). */
const Drive = (() => {
  const CHUNK = 1.2 * 1048576;          // partes de ~1,2 MB: viajan bien con señal débil
  const folderId = link => {
    const s = String(link || '').trim();
    const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
  };
  async function cfg() { return (await DB.kv('drive_cfg', {})) || {}; }
  const ready = c => !!(c && c.url && folderId(c.folder) && c.token);

  /* Errores clasificados: kind = net (señal), auth (clave/carpeta/URL: no tiene sentido reintentar), server */
  const fail = (msg, kind) => Object.assign(new Error(msg), { kind });
  async function call(body, timeoutMs = 90000) {
    const c = await cfg();
    if (!ready(c)) throw fail('Drive no configurado (Ajustes → Google Drive)', 'auth');
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(c.url)) throw fail('La URL del receptor debe empezar con https://script.google.com/', 'auth');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    let r;
    try {
      // text/plain evita la verificación previa CORS; Apps Script responde con JSON legible
      r = await fetch(c.url, { method: 'POST', body: JSON.stringify({ ...body, token: c.token, root: folderId(c.folder) }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
    } catch (e) { throw fail(e.name === 'AbortError' ? 'Tiempo de espera agotado (señal débil)' : 'Sin conexión con Google', 'net'); }
    finally { clearTimeout(t); }
    if (r.status >= 500 || r.status === 429) throw fail(`Google respondió ${r.status} (ocupado); se reintentará`, 'net');
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch (_) {
      if (/<html/i.test(txt) && /(script|ejecu|execut|limit|cuota|quota|timeout|tiempo)/i.test(txt) && !/(acceso|access|permission|permiso|sign ?in|iniciar sesi)/i.test(txt)) throw fail('El receptor tardó demasiado o está ocupado; se reintentará', 'net');
      throw fail(/<html/i.test(txt) ? 'El receptor no está publicado para "Cualquier usuario" o la URL no es la de /exec' : 'Respuesta no válida del receptor', /<html/i.test(txt) ? 'auth' : 'net');
    }
    if (!j.ok) {
      const kind = /Clave|No item|not found|getFolderById|permis|access|acceso/i.test(j.error || '') ? 'auth' : /Lock|ocupad|timed out|Service invoked too many|Exceeded maximum execution|Límite/i.test(j.error || '') ? 'net' : 'server';
      throw fail(j.error || 'Error del receptor', kind);
    }
    return j;
  }
  /* Versión del receptor: 2 (solo archivos), 3 (+configuración y consolidado), 4 (+envío por partes). Se guarda 1 h. */
  async function ping() { const r = await call({ action: 'ping' }, 30000); await DB.setKv('drive_ver', { v: r.version || 2, at: new Date().toISOString(), root: r.root }); return r; }
  async function version(force) {
    const v = await DB.kv('drive_ver');
    if (!force && v && Date.now() - Date.parse(v.at) < 3600 * 1000) return v.v;
    return (await ping()).version || 2;
  }

  /* base64 sin FileReader (sirve también en el service worker) */
  function b64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const uploadIdOf = (path, name, size) => (path.join('_') + '_' + name + '_' + size).replace(/[^A-Za-z0-9_.-]/g, '_').slice(-110);

  /* path: ['PROY', 'CAMP', …]; reemplaza si ya existe uno con el mismo nombre.
     Con receptor v4 y archivos grandes envía por partes y retoma las que ya llegaron. */
  async function upload(path, name, blob, { ver = 2, onPart } = {}) {
    if (blob.size > 45 * 1048576) throw fail(`${name}: más de 45 MB, no se puede enviar por Drive`, 'server');
    const mime = blob.type || 'application/octet-stream';
    if (ver >= 4 && blob.size > CHUNK * 1.25) {
      const total = Math.ceil(blob.size / CHUNK), uploadId = uploadIdOf(path, name, blob.size);
      let have = [];
      try { have = (await call({ action: 'chunkStatus', uploadId }, 30000)).have || []; } catch (e) { if (e.kind === 'auth') throw e; }
      let last;
      for (let i = 0; i < total; i++) {
        if (have.includes(i)) continue;
        const part = blob.slice(i * CHUNK, Math.min(blob.size, (i + 1) * CHUNK));
        last = await call({ action: 'chunk', uploadId, index: i, total, path, name, mime, data: b64(await part.arrayBuffer()) }, 90000);
        onPart && onPart(i + 1, total);
        if (last.done) return last;
      }
      // todas estaban en el servidor pero no se armó (corte justo al final): se reenvía la última
      const i = total - 1, part = blob.slice(i * CHUNK);
      const r = await call({ action: 'chunk', uploadId, index: i, total, path, name, mime, data: b64(await part.arrayBuffer()) }, 120000);
      if (!r.done) throw fail('Faltan partes en el servidor; se reintentará', 'net');
      return r;
    }
    // envío directo: tiempo de espera según tamaño (mín. 60 s, ~20 KB/s)
    const t = Math.min(600000, 60000 + blob.size / 20);
    return call({ action: 'upload', path, name, mime, data: b64(await blob.arrayBuffer()) }, t);
  }

  /* Configuración central del equipo (hoja ALBA_FIELD_CONFIG) y consolidación por proyecto/campaña (receptor ≥ 3) */
  async function teamConfig() { return call({ action: 'config' }, 60000); }
  async function consolidate(project, campaign, tables) { return call({ action: 'consolidate', project, campaign, tables }, 120000); }
  /* Enlace de instalación del equipo: lleva URL del receptor, carpeta y clave */
  const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function setupLink(c, base) { return `${base}#cfg=${b64u(JSON.stringify({ u: c.url, f: c.folder, k: c.token }))}`; }
  function parseSetup(hash) {
    const m = /[#&]cfg=([A-Za-z0-9_-]+)/.exec(hash || ''); if (!m) return null;
    try { const o = JSON.parse(unb64u(m[1])); return o.u && o.f && o.k ? { url: o.u, folder: o.f, token: o.k } : null; } catch (_) { return null; }
  }
  return { cfg, ready, folderId, call, ping, version, upload, teamConfig, consolidate, setupLink, parseSetup, CHUNK };
})();
