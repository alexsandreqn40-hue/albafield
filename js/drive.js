/* Alba Field 2 · envío a Google Drive mediante un receptor de Google Apps Script del propio usuario.
   No requiere registrar aplicaciones ni tarjeta: el script corre en la cuenta Google del dueño de la carpeta. */
const Drive = (() => {
  const folderId = link => {
    const s = String(link || '').trim();
    const m = /\/folders\/([A-Za-z0-9_-]{10,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{10,})/.exec(s);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : '';
  };
  async function cfg() { return (await DB.kv('drive_cfg', {})) || {}; }
  const ready = c => !!(c && c.url && folderId(c.folder) && c.token);

  async function call(body, timeoutMs = 120000) {
    const c = await cfg();
    if (!ready(c)) throw new Error('Drive no configurado (Ajustes → Google Drive)');
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(c.url)) throw new Error('La URL del receptor debe empezar con https://script.google.com/');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    let r;
    try {
      // text/plain evita la verificación previa CORS; Apps Script responde con JSON legible
      r = await fetch(c.url, { method: 'POST', body: JSON.stringify({ ...body, token: c.token, root: folderId(c.folder) }), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctl.signal });
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'Tiempo de espera agotado (señal débil)' : 'Sin conexión con Google'); }
    finally { clearTimeout(t); }
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch (_) { throw new Error(/<html/i.test(txt) ? 'El receptor no está publicado para "Cualquier usuario" o la URL no es la de /exec' : 'Respuesta no válida del receptor'); }
    if (!j.ok) throw new Error(j.error || 'Error del receptor');
    return j;
  }
  async function ping() { return call({ action: 'ping' }, 30000); }
  /* path: ['PROY', 'CAMP', …]; blob: archivo. Reemplaza si ya existe uno con el mismo nombre. */
  async function upload(path, name, blob) {
    if (blob.size > 35 * 1048576) throw new Error(`${name}: más de 35 MB, no se puede enviar por Drive`);
    const data = (await Photo.readDataURL(blob)).split(',')[1] || '';
    return call({ action: 'upload', path, name, mime: blob.type || 'application/octet-stream', data });
  }
  /* Configuración central del equipo (hoja ALBA_FIELD_CONFIG) y consolidación por proyecto/campaña */
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
  return { cfg, ready, folderId, ping, upload, teamConfig, consolidate, setupLink, parseSetup };
})();
