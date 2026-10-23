/* Alba Field · subida directa a OneDrive / SharePoint con Microsoft Graph (OAuth 2.0 + PKCE, sin servidor).
   Requiere una app registrada en Microsoft Entra, plataforma "Aplicación de página única (SPA)",
   con URI de redirección = dirección exacta donde está publicada Alba Field. */
const OneDrive = (() => {
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SCOPES = 'offline_access User.Read Files.ReadWrite.All';
  let access = null, accessExp = 0;

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const redirectUri = () => location.origin + location.pathname;
  async function cfg() { return (await DB.kv('od_cfg', {})) || {}; }

  async function login() {
    const c = await cfg();
    if (!c.clientId) throw new Error('Falta el ID de aplicación en Ajustes → OneDrive');
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem('gf_pkce', JSON.stringify({ verifier, state }));
    const u = new URL(`https://login.microsoftonline.com/${c.tenant || 'common'}/oauth2/v2.0/authorize`);
    Object.entries({ client_id: c.clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query', scope: SCOPES, code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    location.assign(u.toString());
  }

  async function token(body) {
    const c = await cfg();
    const r = await fetch(`https://login.microsoftonline.com/${c.tenant || 'common'}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.clientId, scope: SCOPES, ...body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description ? j.error_description.split('\r\n')[0] : 'Error de autenticación ' + r.status);
    access = j.access_token; accessExp = Date.now() + (j.expires_in - 120) * 1000;
    if (j.refresh_token) await DB.setKv('od_rt', j.refresh_token);
    return access;
  }

  /* Al volver del inicio de sesión: ?code=… en la URL */
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return false;
    const saved = JSON.parse(sessionStorage.getItem('gf_pkce') || '{}');
    history.replaceState(null, '', redirectUri());
    sessionStorage.removeItem('gf_pkce');
    if (q.has('error')) throw new Error(q.get('error_description') || q.get('error'));
    if (!saved.state || saved.state !== q.get('state')) throw new Error('Respuesta de inicio de sesión no válida (state)');
    await token({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier });
    const me = await api('GET', '/me');
    await DB.setKv('od_user', me.userPrincipalName || me.mail || me.displayName);
    return true;
  }

  async function getAccess() {
    if (access && Date.now() < accessExp) return access;
    const rt = await DB.kv('od_rt');
    if (!rt) throw new Error('Inicie sesión en Microsoft');
    try { return await token({ grant_type: 'refresh_token', refresh_token: rt }); }
    catch (e) { await DB.setKv('od_rt', null); throw new Error('La sesión de Microsoft venció. Inicie sesión de nuevo.'); }
  }
  async function signedIn() { return !!(await DB.kv('od_rt')); }
  async function logout() { access = null; await DB.setKv('od_rt', null); await DB.setKv('od_user', null); await DB.setKv('od_target', null); }

  async function api(method, path, body, headers = {}) {
    const t = await getAccess();
    const r = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      method, headers: { Authorization: 'Bearer ' + t, ...(body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body == null ? undefined : (body instanceof Blob ? body : JSON.stringify(body)),
    });
    if (r.status === 204) return null;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Graph ${r.status}: ${(j.error && j.error.message) || r.statusText}`);
    return j;
  }

  /* Carpeta destino: enlace compartido de OneDrive/SharePoint, o ruta dentro de "Mis archivos". */
  async function target() {
    const c = await cfg();
    const t = (c.target || '').trim();
    const cached = await DB.kv('od_target');
    if (cached && cached.src === t) return cached;
    let res;
    if (/^https?:\/\//i.test(t)) {
      const enc = 'u!' + btoa(unescape(encodeURIComponent(t))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
      const it = await api('GET', `/shares/${enc}/driveItem`);
      if (!it.folder) throw new Error('El enlace no es de una carpeta');
      res = { src: t, base: `/drives/${it.parentReference.driveId}/items/${it.id}`, label: it.name };
    } else {
      const path = t.replace(/^\/+|\/+$/g, '') || 'AlbaField';
      res = { src: t, base: `/me/drive/root:/${path.split('/').map(encodeURIComponent).join('/')}:`, label: 'Mi OneDrive/' + path, byPath: true };
    }
    await DB.setKv('od_target', res);
    return res;
  }
  const itemPath = (tg, rel) => {
    const r = rel.split('/').map(encodeURIComponent).join('/');
    return tg.byPath ? `${tg.base.slice(0, -1)}/${r}:` : `${tg.base}:/${r}:`;
  };

  /* Sube un archivo (≤4 MB directo; mayor por sesión de carga en bloques de 3,2 MB). Reemplaza si existe. */
  async function upload(rel, blob) {
    const tg = await target();
    if (blob.size <= 4 * 1024 * 1024) return api('PUT', itemPath(tg, rel) + '/content?@microsoft.graph.conflictBehavior=replace', blob, { 'Content-Type': blob.type || 'application/octet-stream' });
    const s = await api('POST', itemPath(tg, rel) + '/createUploadSession', { item: { '@microsoft.graph.conflictBehavior': 'replace' } });
    const CH = 320 * 1024 * 10;
    let last;
    for (let off = 0; off < blob.size; off += CH) {
      const end = Math.min(off + CH, blob.size);
      const r = await fetch(s.uploadUrl, { method: 'PUT', headers: { 'Content-Range': `bytes ${off}-${end - 1}/${blob.size}` }, body: blob.slice(off, end) });
      if (!r.ok && r.status !== 202) { const j = await r.json().catch(() => ({})); throw new Error(`Carga ${r.status}: ${(j.error && j.error.message) || ''}`); }
      last = r;
    }
    return last && last.json().catch(() => null);
  }

  return { login, handleRedirect, signedIn, logout, upload, target, redirectUri, cfg };
})();
