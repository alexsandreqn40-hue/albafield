/* Alba Field · aplicación de campo offline (PWA). */
const APP_VERSION = '1.0.2';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CODE_RE = /^[A-Za-z0-9_\-]{1,32}$/;
const DEFAULT_CATS = {
  components: ['Flora', 'Fauna terrestre', 'Hidrobiología', 'Calidad de agua', 'Calidad de aire', 'Ruido', 'Suelo', 'Social', 'Arqueología', 'Infraestructura'],
  categories: ['Monitoreo', 'Avistamiento', 'Hallazgo', 'Evidencia de cumplimiento', 'Incidente', 'Referencia'],
};

const S = {
  set: { specialist: '', person: '', specialty: '', north: true, maxAcc: 30, jpegQ: 0.9 },
  form: {}, recs: [], fix: null, heading: null, headingAt: 0, layers: [], cats: DEFAULT_CATS,
  stream: null, busy: false, map: null, mapLayers: {}, syncing: false,
};

/* ---------------- utilidades de interfaz ---------------- */
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function busy(on, text = 'Procesando…') { $('#busy').hidden = !on; $('#busyText').textContent = text; }
function ask(html, buttons = [['Aceptar', true]]) {
  return new Promise(res => {
    const d = $('#dlg'); $('#dlgBody').innerHTML = html;
    const m = $('#dlgBtns'); m.innerHTML = '';
    let chosen;
    buttons.forEach(([label, val, cls]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = cls || (val === true ? 'primary' : 'ghost'); b.onclick = () => { chosen = val; d.close(); }; m.appendChild(b); });
    // se resuelve en el evento close: así un diálogo siguiente no recibe el cierre del anterior
    d.addEventListener('close', () => res(chosen), { once: true });
    d.showModal();
  });
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
function localIso(d) { const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-', a = Math.abs(o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`; }
const safeName = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'X';
const fmtMB = b => (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + ' MB';
const ts = v => (v ? Date.parse(v) || 0 : 0);
const statusOf = r => { const up = ts(r.uploaded_at), dl = ts(r.delivered_at), sent = Math.max(up, dl); if (!sent || ts(r.edited_at) > sent) return 'local'; return up >= dl ? 'subido' : 'entregado'; };
const needsUpload = r => !r.uploaded_at || ts(r.edited_at) > ts(r.uploaded_at);
const isPending = r => statusOf(r) === 'local';
const campKey = r => `${r.project}/${r.campaign}`;

async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text: title }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; console.warn(e); }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'downloaded';
}

/* ---------------- arranque ---------------- */
async function init() {
  $('#verLine').textContent = `Alba Field ${APP_VERSION} · datos guardados solo en este dispositivo hasta que usted los entregue.`;
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
    // versión nueva instalada: recargar una vez (si no se está usando la cámara)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || init._reloaded) return; init._reloaded = true;
      if (!S.stream && !S.busy) location.reload(); else toast('Nueva versión lista: cierre y abra la app');
    });
  }
  await DB.open();
  S.set = { ...S.set, ...(await DB.kv('settings', {})) };
  S.form = (await DB.kv('form', {})) || {};
  try { if (await OneDrive.handleRedirect()) toast('Sesión de Microsoft iniciada ✓'); } catch (e) { toast('Microsoft: ' + e.message, 6000); }
  bindTabs(); bindCapture(); bindRecords(); bindMap(); bindSend(); bindSettings();
  fillForms();
  await reload();
  netBadge(); addEventListener('online', () => { netBadge(); autoSync(); }); addEventListener('offline', netBadge);
  startGps(); startCompass();
  if (!S.set.specialist) { showView('ajustes'); toast('Primero escriba su código de especialista (ej. ESP01)', 5000); }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); });
  setInterval(autoSync, 180000); setTimeout(autoSync, 4000);
}

async function reload() {
  S.recs = (await DB.all('records')).sort((a, b) => b.time_utc.localeCompare(a.time_utc));
  const p = S.form.project || '';
  S.layers = p ? (await DB.all('layers')).filter(l => l.project === p) : [];
  S.cats = (p && await DB.kv('cat:' + p)) || DEFAULT_CATS;
  const pend = S.recs.filter(r => !r.voided && isPending(r)).length;
  $('#pendBadge').hidden = !pend; $('#pendBadge').textContent = `${pend} por entregar`;
  $('#ctxLine').textContent = `${S.set.specialist || 'sin código'} · ${p || '—'}/${S.form.campaign || '—'}`;
  $('#projName').textContent = p || '— ninguno';
  if (document.activeElement !== $('#setProject')) $('#setProject').value = p;
  if (document.activeElement !== $('#setCampaign')) $('#setCampaign').value = S.form.campaign || '';
  fillDatalists(); renderRecords(); renderSendInfo(); renderOdState(); renderSettingsProject();
  if (S.map) renderMapData();
}
function netBadge() { const b = $('#netBadge'); b.textContent = navigator.onLine ? 'Con señal' : 'Sin señal'; b.className = 'badge ' + (navigator.onLine ? 'on' : 'off'); }

/* ---------------- pestañas ---------------- */
function showView(v) {
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'mapa') setTimeout(initMap, 30);
  if (v === 'enviar') renderSendInfo();
  if (v === 'ajustes') renderStorage();
}
function bindTabs() { $$('.tabs button').forEach(b => b.onclick = () => showView(b.dataset.v)); }

/* ---------------- formulario de captura ---------------- */
function fillForms() {
  const f = $('#formCaptura');
  for (const el of f.elements) if (el.name && S.form[el.name] != null) el.value = S.form[el.name];
  const s = $('#formSet');
  for (const el of s.elements) if (el.name) { if (el.type === 'checkbox') el.checked = !!S.set[el.name]; else if (S.set[el.name] != null) el.value = S.set[el.name]; }
}
function readForm() { const o = {}; for (const el of $('#formCaptura').elements) if (el.name) o[el.name] = el.value.trim(); return o; }
function fillDatalists() {
  const p = S.form.project;
  const st = new Set(S.recs.filter(r => r.project === p).map(r => r.station));
  S.layers.forEach(l => l.features.forEach(f => f.type === 'Point' && st.add(f.name)));
  const opt = arr => [...new Set(arr)].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map(v => `<option value="${esc(v)}">`).join('');
  $('#dlStation').innerHTML = opt([...st]);
  $('#dlComponent').innerHTML = opt([...S.cats.components, ...S.recs.filter(r => r.project === p).map(r => r.component)]);
  $('#dlCategory').innerHTML = opt([...S.cats.categories, ...S.recs.filter(r => r.project === p).map(r => r.category)]);
}
function bindCapture() {
  const f = $('#formCaptura');
  f.addEventListener('input', async e => {
    const prevP = S.form.project;
    S.form = readForm(); await DB.setKv('form', S.form);
    if (e.target.name === 'project' && prevP !== S.form.project) { clearTimeout(bindCapture._t); bindCapture._t = setTimeout(reload, 500); }
    else $('#ctxLine').textContent = `${S.set.specialist || 'sin código'} · ${S.form.project || '—'}/${S.form.campaign || '—'}`;
  });
  $('#btnCam').onclick = openCamera;
  $('#btnSysCam').onclick = () => { if (validForm()) { reqCompassPermission(); $('#sysCam').click(); } };
  $('#sysCam').onchange = async e => { const file = e.target.files[0]; e.target.value = ''; if (file) await captureFromFile(file); };
  $('#nearChip').onclick = () => { const n = $('#nearChip').dataset.name; if (n) { f.elements.station.value = n; f.dispatchEvent(new Event('input')); $('#nearChip').hidden = true; } };
  $('#camClose').onclick = closeCamera;
  $('#camShoot').onclick = shootInApp;
}
function validForm() {
  if (!S.set.specialist) { showView('ajustes'); toast('Configure su código de especialista'); return false; }
  const f = $('#formCaptura');
  if (!f.reportValidity()) return false;
  const v = readForm();
  if (!CODE_RE.test(v.project) || !CODE_RE.test(v.campaign)) { toast('Proyecto y campaña: solo letras, números, guion y guion bajo'); return false; }
  return true;
}

/* ---------------- GPS y brújula ---------------- */
let fixWaiters = [];
function startGps() {
  if (!('geolocation' in navigator)) { gpsUi(null, 'Este navegador no tiene GPS'); return; }
  navigator.geolocation.watchPosition(p => {
    S.fix = { lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy, ts: p.timestamp, got: Date.now() };
    gpsUi(S.fix); fixWaiters.splice(0).forEach(w => w(S.fix)); nearSuggest();
  }, e => gpsUi(null, e.code === 1 ? 'Permiso de ubicación denegado' : 'Buscando GPS…'), { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}
function gpsUi(fx, msg) {
  const b = $('#gpsBar');
  if (!fx) { b.className = 'gpsbar'; $('#gpsText').textContent = msg || 'GPS en espera'; return; }
  b.className = 'gpsbar ' + (fx.acc <= 10 ? 'good' : fx.acc <= S.set.maxAcc ? 'fair' : 'poor');
  const u = Geo.toUTM(fx.lat, fx.lon);
  $('#gpsText').textContent = `±${Math.round(fx.acc)} m · ${fx.lat.toFixed(5)}, ${fx.lon.toFixed(5)} · UTM ${u.zone} ${Math.round(u.e)} E ${Math.round(u.n)} N`;
  if (!$('#camera').hidden) camHud();
}
function freshFix(maxAgeMs = 15000, waitMs = 25000) {
  if (S.fix && Date.now() - S.fix.got <= maxAgeMs) return Promise.resolve(S.fix);
  return new Promise((res, rej) => {
    const t = setTimeout(() => { fixWaiters = fixWaiters.filter(w => w !== ok); S.fix ? res(S.fix) : rej(new Error('Sin posición GPS. Salga a cielo abierto y espere.')); }, waitMs);
    const ok = fx => { clearTimeout(t); res(fx); };
    fixWaiters.push(ok);
  });
}
function nearSuggest() {
  const chip = $('#nearChip'); if (!S.fix) return;
  const n = Geo.nearestPoint(S.layers.flatMap(l => l.visible === false ? [] : l.features), S.fix.lat, S.fix.lon);
  const cur = $('#formCaptura').elements.station.value.trim();
  if (n && n.d <= 60 && n.name !== cur) { chip.hidden = false; chip.dataset.name = n.name; chip.textContent = `📍 Punto cercano: ${n.name} (${Math.round(n.d)} m) · tocar para usar`; }
  else chip.hidden = true;
}
function startCompass() {
  const h = e => {
    let v = null;
    if (typeof e.webkitCompassHeading === 'number') v = e.webkitCompassHeading;
    else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) v = Geo.cameraHeading(e.alpha, e.beta, e.gamma);
    if (v != null && isFinite(v)) { S.heading = (v + 360) % 360; S.headingAt = Date.now(); if (!$('#camera').hidden) camHud(); }
  };
  if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', h);
  else addEventListener('deviceorientation', h);
}
function reqCompassPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    DeviceOrientationEvent.requestPermission().catch(() => {});
}
const headingNow = () => (S.set.north && S.heading != null && Date.now() - S.headingAt < 3000) ? S.heading : null;

/* ---------------- cámara integrada ---------------- */
async function openCamera() {
  if (!validForm()) return;
  reqCompassPermission();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('#sysCam').click(); return; }
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
  } catch (e) {
    toast('No se pudo abrir la cámara integrada; se usa la del teléfono'); $('#sysCam').click(); return;
  }
  const v = $('#video'); v.srcObject = S.stream; await v.play().catch(() => {});
  $('#camera').hidden = false; camHud();
}
function closeCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  S.stream = null; $('#video').srcObject = null; $('#camera').hidden = true; reload();
}
function camHud() {
  const fx = S.fix;
  $('#camInfo').textContent = `${S.form.station || '—'} · ${fx ? '±' + Math.round(fx.acc) + ' m' : 'sin GPS'}${fx && Date.now() - fx.got > 15000 ? ' (antiguo)' : ''}`;
  const h = headingNow(); $('#camHeading').textContent = h == null ? 'Rumbo —' : `Rumbo ${Math.round(h)}° mag.`;
}
async function grabFrame() {
  const track = S.stream.getVideoTracks()[0];
  if ('ImageCapture' in window) {
    try { const b = await new ImageCapture(track).takePhoto(); if (b && b.size) return b; } catch (e) { console.warn('takePhoto', e); }
  }
  const v = $('#video'), c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se capturó imagen')), 'image/jpeg', 0.95));
}
async function shootInApp() {
  if (S.busy || !S.stream) return;
  S.busy = true; const btn = $('#camShoot'); btn.disabled = true;
  try {
    const shotAt = new Date(), heading = headingNow();
    const blob = await grabFrame();
    navigator.vibrate && navigator.vibrate(40);
    const fx = await freshFix(15000, 20000);
    const ok = await acceptAccuracy(fx); if (!ok) return;
    const rec = await saveCapture(blob, { shotAt, fx, heading, mode: 'app' });
    toast(`Guardada ✓ ${rec.code} · ${rec.station}`);
  } catch (e) { toast('Error: ' + e.message, 6000); }
  finally { S.busy = false; btn.disabled = false; camHud(); }
}
async function captureFromFile(file) {
  busy(true, 'Obteniendo GPS y guardando…');
  try {
    const shotAt = new Date();
    const fx = await freshFix(15000, 25000);
    busy(false); const ok = await acceptAccuracy(fx); if (!ok) return; busy(true, 'Guardando…');
    const qa = [];
    const ex = await Photo.exifDate(file);
    if (ex && Math.abs(ex - shotAt) > 5 * 60000) qa.push('Fecha EXIF de la foto difiere >5 min de la captura');
    if (file.lastModified && shotAt - file.lastModified > 10 * 60000) qa.push('Archivo podría no ser recién tomado');
    const rec = await saveCapture(file, { shotAt, fx, heading: null, mode: 'sistema', qa });
    toast(`Guardada ✓ ${rec.code} · ${rec.station}`);
  } catch (e) { toast('Error: ' + e.message, 6000); }
  finally { busy(false); reload(); }
}
async function acceptAccuracy(fx) {
  if (fx.acc <= S.set.maxAcc) return true;
  return ask(`<h3>Precisión GPS baja</h3><p>Precisión estimada ±${Math.round(fx.acc)} m (umbral ${S.set.maxAcc} m). Quedará marcado en QA/QC.</p>`, [['Cancelar', false], ['Guardar igual', true]]);
}
async function nextCode(spec) {
  const k = 'seq:' + spec; const n = ((await DB.kv(k, 0)) || 0) + 1; await DB.setKv(k, n);
  return `${spec}-${String(n).padStart(4, '0')}`;
}
async function saveCapture(original, { shotAt, fx, heading, mode, qa = [] }) {
  const f = readForm(); S.form = f; await DB.setKv('form', f);
  const id = crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
  const code = await nextCode(S.set.specialist);
  const u = Geo.toUTM(fx.lat, fx.lon);
  const near = Geo.nearestPoint(S.layers.flatMap(l => l.features), fx.lat, fx.lon);
  const local = localIso(shotAt);
  const rec = {
    id, code, project: f.project, campaign: f.campaign, template_version: f.template_version || 'v1',
    specialist: S.set.specialist, person: S.set.person, specialty: S.set.specialty,
    station: f.station, component: f.component, category: f.category, importance: f.importance, place: f.place, notes: f.notes, action: f.action,
    time_local: local, time_utc: shotAt.toISOString(), utc_offset_minutes: -shotAt.getTimezoneOffset(),
    lat: fx.lat, lon: fx.lon, alt: fx.alt, accuracy: fx.acc, gps_time_utc: new Date(fx.ts).toISOString(), gps_age_s: Math.round((shotAt - fx.ts) / 1000),
    utm_zone: u.zone, utm_e: u.e, utm_n: u.n, heading, heading_reference: heading == null ? null : 'magnetico_aprox_camara',
    nearest_feature: near ? near.name : null, nearest_dist_m: near ? Math.round(near.d * 10) / 10 : null,
    camera_mode: mode, app_version: APP_VERSION, created_at: new Date().toISOString(),
  };
  rec.photo_name = photoName(rec);
  rec.qa = [...qa, ...qaFlags(rec)];
  rec.sha256_original = await Photo.sha256(original);
  const logo = await DB.kv('logo:' + f.project);
  const st = await Photo.stamp(original, rec, { logo, north: S.set.north, quality: +S.set.jpegQ || 0.9 });
  rec.width = st.width; rec.height = st.height;
  const thumb = await Photo.thumb(st.blob, 1024, 0.78);
  const origBlob = original instanceof Blob ? new Blob([await original.arrayBuffer()], { type: original.type || 'image/jpeg' }) : original;
  await DB.saveRecord(rec, { original: origBlob, stamped: st.blob, thumb });
  S.recs.unshift(rec);
  return rec;
}
function photoName(r) { return `${r.code}_${safeName(r.station)}_${r.time_local.slice(0, 10).replace(/-/g, '')}-${r.time_local.slice(11, 19).replace(/:/g, '')}`; }
function qaFlags(r) {
  const q = [];
  if (r.accuracy > S.set.maxAcc) q.push(`Precisión GPS ±${Math.round(r.accuracy)} m > ${S.set.maxAcc} m`);
  if (r.gps_age_s > 60) q.push(`Posición GPS de hace ${r.gps_age_s} s`);
  if (!r.component) q.push('Sin componente');
  const same = S.layers.flatMap(l => l.features).find(x => x.type === 'Point' && x.name === r.station);
  if (same) { const d = Geo.dist(r.lat, r.lon, same.coords[0][0], same.coords[0][1]); if (d > 50) q.push(`A ${Math.round(d)} m del punto KML "${r.station}"`); }
  return q;
}

/* ---------------- registros ---------------- */
function bindRecords() { $('#fCamp').onchange = renderRecords; $('#fText').oninput = renderRecords; }
const thumbUrls = new Map();
async function thumbUrl(id) {
  if (thumbUrls.has(id)) return thumbUrls.get(id);
  const b = await DB.get('blobs', id); const u = b && b.thumb ? URL.createObjectURL(b.thumb) : ''; thumbUrls.set(id, u); return u;
}
function renderRecords() {
  const sel = $('#fCamp'), cur = sel.value || (S.form.project ? `${S.form.project}/${S.form.campaign}` : '');
  const camps = [...new Set(S.recs.map(campKey))].sort();
  if (cur && cur !== '*' && !camps.includes(cur)) camps.unshift(cur);
  sel.innerHTML = `<option value="*">Todas las campañas</option>` + camps.map(c => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  const q = $('#fText').value.trim().toLowerCase();
  const rs = S.recs.filter(r => (sel.value === '*' || campKey(r) === sel.value) && (!q || [r.station, r.notes, r.component, r.code, r.place, r.category].join(' ').toLowerCase().includes(q)));
  const act = rs.filter(r => !r.voided);
  $('#qaBox').innerHTML = `<div><b>${act.length}</b><span>registros</span></div><div class="${act.some(isPending) ? 'alert' : ''}"><b>${act.filter(isPending).length}</b><span>por entregar</span></div><div class="${act.some(r => (r.qa || []).length) ? 'alert' : ''}"><b>${act.filter(r => (r.qa || []).length).length}</b><span>alertas QA/QC</span></div>`;
  const list = $('#recList');
  if (!rs.length) { list.innerHTML = '<p class="hint">Aún no hay registros en esta campaña.</p>'; return; }
  list.innerHTML = rs.slice(0, 300).map(r => `<div class="rec ${r.voided ? 'void' : ''}" data-id="${r.id}"><img data-th="${r.id}" alt=""><div><div class="t">${esc(r.station)} · ${esc(r.component)}</div><div class="s">${esc(r.code)} · ${esc(r.time_local.slice(0, 16).replace('T', ' '))} · ±${Math.round(r.accuracy)} m</div><div><span class="st ${statusOf(r)}">${{ local: 'en teléfono', entregado: 'entregado', subido: 'en OneDrive' }[statusOf(r)]}</span>${(r.qa || []).length ? '<span class="st qa">QA</span>' : ''}${r.voided ? '<span class="st">anulado</span>' : ''}</div></div></div>`).join('');
  list.querySelectorAll('.rec').forEach(el => el.onclick = () => detail(el.dataset.id));
  list.querySelectorAll('img[data-th]').forEach(async im => { im.src = await thumbUrl(im.dataset.th); });
}
async function detail(id) {
  const r = S.recs.find(x => x.id === id); if (!r) return;
  const b = await DB.get('blobs', id); const url = b ? URL.createObjectURL(b.stamped) : '';
  const rows = [['Correlativo', r.code], ['Estación', r.station], ['Componente', r.component], ['Categoría', r.category], ['Importancia', r.importance], ['Lugar', r.place], ['Observación', r.notes], ['Acción', r.action], ['Fecha', r.time_local.replace('T', ' ').slice(0, 19)], ['WGS84', `${r.lat.toFixed(6)}, ${r.lon.toFixed(6)}`], ['UTM', `${r.utm_zone} ${Math.round(r.utm_e)} E / ${Math.round(r.utm_n)} N`], ['Precisión', `±${r.accuracy.toFixed(1)} m`], ['Altitud', r.alt != null ? Math.round(r.alt) + ' msnm' : ''], ['Rumbo', r.heading != null ? Math.round(r.heading) + '° mag.' : ''], ['Punto KML cercano', r.nearest_feature ? `${r.nearest_feature} (${Math.round(r.nearest_dist_m)} m)` : ''], ['QA/QC', (r.qa || []).join('; ') || 'OK'], ['Estado', statusOf(r)], ['SHA-256', (r.sha256_original || '').slice(0, 16) + '…']].filter(x => x[1]);
  const v = await ask(`<img src="${url}" alt=""><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`,
    [['Compartir foto', 'share'], ['Editar', 'edit'], [r.voided ? 'Reactivar' : 'Anular', 'void'], ['Cerrar', true]]);
  URL.revokeObjectURL(url);
  if (v === 'share' && b) await shareOrDownload(b.stamped, r.photo_name + '.jpg', `${r.code} ${r.station}`);
  if (v === 'edit') await editRec(r);
  if (v === 'void') {
    const ok = await ask(`<h3>${r.voided ? 'Reactivar' : 'Anular'} registro</h3><p>${r.voided ? 'Volverá a contarse en los productos.' : 'El registro y sus fotos NO se borran: quedan marcados como ANULADO en Excel y KMZ.'}</p>`, [['Cancelar', false], ['Confirmar', true]]);
    if (ok) { r.voided = !r.voided; r.edited_at = new Date().toISOString(); await DB.put('records', r); await reload(); }
  }
}
async function editRec(r) {
  const F = [['station', 'Estación'], ['component', 'Componente'], ['category', 'Categoría'], ['importance', 'Importancia'], ['place', 'Lugar'], ['notes', 'Observación'], ['action', 'Acción']];
  const html = `<h3>Editar ${esc(r.code)}</h3><p class="hint">La foto, la hora y las coordenadas no se pueden cambiar. El rótulo se regenera.</p>` + F.map(([k, l]) => k === 'importance'
    ? `<label>${l}<select id="e_${k}">${['Baja', 'Media', 'Alta'].map(o => `<option ${o === r[k] ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`
    : k === 'notes' ? `<label>${l}<textarea id="e_${k}" rows="3">${esc(r[k])}</textarea></label>` : `<label>${l}<input id="e_${k}" value="${esc(r[k])}"></label>`).join('');
  const ok = await ask(html, [['Cancelar', false], ['Guardar cambios', true]]);
  if (!ok) return;
  const vals = Object.fromEntries(F.map(([k]) => [k, document.getElementById('e_' + k).value.trim()]));
  if (!vals.station) { toast('La estación es obligatoria'); return; }
  busy(true, 'Regenerando fotografía rotulada…');
  try {
    Object.assign(r, vals); r.edited_at = new Date().toISOString();
    r.photo_name = photoName(r);
    r.qa = [...(r.qa || []).filter(q => /EXIF|recién/.test(q)), ...qaFlags(r)];
    const b = await DB.get('blobs', r.id);
    const st = await Photo.stamp(b.original, r, { logo: await DB.kv('logo:' + r.project), north: S.set.north && r.heading != null, quality: +S.set.jpegQ || 0.9 });
    const thumb = await Photo.thumb(st.blob, 1024, 0.78);
    await DB.saveRecord(r, { original: b.original, stamped: st.blob, thumb });
    thumbUrls.delete(r.id); toast('Registro actualizado ✓');
  } catch (e) { toast('Error: ' + e.message, 6000); }
  finally { busy(false); reload(); }
}

/* ---------------- mapa ---------------- */
function bindMap() {
  $('#btnLocate').onclick = () => { if (!S.map) return; if (S.fix) S.map.setView([S.fix.lat, S.fix.lon], Math.max(S.map.getZoom(), 16)); else toast('Esperando GPS…'); };
  $('#kmlIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importLayer(f); };
  $('#tilesIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importTiles(f); };
  $('#btnLayers').onclick = () => { const p = $('#layerPanel'); p.hidden = !p.hidden; renderLayerPanel(); };
}
async function initMap() {
  if (S.map) { S.map.invalidateSize(); return; }
  const m = L.map('map', { zoomControl: true, preferCanvas: true });
  S.map = m;
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 19, attribution: '© OpenStreetMap' });
  const meta = await DB.kv('tiles_meta');
  // sin minNativeZoom: a zoom bajo Leaflet pediría millones de teselas reescaladas y congela el teléfono
  const offOpt = { maxZoom: 21, maxNativeZoom: meta ? meta.maxZ : 18, minZoom: meta ? Math.max(0, meta.minZ - 1) : 0, attribution: meta ? meta.attr : '' };
  if (meta && meta.bounds) offOpt.bounds = L.latLngBounds([meta.bounds.s, meta.bounds.w], [meta.bounds.n, meta.bounds.e]).pad(0.5);
  const off = L.tileLayer('_tiles/{z}/{x}/{y}.png', offOpt);
  osm.addTo(m); if (meta) off.addTo(m);
  S.mapLayers.base = L.control.layers({ 'OpenStreetMap (con señal / caché)': osm }, { 'Mapa offline importado': off }, { position: 'topright' }).addTo(m);
  S.mapLayers.off = off;
  m.setView(S.fix ? [S.fix.lat, S.fix.lon] : [-9.19, -75.02], S.fix ? 15 : 5);
  renderMapData(true);
}
function renderMapData(fit) {
  const m = S.map; if (!m) return;
  if (S.mapLayers.data) S.mapLayers.data.remove();
  const g = L.featureGroup().addTo(m); S.mapLayers.data = g;
  for (const l of S.layers) if (l.visible !== false) for (const f of l.features) {
    const pop = `<b>${esc(f.name)}</b><br><small>${esc(l.name)}</small>${f.desc ? '<br>' + esc(f.desc) : ''}`;
    if (f.type === 'Point') L.circleMarker(f.coords[0], { radius: 6, color: '#1f3b2d', weight: 2, fillColor: '#e9c46a', fillOpacity: 1 }).bindPopup(pop).bindTooltip(f.name, { permanent: false }).addTo(g);
    else if (f.type === 'LineString') L.polyline(f.coords, { color: '#d17a22', weight: 3 }).bindPopup(pop).addTo(g);
    else L.polygon([f.coords, ...(f.holes || [])], { color: '#2d6a4f', weight: 2, fillOpacity: 0.12 }).bindPopup(pop).addTo(g);
  }
  const col = { Alta: '#c0392b', Media: '#e0a100', Baja: '#2f9e5b' };
  for (const r of S.recs.filter(r => r.project === S.form.project)) {
    const mk = L.circleMarker([r.lat, r.lon], { radius: 7, color: '#fff', weight: 2, fillColor: r.voided ? '#999' : col[r.importance] || '#2563eb', fillOpacity: 1 }).addTo(g);
    mk.bindPopup(() => { const d = document.createElement('div'); d.innerHTML = `<b>${esc(r.station)}</b> · ${esc(r.code)}<br>${esc(r.component)} · ${esc(r.importance)}<br><small>${esc(r.time_local.slice(0, 16).replace('T', ' '))}</small><br><img alt="">`; thumbUrl(r.id).then(u => d.querySelector('img').src = u); return d; });
  }
  if (S.fix) L.circle([S.fix.lat, S.fix.lon], { radius: S.fix.acc, color: '#2563eb', weight: 1, fillOpacity: 0.08 }).addTo(g);
  if (fit && g.getLayers().length) { try { m.fitBounds(g.getBounds().pad(0.2), { maxZoom: 16 }); } catch (_) {} }
}
async function importLayer(file) {
  if (!S.form.project) { toast('Escriba primero el código de proyecto en Captura'); return; }
  busy(true, 'Leyendo capa…');
  try {
    const feats = await Geo.readKmlFile(file);
    const name = file.name.replace(/\.(kmz|kml)$/i, '');
    await DB.put('layers', { key: `${S.form.project}::${name}`, project: S.form.project, name, features: feats, visible: true, imported_at: new Date().toISOString() });
    await reload(); renderMapData(true);
    const c = t => feats.filter(f => f.type === t).length;
    toast(`Capa "${name}": ${c('Point')} puntos, ${c('LineString')} líneas, ${c('Polygon')} polígonos`);
  } catch (e) { toast('Capa: ' + e.message, 6000); }
  finally { busy(false); }
}
function renderLayerPanel() {
  const p = $('#layerPanel');
  p.innerHTML = `<b>Capas del proyecto ${esc(S.form.project || '')}</b>` + (S.layers.length ? S.layers.map(l => `<label class="check"><input type="checkbox" data-k="${esc(l.key)}" ${l.visible !== false ? 'checked' : ''}> ${esc(l.name)} <small>(${l.features.length})</small> <button type="button" class="sm ghost" data-del="${esc(l.key)}">Quitar</button></label>`).join('') : '<p class="hint">Sin capas. Importe un KMZ/KML de componentes o estaciones.</p>')
    + `<p class="hint" id="tilesInfo"></p>`;
  DB.kv('tiles_meta').then(m => { const t = $('#tilesInfo'); if (t) t.textContent = m ? `Mapa offline: ${m.count} teselas, zoom ${m.minZ}–${m.maxZ}. ${m.attr || ''}` : 'Sin mapa offline importado.'; });
  p.querySelectorAll('input[data-k]').forEach(i => i.onchange = async () => { const l = S.layers.find(x => x.key === i.dataset.k); l.visible = i.checked; await DB.put('layers', l); renderMapData(); });
  p.querySelectorAll('button[data-del]').forEach(b => b.onclick = async e => { e.preventDefault(); if (await ask('<p>¿Quitar esta capa del teléfono?</p>', [['No', false], ['Quitar', true]])) { await DB.del('layers', b.dataset.del); await reload(); renderLayerPanel(); } });
}
/* ZIP de teselas XYZ (z/x/y.png|jpg), p. ej. generado en QGIS con «Generar teselas XYZ (Directorio)». */
async function importTiles(file) {
  if (!('caches' in window)) { toast('Este navegador no permite mapas offline'); return; }
  if (file.size > 400 * 1048576) { const ok = await ask('<p>El ZIP pesa más de 400 MB. Puede fallar en teléfonos con poca memoria. ¿Continuar?</p>', [['No', false], ['Sí', true]]); if (!ok) return; }
  busy(true, 'Abriendo ZIP de mapa…');
  try {
    const zip = await JSZip.loadAsync(file);
    const re = /(?:^|\/)(\d{1,2})\/(\d+)\/(\d+)\.(png|jpe?g|webp)$/i;
    const tiles = Object.values(zip.files).filter(f => !f.dir && re.test(f.name));
    if (!tiles.length) throw new Error('No se encontraron teselas con estructura z/x/y.png');
    const attrF = Object.values(zip.files).find(f => /attribution\.txt$/i.test(f.name));
    const attr = attrF ? (await attrF.async('string')).trim().slice(0, 200) : 'Mapa base offline importado';
    await caches.delete('gf-offline-tiles');
    const cache = await caches.open('gf-offline-tiles');
    let minZ = 99, maxZ = 0, n = 0, bb = null;
    for (const f of tiles) {
      const [, z, x, y, ext] = re.exec(f.name); const zz = +z;
      const type = /png/i.test(ext) ? 'image/png' : /webp/i.test(ext) ? 'image/webp' : 'image/jpeg';
      const data = await f.async('blob');
      await cache.put(new URL(`_tiles/${z}/${x}/${y}.png`, location.href).href, new Response(data, { headers: { 'Content-Type': type } }));
      minZ = Math.min(minZ, zz); maxZ = Math.max(maxZ, zz);
      if (zz === maxZ) { const lon = +x / 2 ** zz * 360 - 180, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * +y / 2 ** zz))) * 180 / Math.PI; bb = bb && bb.z === zz ? { z: zz, s: Math.min(bb.s, lat), n: Math.max(bb.n, lat), w: Math.min(bb.w, lon), e: Math.max(bb.e, lon) } : { z: zz, s: lat, n: lat, w: lon, e: lon }; }
      if (++n % 200 === 0) $('#busyText').textContent = `Guardando teselas… ${n}/${tiles.length}`;
    }
    await DB.setKv('tiles_meta', { count: n, minZ, maxZ, attr, bounds: bb, at: new Date().toISOString() });
    toast(`Mapa offline listo: ${n} teselas (zoom ${minZ}–${maxZ})`, 5000);
    if (S.map) { S.map.remove(); S.map = null; S.mapLayers = {}; await initMap(); if (bb) S.map.fitBounds([[bb.s, bb.w], [bb.n, bb.e]]); }
  } catch (e) { toast('Mapa: ' + e.message, 6000); }
  finally { busy(false); }
}

/* ---------------- entrega: paquete, OneDrive, consolidación, restauración ---------------- */
function scopeRecs(scope) {
  const ck = `${S.form.project}/${S.form.campaign}`;
  const today = localIso(new Date()).slice(0, 10);
  return S.recs.filter(r => r.specialist === S.set.specialist || !S.set.specialist).filter(r =>
    scope === 'pend' ? isPending(r) : scope === 'today' ? r.time_local.slice(0, 10) === today : campKey(r) === ck)
    .sort((a, b) => a.time_utc.localeCompare(b.time_utc));
}
async function renderSendInfo() {
  const rs = scopeRecs($('#pkScope').value);
  if (!rs.length) { $('#pkInfo').textContent = 'No hay registros en este alcance.'; return; }
  let size = 0; const inc = $('#pkOrig').checked;
  for (const r of rs) { const b = await DB.get('blobs', r.id); if (b) size += (b.stamped ? b.stamped.size : 0) + (inc && b.original ? b.original.size : 0); }
  const camps = [...new Set(rs.map(campKey))];
  $('#pkInfo').textContent = `${rs.length} registros · ${camps.join(', ')} · ≈ ${fmtMB(size)}`;
}
function bindSend() {
  $('#pkScope').onchange = renderSendInfo; $('#pkOrig').onchange = renderSendInfo;
  $('#btnPack').onclick = () => makePackage(false);
  $('#btnLight').onclick = () => makePackage(true);
  $('#btnOdLogin').onclick = async () => { try { if (await OneDrive.signedIn()) { if (await ask('<p>¿Cerrar la sesión de Microsoft en este teléfono?</p>', [['No', false], ['Cerrar sesión', true]])) { await OneDrive.logout(); renderOdState(); } } else await OneDrive.login(); } catch (e) { toast(e.message, 6000); } };
  $('#btnOdSync').onclick = () => syncOneDrive(true);
  $('#odAuto').onchange = async e => { S.set.odAuto = e.target.checked; await DB.setKv('settings', S.set); };
  $('#consIn').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await consolidate(fs); };
  $('#restoreIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await restore(f); };
}
async function makePackage(light) {
  const scope = $('#pkScope').value, rs = scopeRecs(scope);
  if (!rs.length) { toast('No hay registros para este alcance'); return; }
  const camps = [...new Set(rs.map(campKey))];
  busy(true, 'Preparando paquete…');
  try {
    const out = [];
    for (const ck of camps) {
      const sub = rs.filter(r => campKey(r) === ck).map(r => ({ ...r, status: statusOf(r) }));
      const [project, campaign] = ck.split('/');
      const p = await Exports.pack(sub, r => DB.get('blobs', r.id), {
        includeOriginals: $('#pkOrig').checked, light, meta: { specialist: S.set.specialist, project, campaign, app: APP_VERSION },
        progress: (i, n) => $('#busyText').textContent = `Empaquetando ${ck}: ${i}/${n}`,
      });
      out.push([p, sub]);
    }
    busy(false);
    for (const [p, sub] of out) {
      const how = await shareOrDownload(p.blob, p.name, 'Alba Field ' + p.name);
      if (how === 'cancelled') continue;
      if (!light) {
        const ok = await ask(`<h3>¿Quedó guardado?</h3><p><b>${esc(p.name)}</b> (${fmtMB(p.blob.size)})</p><p>Confirme solo si lo guardó en OneDrive u otro lugar seguro. Así esos registros dejan de figurar "por entregar". Las fotos siguen en el teléfono.</p>`, [['Todavía no', false], ['Sí, quedó guardado', true]]);
        if (ok) { const now = new Date().toISOString(); for (const r of sub) { const o = S.recs.find(x => x.id === r.id); o.delivered_at = now; await DB.put('records', o); } }
      }
    }
    await reload();
  } catch (e) { busy(false); toast('Paquete: ' + e.message, 7000); }
}
async function renderOdState() {
  const c = await OneDrive.cfg(); const u = await DB.kv('od_user'); const si = await OneDrive.signedIn();
  $('#odAuto').checked = !!S.set.odAuto;
  $('#btnOdLogin').textContent = si ? `Sesión: ${u || 'Microsoft'} (cerrar)` : 'Iniciar sesión Microsoft';
  $('#odState').textContent = !c.clientId ? 'No configurado. Ver Ajustes → OneDrive.' : `Destino: ${c.target || 'AlbaField (Mi OneDrive)'} · ${si ? 'sesión activa' : 'sin sesión'} · ${S.recs.filter(r => !r.voided && needsUpload(r)).length} registros por subir`;
}
function odLog(t) { const l = $('#odLog'); l.textContent = `${new Date().toLocaleTimeString()} ${t}\n` + l.textContent.slice(0, 3000); }
async function autoSync() { if (S.set.odAuto && navigator.onLine && !S.syncing && !S.stream) { try { if (await OneDrive.signedIn()) await syncOneDrive(false); } catch (_) {} } }
async function syncOneDrive(manual) {
  if (S.syncing) return; const c = await OneDrive.cfg();
  if (!c.clientId) { if (manual) { showView('ajustes'); toast('Configure OneDrive en Ajustes'); } return; }
  if (!navigator.onLine) { if (manual) toast('Sin señal: se sincronizará cuando haya conexión'); return; }
  S.syncing = true; if (manual) busy(true, 'Conectando con OneDrive…');
  const touched = new Set(); let ok = 0, fail = 0;
  try {
    const tg = await OneDrive.target(); odLog('Destino: ' + tg.label);
    const pend = S.recs.filter(r => needsUpload(r)).sort((a, b) => a.time_utc.localeCompare(b.time_utc));
    for (const [i, r] of pend.entries()) {
      if (manual) $('#busyText').textContent = `Subiendo ${i + 1}/${pend.length} · ${r.code}`;
      const base = `${r.project}/${r.campaign}/${r.specialist}`;
      const prevUp = r.uploaded_at;
      try {
        const b = await DB.get('blobs', r.id);
        await OneDrive.upload(`${base}/fotos_rotuladas/${r.photo_name}.jpg`, b.stamped);
        await OneDrive.upload(`${base}/originales/${r.photo_name}_original.jpg`, b.original);
        r.uploaded_at = new Date().toISOString(); r.sync_error = null;
        await OneDrive.upload(`${base}/registros/${r.photo_name}.json`, new Blob([JSON.stringify({ ...r, status: 'subido' }, null, 1)], { type: 'application/json' }));
        await DB.put('records', r); touched.add(campKey(r)); ok++;
      } catch (e) { r.uploaded_at = prevUp; r.sync_error = e.message; await DB.put('records', r); fail++; odLog(`✗ ${r.code}: ${e.message}`); if (/sesión|401|403/.test(e.message)) break; }
    }
    for (const ck of touched) {
      const [project, campaign] = ck.split('/');
      const sub = S.recs.filter(r => campKey(r) === ck && r.specialist === S.set.specialist).map(r => ({ ...r, status: statusOf(r) })).sort((a, b) => a.time_utc.localeCompare(b.time_utc));
      const nm = `${S.set.specialist}_${project}_${campaign}`, base = `${project}/${campaign}/${S.set.specialist}`;
      if (manual) $('#busyText').textContent = `Actualizando Excel y KMZ de ${ck}…`;
      await OneDrive.upload(`${base}/${nm}.xlsx`, await Exports.recordsXlsx(sub));
      await OneDrive.upload(`${base}/${nm}.kmz`, await Exports.kmz(sub, async r => (await DB.get('blobs', r.id) || {}).thumb, nm));
      await OneDrive.upload(`${base}/datos_${S.set.specialist}.json`, new Blob([JSON.stringify({ schema: 'geofield.records/1', app: APP_VERSION, generated_utc: new Date().toISOString(), specialist: S.set.specialist, records: sub })], { type: 'application/json' }));
    }
    odLog(`Sincronización: ${ok} subidos${fail ? ', ' + fail + ' con error' : ''}`);
    if (manual) toast(pend.length ? `OneDrive: ${ok} subidos${fail ? ', ' + fail + ' con error (ver registro)' : ' ✓'}` : 'Todo está al día en OneDrive ✓', 5000);
  } catch (e) { odLog('✗ ' + e.message); if (manual) toast('OneDrive: ' + e.message, 7000); }
  finally { S.syncing = false; busy(false); await reload(); }
}
async function consolidate(files) {
  const log = t => { const l = $('#consLog'); l.textContent += t + '\n'; };
  $('#consLog').textContent = ''; busy(true, 'Consolidando…');
  try {
    const r = await Exports.consolidate(files, log);
    busy(false);
    log(`Total: ${r.count} registros · especialistas: ${r.esps.join(', ')}${r.conflicts ? ' · conflictos: ' + r.conflicts : ''}`);
    await shareOrDownload(r.blob, r.name, 'Alba Field GENERAL');
  } catch (e) { busy(false); log('✗ ' + e.message); }
}
async function restore(file) {
  busy(true, 'Leyendo respaldo…'); let added = 0, skipped = 0;
  try {
    const zip = await JSZip.loadAsync(file);
    const j = zip.file('datos.json'); if (!j) throw new Error('No es un paquete de Alba Field (falta datos.json)');
    const data = JSON.parse(await j.async('string'));
    for (const [i, r] of data.records.entries()) {
      $('#busyText').textContent = `Restaurando ${i + 1}/${data.records.length}`;
      if (await DB.get('records', r.id)) { skipped++; continue; }
      const st = zip.file(`fotos_rotuladas/${r.photo_name}.jpg`), og = zip.file(`originales/${r.photo_name}_original.jpg`);
      if (!st) { skipped++; continue; }
      const stamped = await st.async('blob').then(b => new Blob([b], { type: 'image/jpeg' }));
      const original = og ? await og.async('blob').then(b => new Blob([b], { type: 'image/jpeg' })) : stamped;
      if (!og) r.qa = [...new Set([...(r.qa || []), 'Restaurado sin foto original'])];
      const thumb = await Photo.thumb(stamped, 1024, 0.78);
      delete r.status; await DB.saveRecord(r, { original, stamped, thumb }); added++;
      const m = /-(\d+)$/.exec(r.code || ''); if (m && r.specialist) { const k = 'seq:' + r.specialist; if (+m[1] > ((await DB.kv(k, 0)) || 0)) await DB.setKv(k, +m[1]); }
    }
    toast(`Respaldo: ${added} restaurados, ${skipped} ya existían u omitidos`, 6000);
  } catch (e) { toast('Restaurar: ' + e.message, 7000); }
  finally { busy(false); reload(); }
}

/* ---------------- ajustes ---------------- */
function bindSettings() {
  // Proyecto y campaña editables también desde Ajustes (mismo dato que Captura)
  const syncPC = async (src, name) => {
    const v = src.value.trim().replace(/\s+/g, '-');
    if (v !== src.value) src.value = v;
    $('#formCaptura').elements[name].value = v;
    const prevP = S.form.project;
    S.form = readForm(); await DB.setKv('form', S.form);
    clearTimeout(syncPC._t); syncPC._t = setTimeout(() => { if (name === 'campaign' || prevP !== S.form.project) reload(); }, 500);
    $('#ctxLine').textContent = `${S.set.specialist || 'sin código'} · ${S.form.project || '—'}/${S.form.campaign || '—'}`;
  };
  $('#setProject').addEventListener('input', e => syncPC(e.target, 'project'));
  $('#setCampaign').addEventListener('input', e => syncPC(e.target, 'campaign'));
  $('#formSet').onsubmit = async e => {
    e.preventDefault(); const f = e.target; if (!f.reportValidity()) return;
    for (const el of f.elements) if (el.name) S.set[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim();
    S.set.specialist = S.set.specialist.toUpperCase(); f.elements.specialist.value = S.set.specialist;
    await DB.setKv('settings', S.set); toast('Ajustes guardados ✓'); reload();
  };
  $('#formOd').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const c = { clientId: f.elements.clientId.value.trim(), tenant: f.elements.tenant.value, target: f.elements.target.value.trim() };
    if (c.clientId && !/^[0-9a-f-]{36}$/i.test(c.clientId)) { toast('El ID de aplicación debe ser un GUID de 36 caracteres'); return; }
    await DB.setKv('od_cfg', c); await DB.setKv('od_target', null);
    toast(`Guardado. URI de redirección a registrar en Entra: ${OneDrive.redirectUri()}`, 8000); renderOdState();
  };
  OneDrive.cfg().then(c => { const f = $('#formOd'); f.elements.clientId.value = c.clientId || ''; f.elements.tenant.value = c.tenant || 'common'; f.elements.target.value = c.target || ''; });
  $('#logoIn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!S.form.project) { toast('Escriba primero el proyecto en Captura'); return; }
    if (f.size > 5 * 1048576) { toast('Logo máximo 5 MB'); return; }
    const small = await Photo.thumb(f, 800, 0.9).catch(() => f);
    await DB.setKv('logo:' + S.form.project, small); toast('Logo guardado para ' + S.form.project); renderSettingsProject();
  };
  $('#btnCats').onclick = async () => {
    if (!S.form.project) { toast('Escriba primero el proyecto en Captura'); return; }
    const split = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
    await DB.setKv('cat:' + S.form.project, { components: split('#catComp'), categories: split('#catCat') }); toast('Catálogos guardados ✓'); reload();
  };
  $('#btnPersist').onclick = async () => { if (navigator.storage && navigator.storage.persist) { const ok = await navigator.storage.persist(); toast(ok ? 'Datos protegidos ✓' : 'El navegador no lo concedió. Instale la app en la pantalla de inicio.', 6000); renderStorage(); } };
}
async function renderSettingsProject() {
  $('#catComp').value = (S.cats.components || []).join('\n'); $('#catCat').value = (S.cats.categories || []).join('\n');
  const logo = S.form.project && await DB.kv('logo:' + S.form.project); const im = $('#logoPrev');
  if (logo) { im.src = URL.createObjectURL(logo); im.hidden = false; } else im.hidden = true;
}
async function renderStorage() {
  if (!navigator.storage || !navigator.storage.estimate) { $('#storeInfo').textContent = 'No disponible'; return; }
  const e = await navigator.storage.estimate(); const p = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  $('#storeInfo').textContent = `Usado ${fmtMB(e.usage || 0)} de ${fmtMB(e.quota || 0)} disponibles · ${S.recs.length} registros · ${p ? 'protegido contra borrado automático ✓' : 'NO protegido: instale la app y toque el botón'}`;
}

init().catch(e => { console.error(e); toast('Error al iniciar: ' + e.message, 10000); });
