/* Alba Field 2 · aplicación de campo offline (PWA): Jornada → Estación → Fotos + notas de voz. */
const APP_VERSION = '2.2.0';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const CODE_RE = /^[A-Za-z0-9_\-]{1,32}$/;
const DEFAULT_COMPONENTS = ['Flora', 'Fauna terrestre', 'Ornitofauna', 'Mastofauna', 'Herpetofauna', 'Hidrobiología', 'Calidad de agua', 'Calidad de aire', 'Ruido', 'Suelo', 'Social', 'Arqueología'];
const STAMP_FIELDS = [['proyecto', 'Proyecto · campaña · componente'], ['evaluador', 'Evaluador'], ['estacion', 'Estación y lugar'], ['leyenda', 'Leyenda de la foto'], ['fecha', 'Fecha y hora'], ['wgs', 'Coordenadas WGS84'], ['utm', 'Coordenadas UTM'], ['altitud', 'Altitud'], ['rumbo', 'Rumbo de cámara']];
const DEFAULT_STAMP = { logoPos: 'tr', logoSize: 20, logoBg: true, bandPos: 'bottom', textStyle: 'outline', fields: Object.fromEntries(STAMP_FIELDS.map(([k]) => [k, true])) };

const S = {
  set: { north: true, maxAcc: 30, jpegQ: 0.9, drAuto: true, drCopy: false },
  d: { jornadas: [], stations: [], photos: [], audios: [], points: [], tracks: [] },
  jor: null, st: null, stPersisted: false,
  fix: null, heading: null, headingAt: 0, layers: [], allLayers: false,
  stream: null, busy: false, map: null, mapLayers: {}, syncing: false, rec: null,
};

/* ---------------- utilidades ---------------- */
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
function busy(on, text = 'Procesando…') { $('#busy').hidden = !on; $('#busyText').textContent = text; }
function ask(html, buttons = [['Aceptar', true]]) {
  return new Promise(res => {
    const d = $('#dlg'); $('#dlgBody').innerHTML = html;
    const m = $('#dlgBtns'); m.innerHTML = '';
    let chosen;
    buttons.forEach(([label, val, cls]) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = cls || (val === true ? 'primary' : 'ghost'); b.onclick = () => { chosen = val; d.close(); }; m.appendChild(b); });
    d.addEventListener('close', () => res(chosen), { once: true });
    d.showModal();
  });
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
function localIso(d) { const o = -d.getTimezoneOffset(), s = o >= 0 ? '+' : '-', a = Math.abs(o); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${s}${pad(Math.floor(a / 60))}:${pad(a % 60)}`; }
const today = () => localIso(new Date()).slice(0, 10);
const safeName = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'X';
const fmtMB = b => (b / 1048576).toFixed(b > 104857600 ? 0 : 1) + ' MB';
const ts = v => (v ? Date.parse(v) || 0 : 0);
const up = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '-');
const uid = () => crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
const needsUpload = x => x.send !== false && !x.voided && (!x.uploaded_at || ts(x.edited_at) > ts(x.uploaded_at));
const fmtDur = s => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
const dmy = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
const jorKey = j => [j.project, j.campaign, j.component, j.specialist, j.date].join('|');
const jorPath = j => [j.project, j.campaign, safeName(j.component).toUpperCase(), j.specialist, j.date];
const jorBase = j => `${j.specialist}_${j.project}_${j.campaign}_${j.date.replace(/-/g, '')}`;
const stationsOf = jid => S.d.stations.filter(s => s.jornada_id === jid).sort((a, b) => (a.time_utc || a.created_at || '').localeCompare(b.time_utc || b.created_at || ''));
const photosOf = sid => S.d.photos.filter(p => p.station_id === sid).sort((a, b) => a.n - b.n);
const audiosOf = sid => S.d.audios.filter(a => a.station_id === sid && !a.voided).sort((a, b) => a.n - b.n);
const dataOfJor = j => ({ jornadas: [j], stations: S.d.stations.filter(s => s.jornada_id === j.id), photos: S.d.photos.filter(p => p.jornada_id === j.id), audios: S.d.audios.filter(a => a.jornada_id === j.id),
  points: S.d.points.filter(t => t.jornada_id === j.id), tracks: S.d.tracks.filter(t => t.jornada_id === j.id && t.status !== 'rec') });

async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text: title }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; console.warn(e); }
  }
  return download(blob, name);
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return 'downloaded';
}

/* ---------------- arranque ---------------- */
async function init() {
  // la pantalla (index.html) y el código deben ser de la misma versión; si no, se completa la actualización antes de abrir
  const htmlVer = (document.querySelector('meta[name="app-version"]') || {}).content;
  if (htmlVer !== APP_VERSION && !sessionStorage.getItem('af_fix_' + APP_VERSION)) {
    try { sessionStorage.setItem('af_fix_' + APP_VERSION, '1'); } catch (_) {}
    busy(true, 'Actualizando Alba Field…');
    try { const r = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (r) await r.update(); } catch (_) {}
    setTimeout(() => location.reload(), 3500);
    return;
  }
  $('#verLine').textContent = `Alba Field ${APP_VERSION} · los datos quedan en este teléfono hasta que usted los envíe.`;
  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
    // el envío en segundo plano avisa cuando terminó: se refrescan los datos en pantalla
    navigator.serviceWorker.addEventListener('message', async e => {
      if (!e.data || e.data.type !== 'albafield-synced' || S.syncing) return;
      await loadAll(); await reload();
      if (e.data.result && e.data.result.ok) drLog(`✓ Segundo plano: ${e.data.result.ok} archivos enviados${e.data.result.left ? ', ' + e.data.result.left + ' pendientes' : ''}`);
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || init._reloaded) return; init._reloaded = true;
      if (!S.stream && !S.busy && !S.rec) location.reload(); else toast('Nueva versión lista: cierre y abra la app');
    });
  }
  await DB.open();
  S.set = { ...S.set, ...(await DB.kv('settings', {})) };
  // 2.2: el envío automático pasa a estar activo por defecto (antes venía apagado y no se enviaba nada solo)
  if (!(await DB.kv('defaults_2_2'))) { S.set.drAuto = true; await DB.setKv('settings', S.set); await DB.setKv('defaults_2_2', true); }
  S.allLayers = !!(await DB.kv('allLayers', false));
  await migrateV1();
  await handleSetupLink();
  await loadAll();
  const aj = await DB.kv('activeJor');
  S.jor = aj ? S.d.jornadas.find(j => j.id === aj && !j.closed_at) || null : null;
  if (S.jor) { const as = await DB.kv('activeSt'); const st = as && S.d.stations.find(s => s.id === as && s.jornada_id === S.jor.id); if (st) openStation(st.id, true); else newStation(true); }
  // un elemento que falte en pantalla no debe impedir que la app abra
  for (const f of [bindTabs, bindCampo, bindFotos, bindMap, bindSend, bindSettings]) { try { f(); } catch (e) { console.warn('bind', f.name, e); } }
  await reload();
  netBadge(); addEventListener('online', () => { netBadge(); autoSync(); refreshTeamConfig(false); }); addEventListener('offline', netBadge);
  setTimeout(() => refreshTeamConfig(false), 2500);
  startGps(); startCompass();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); });
  setInterval(autoSync, 120000); setTimeout(autoSync, 4000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { setTimeout(autoSync, 1500); if (S.trk) Track.wake(); if (!S.fix || Date.now() - S.fix.got > 20000) startGps(); } });
  Track.resume();
}

/* Registros 1.x (1 foto = 1 registro) → jornadas, estaciones y fotos. Las fotos conservan su ID y sus archivos. */
async function migrateV1() {
  if (await DB.kv('migrated_v2')) return;
  const recs = await DB.all('records');
  if (recs.length) {
    busy(true, `Actualizando ${recs.length} registros a la versión 2…`);
    try {
      const d = Exports.migrateV1(recs, uid);
      await DB.putMany('jornadas', d.jornadas); await DB.putMany('stations', d.stations); await DB.putMany('photos', d.photos);
      for (const p of new Set(recs.map(r => r.project))) { const l = await DB.kv('logo:' + p); if (l && up(p) !== p) await DB.setKv('logo:' + up(p), l); const c = await DB.kv('cat:' + p); if (c) await DB.setKv('proj:' + up(p), { components: c.components || [], evaluators: [], campaigns: [] }); }
      const last = [...recs].sort((a, b) => b.time_utc.localeCompare(a.time_utc))[0];
      await DB.setKv('lastJor', { project: up(last.project), campaign: up(last.campaign), component: last.component, specialist: last.specialist, person: last.person });
      toast(`Se convirtieron ${recs.length} fotos en ${d.stations.length} estaciones ✓`, 6000);
    } finally { busy(false); }
  } else {
    const old = await DB.kv('settings', {});
    if (old && old.specialist) await DB.setKv('lastJor', { specialist: old.specialist, person: old.person || '' });
  }
  for (const l of await DB.all('layers')) if (l.project !== up(l.project)) { await DB.del('layers', l.key); l.project = up(l.project); l.key = `${l.project}::${l.name}`; await DB.put('layers', l); }
  await DB.setKv('migrated_v2', new Date().toISOString());
}

async function loadAll() {
  const [j, s, p, a, pt, tr] = await Promise.all(['jornadas', 'stations', 'photos', 'audios', 'points', 'tracks'].map(n => DB.all(n)));
  S.d = { jornadas: j, stations: s, photos: p, audios: a, points: pt, tracks: tr };
  // se mantienen enlazados los objetos en uso (jornada activa, estación en edición, track grabando)
  if (S.jor) S.jor = j.find(x => x.id === S.jor.id) || S.jor;
  if (S.st && S.stPersisted) { const i = s.findIndex(x => x.id === S.st.id); if (i >= 0) { const { _stampedAs } = S.st; s[i] = S.st; S.st._stampedAs = _stampedAs; } }
  if (S.trk) { const i = tr.findIndex(x => x.id === S.trk.id); if (i >= 0) tr[i] = S.trk; else tr.push(S.trk); }
}
async function reload() {
  const P = S.jor ? S.jor.project : '';
  const L = await DB.all('layers');
  S.layers = S.allLayers ? L : L.filter(l => l.project === P);
  const pend = S.d.photos.filter(needsUpload).length + S.d.audios.filter(needsUpload).length;
  $('#pendBadge').hidden = !pend; $('#pendBadge').textContent = `${pend} por enviar`;
  $('#ctxLine').textContent = S.jor ? `${S.jor.specialist} · ${S.jor.project}/${S.jor.campaign} · ${dmy(S.jor.date)}` : 'Sin jornada activa';
  await renderCampo(); renderFotos(); renderSendInfo(); renderDriveState();
  if (S.map) renderMapData();
}
function netBadge() { const b = $('#netBadge'); b.textContent = navigator.onLine ? 'Con señal' : 'Sin señal'; b.className = 'badge ' + (navigator.onLine ? 'on' : 'off'); }

/* ---------------- pestañas ---------------- */
function showView(v) {
  $$('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));
  $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'mapa') setTimeout(initMap, 30);
  if (v === 'enviar') { renderSendInfo(); renderDriveState(); }
  if (v === 'fotos') renderFotos();
  if (v === 'ajustes') { renderStorage(); loadProjectSettings(); }
  $('main').scrollTop = 0;
}
function bindTabs() { $$('.tabs button').forEach(b => b.onclick = () => showView(b.dataset.v)); }

/* ---------------- catálogos por proyecto ---------------- */
async function projCfg(P) { return { evaluators: [], components: [], campaigns: [], ...((P && await DB.kv('proj:' + P)) || {}) }; }
async function stampCfg(P) { const c = (P && await DB.kv('stamp:' + P)) || {}; return { ...DEFAULT_STAMP, ...c, fields: { ...DEFAULT_STAMP.fields, ...(c.fields || {}) } }; }
const opt = arr => [...new Set(arr)].filter(Boolean).sort((a, b) => String(a).localeCompare(String(b), 'es', { numeric: true })).map(v => `<option value="${esc(v)}">`).join('');
async function knownProjects() {
  const tc = await DB.kv('team_cfg');
  if (tc && tc.projects && tc.projects.length) return [...new Set([...tc.projects, ...(S.jor ? [S.jor.project] : [])])];
  return [...new Set([...S.d.jornadas.map(j => j.project), ...((await DB.kv('projects', [])) || [])])];
}
async function fillJornadaLists() {
  const f = $('#formJornada'), P = up(f.elements.project.value);
  const c = await projCfg(P);
  $('#dlProject').innerHTML = opt(await knownProjects());
  $('#dlCampaign').innerHTML = opt([...c.campaigns, ...S.d.jornadas.filter(j => j.project === P).map(j => j.campaign)]);
  $('#dlComponent').innerHTML = opt([...(c.components.length ? c.components : DEFAULT_COMPONENTS), ...S.d.jornadas.filter(j => j.project === P).map(j => j.component)]);
  let base = c.evaluators;
  if (!P) for (const q of await knownProjects()) base = base.concat((await projCfg(q)).evaluators);   // sin proyecto aún: todos los del equipo
  const ev = [...base, ...S.d.jornadas.filter(j => j.project === P || !P).map(j => ({ code: j.specialist, name: j.person }))];
  $('#dlEvalCode').innerHTML = opt(ev.map(e => e.code)); $('#dlEvalName').innerHTML = opt(ev.map(e => e.name));
  fillJornadaLists._ev = ev;
}

/* ---------------- CAMPO · paso 1: jornada ---------------- */
async function renderCampo() {
  const inSt = !!S.jor && !renderCampo._editJor;
  $('#stepJornada').hidden = inSt; $('#stepEstacion').hidden = !inSt;
  if (!inSt) return renderJornadaStep();
  const j = S.jor, sts = stationsOf(j.id).filter(s => !s.voided);
  $('#jorHead').innerHTML = `<b>${esc(j.project)} · ${esc(j.campaign)}</b><br><small>${esc(j.component)} · ${esc(j.person || j.specialist)} (${esc(j.specialist)}) · ${dmy(j.date)}</small>`;
  const P = j.project;
  const st = new Set(S.d.stations.filter(s => s.project === P).map(s => s.station));
  S.layers.forEach(l => l.features.forEach(f => f.type === 'Point' && st.add(f.name)));
  $('#dlStation').innerHTML = opt([...st]);
  renderStation();
  $('#stCount').textContent = `(${sts.length})`;
  const list = $('#stList');
  list.innerHTML = sts.length ? sts.map(s => { const ph = photosOf(s.id).filter(p => !p.voided); return `<div class="stRow ${S.st && S.st.id === s.id ? 'cur' : ''}" data-id="${s.id}"><img data-th="${ph[0] ? ph[0].id : ''}" alt=""><div><div class="t">${esc(s.station)}</div><div class="s">${(s.time_local || '').slice(11, 16)} · ${ph.length} fotos · ${audiosOf(s.id).length} audios${s.notes ? ' · ' + esc(s.notes.slice(0, 40)) : ''}</div></div></div>`; }).join('') : '<p class="hint">Aún no hay estaciones guardadas en esta jornada.</p>';
  list.querySelectorAll('.stRow').forEach(el => el.onclick = () => openStation(el.dataset.id));
  list.querySelectorAll('img[data-th]').forEach(async im => { if (im.dataset.th) im.src = await thumbUrl(im.dataset.th); });
}
async function renderJornadaStep() {
  const f = $('#formJornada');
  if (!renderJornadaStep._filled) {
    const src = S.jor || { ...((await DB.kv('lastJor', {})) || {}), date: today() };
    for (const k of ['project', 'campaign', 'component', 'specialist', 'person', 'date']) f.elements[k].value = src[k] || (k === 'date' ? today() : '');
    renderJornadaStep._filled = true;
  }
  f.querySelector('button[type=submit]').textContent = S.jor ? 'Continuar con estaciones →' : 'Siguiente: estaciones →';
  await fillJornadaLists();
  const js = [...S.d.jornadas].sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at)).slice(0, 12);
  $('#jorList').innerHTML = js.length ? js.map(j => { const n = stationsOf(j.id).filter(s => !s.voided).length; return `<div class="stRow ${S.jor && S.jor.id === j.id ? 'cur' : ''}" data-id="${j.id}"><div><div class="t">${esc(j.project)} · ${esc(j.campaign)} · ${dmy(j.date)}</div><div class="s">${esc(j.component)} · ${esc(j.specialist)} · ${n} estaciones${j.closed_at ? ' · cerrada' : ' · abierta'}</div></div></div>`; }).join('') : '<p class="hint">Sin jornadas todavía.</p>';
  $('#jorList').querySelectorAll('.stRow').forEach(el => el.onclick = () => activateJornada(S.d.jornadas.find(j => j.id === el.dataset.id)));
}
async function activateJornada(j) {
  if (!j) return;
  if (j.closed_at) { j.closed_at = null; await DB.put('jornadas', j); }
  S.jor = j; await DB.setKv('activeJor', j.id);
  renderCampo._editJor = false; renderJornadaStep._filled = false;
  const sts = stationsOf(j.id).filter(s => !s.voided && !s.saved_at);
  if (sts.length) openStation(sts[sts.length - 1].id, true); else newStation(true);
  await reload(); toast(`Jornada ${j.project}/${j.campaign} · ${dmy(j.date)}`);
}
function bindCampo() {
  const fj = $('#formJornada');
  fj.elements.project.addEventListener('change', fillJornadaLists);
  fj.elements.specialist.addEventListener('change', () => { const e = (fillJornadaLists._ev || []).find(x => up(x.code) === up(fj.elements.specialist.value)); if (e && e.name && !fj.elements.person.value) fj.elements.person.value = e.name; });
  fj.elements.person.addEventListener('change', () => { const e = (fillJornadaLists._ev || []).find(x => x.name === fj.elements.person.value); if (e && e.code) fj.elements.specialist.value = e.code; });
  fj.onsubmit = async e => {
    e.preventDefault(); if (!fj.reportValidity()) return;
    const v = { project: up(fj.elements.project.value), campaign: up(fj.elements.campaign.value), component: fj.elements.component.value.trim(), specialist: up(fj.elements.specialist.value), person: fj.elements.person.value.trim(), date: fj.elements.date.value };
    if (!CODE_RE.test(v.project) || !CODE_RE.test(v.campaign) || !CODE_RE.test(v.specialist)) { toast('Proyecto, campaña y código: solo letras, números, guion y guion bajo'); return; }
    for (const k of ['project', 'campaign', 'specialist']) fj.elements[k].value = v[k];
    await DB.setKv('lastJor', v);
    const projs = (await DB.kv('projects', [])) || []; if (!projs.includes(v.project)) await DB.setKv('projects', [...projs, v.project]);
    const same = S.d.jornadas.find(j => jorKey(j) === jorKey(v));
    const tc = await DB.kv('team_cfg');
    if (tc && tc.projects && tc.projects.length) {
      if (!tc.projects.includes(v.project) && !(await ask(`<p>El proyecto <b>${esc(v.project)}</b> no está en la configuración del equipo.</p>`, [['Corregir', false], ['Continuar igual', true]]))) return;
      const ev = (await projCfg(v.project)).evaluators;
      if (ev.length && !ev.some(e => e.code === v.specialist) && !(await ask(`<p>El código <b>${esc(v.specialist)}</b> no figura entre los evaluadores de ${esc(v.project)}.</p>`, [['Corregir', false], ['Continuar igual', true]]))) return;
    }
    if (S.jor && jorKey(S.jor) === jorKey(v)) { if (S.jor.person !== v.person) { S.jor.person = v.person; S.jor.edited_at = new Date().toISOString(); await DB.put('jornadas', S.jor); } return activateJornada(S.jor); }
    if (same) return activateJornada(same);
    if (S.jor && S.d.stations.some(s => s.jornada_id === S.jor.id)) {
      const n = S.d.photos.filter(p => p.jornada_id === S.jor.id).length;
      const ch = await ask(`<h3>¿Corregir o iniciar otra jornada?</h3><p>Cambió datos de la jornada actual (${esc(S.jor.project)}/${esc(S.jor.campaign)} · ${dmy(S.jor.date)}).</p><p><b>Corregir</b>: se actualizan sus estaciones y se vuelven a rotular ${n} fotos.<br><b>Nueva</b>: la jornada actual queda como está.</p>`, [['Cancelar', false], ['Corregir actual', 'fix'], ['Nueva jornada', 'new', 'primary']]);
      if (!ch) return;
      if (ch === 'fix') return fixJornada(S.jor, v);
    } else if (S.jor) { Object.assign(S.jor, v, { edited_at: new Date().toISOString() }); await DB.put('jornadas', S.jor); return activateJornada(S.jor); }
    const j = { id: uid(), ...v, created_at: new Date().toISOString(), app_version: APP_VERSION };
    await DB.put('jornadas', j); S.d.jornadas.push(j);
    activateJornada(j);
  };
  $('#stepBack').onclick = () => { renderCampo._editJor = true; renderJornadaStep._filled = false; renderCampo(); };
  const fe = $('#formEstacion');
  fe.addEventListener('input', () => { readStationForm(); if (S.stPersisted) { clearTimeout(bindCampo._t); bindCampo._t = setTimeout(() => saveStationDraft(), 800); } renderStationBadge(); });
  fe.onsubmit = e => { e.preventDefault(); saveStation(); };
  $('#btnNewSt').onclick = async () => { if (S.stPersisted || hasStationContent()) { const ok = await saveStation(true); if (!ok) return; } newStation(); renderCampo(); fe.elements.station.focus(); };
  $('#btnCloseJor').onclick = closeJornada;
  $('#nearChip').onclick = () => { const n = $('#nearChip').dataset.name; if (n) { fe.elements.station.value = n; fe.dispatchEvent(new Event('input')); $('#nearChip').hidden = true; } };
  $('#btnCam').onclick = openCamera;
  // El selector de archivos solo abre dentro del gesto del usuario: se abre de inmediato y la estación se prepara en paralelo
  const pick = async (input, needFix) => {
    readStationForm();
    const quick = S.st.station && (S.stPersisted || !stationsOf(S.jor.id).some(s => s.station === S.st.station && !s.voided));
    if (quick) { S.ensureP = ensureStation(needFix); input.click(); }
    else if (await ensureStation(needFix)) { S.ensureP = Promise.resolve(true); input.click(); }
  };
  $('#btnSysCam').onclick = () => { reqCompassPermission(); pick($('#sysCam'), true); };
  $('#btnGal').onclick = () => pick($('#galIn'), false);
  $('#sysCam').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file || !(await S.ensureP)) return;
    const p = await captureFromFile(file, 'sistema');
    if (!p) return;
    // la cámara del teléfono devuelve una foto por vez: se ofrece seguir sin salir de la estación
    const n = photosOf(S.st.id).filter(x => !x.voided).length;
    const again = await ask(`<h3>Foto ${p.n} guardada ✓</h3><p>Estación <b>${esc(S.st.station)}</b> · ${n} fotos.</p>`, [['Terminar', false], ['📷 Tomar otra foto', true]]);
    if (again) $('#sysCam').click();
  };
  $('#galIn').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (!fs.length || !(await S.ensureP)) return; for (const [i, f] of fs.entries()) { busy(true, `Importando ${i + 1}/${fs.length}…`); await captureFromFile(f, 'galeria', true); } busy(false); reload(); };
  $('#camClose').onclick = closeCamera;
  $('#camShoot').onclick = shootInApp;
  $('#btnRec').onclick = toggleRec;
}
async function fixJornada(j, v) {
  busy(true, 'Corrigiendo jornada…');
  try {
    Object.assign(j, v, { edited_at: new Date().toISOString() }); await DB.put('jornadas', j);
    const now = new Date().toISOString();
    for (const s of S.d.stations.filter(s => s.jornada_id === j.id)) { Object.assign(s, v, { edited_at: now }); const { _stampedAs, ...c } = s; await DB.put('stations', c); }
    for (const a of S.d.audios.filter(a => a.jornada_id === j.id)) { Object.assign(a, v, { edited_at: now }); await DB.put('audios', a); }
    const phs = S.d.photos.filter(p => p.jornada_id === j.id);
    for (const [i, p] of phs.entries()) { $('#busyText').textContent = `Rotulando ${i + 1}/${phs.length}…`; Object.assign(p, v); await restamp(p); }
  } catch (e) { toast('Error: ' + e.message, 6000); }
  finally { busy(false); }
  activateJornada(j);
}
async function closeJornada() {
  if (S.stPersisted || hasStationContent()) { const ok = await saveStation(true); if (!ok) return; }
  const j = S.jor; const n = stationsOf(j.id).filter(s => !s.voided).length;
  const pend = S.d.photos.filter(p => p.jornada_id === j.id && needsUpload(p)).length;
  const ok = await ask(`<h3>Cerrar jornada</h3><p>${esc(j.project)}/${esc(j.campaign)} · ${dmy(j.date)} · ${n} estaciones.</p>${pend ? `<p>${pend} fotos aún no están en Drive. Quedan guardadas en el teléfono.</p>` : ''}<p>Podrá reabrirla desde "Jornadas recientes".</p>`, [['Cancelar', false], ['Cerrar jornada', true]]);
  if (!ok) return;
  j.closed_at = new Date().toISOString(); await DB.put('jornadas', j);
  S.jor = null; S.st = null; S.stPersisted = false; await DB.setKv('activeJor', null); await DB.setKv('activeSt', null);
  renderJornadaStep._filled = false; renderCampo._editJor = false;
  await reload();
  const c = await Drive.cfg();
  if (Drive.ready(c) && navigator.onLine && pend) { if (await ask('<p>¿Enviar ahora la jornada a Google Drive?</p>', [['Después', false], ['Enviar', true]])) syncDrive(true); }
  else toast('Jornada cerrada ✓');
}

/* ---------------- CAMPO · paso 2: estación ---------------- */
function newStation(silent) {
  const j = S.jor;
  S.st = { id: uid(), jornada_id: j.id, project: j.project, campaign: j.campaign, component: j.component, specialist: j.specialist, person: j.person, date: j.date, station: '', place: '', notes: '', qa: [], created_at: new Date().toISOString(), app_version: APP_VERSION };
  S.stPersisted = false; DB.setKv('activeSt', null);
  if (!silent) renderStation();
}
function openStation(id, silent) {
  const s = S.d.stations.find(x => x.id === id); if (!s) return;
  S.st = s; S.stPersisted = true; S.st._stampedAs = stampSig(s); DB.setKv('activeSt', s.id);
  if (!silent) { renderCampo(); $('main').scrollTop = 0; }
}
function readStationForm() { const f = $('#formEstacion'); S.st.station = up(f.elements.station.value); S.st.place = f.elements.place.value.trim(); S.st.notes = f.elements.notes.value; }
const hasStationContent = () => S.st && (S.st.station || (S.st.notes || '').trim());
const stampSig = s => [s.station, s.place].join('|');
function renderStationBadge() {
  const b = $('#stBadge');
  b.hidden = false;
  if (!S.stPersisted) { b.textContent = 'nueva'; b.className = 'st local'; }
  else if (S.st.saved_at && ts(S.st.saved_at) >= ts(S.st.edited_at)) { b.textContent = 'guardada ✓'; b.className = 'st subido'; }
  else { b.textContent = 'en edición'; b.className = 'st local'; }
}
function renderStation() {
  const f = $('#formEstacion'), s = S.st;
  if (document.activeElement !== f.elements.station) f.elements.station.value = s.station || '';
  if (document.activeElement !== f.elements.place) f.elements.place.value = s.place || '';
  if (document.activeElement !== f.elements.notes) f.elements.notes.value = s.notes || '';
  $('#stTitle').textContent = S.stPersisted ? `Estación ${s.station}` : 'Nueva estación';
  renderStationBadge();
  const phs = photosOf(s.id);
  $('#phCount').textContent = `${phs.filter(p => !p.voided).length} fotos`;
  $('#stPhotos').innerHTML = phs.map(p => `<div class="ph ${p.voided || p.send === false ? 'off' : ''}" data-id="${p.id}"><img data-th="${p.id}" alt=""><span class="n">${p.n}</span>${p.uploaded_at && !needsUpload(p) ? '<span class="up">☁️</span>' : ''}<span class="cap">${esc(p.voided ? 'ANULADA' : p.caption || 'sin leyenda')}</span></div>`).join('');
  $('#stPhotos').querySelectorAll('.ph').forEach(el => el.onclick = () => photoDialog(el.dataset.id));
  $('#stPhotos').querySelectorAll('img[data-th]').forEach(async im => { im.src = await thumbUrl(im.dataset.th); });
  renderAudios();
  nearSuggest();
}
/* Crea la estación en la base (con coordenadas) antes de agregarle fotos o audios. */
async function ensureStation(needFix = true) {
  readStationForm();
  const f = $('#formEstacion');
  if (!S.st.station) { f.elements.station.reportValidity(); toast('Escriba primero el código de la estación'); f.elements.station.focus(); return false; }
  if (!S.stPersisted) {
    const dup = stationsOf(S.jor.id).find(s => s.station === S.st.station && !s.voided);
    if (dup) {
      const ch = await ask(`<p>La estación <b>${esc(dup.station)}</b> ya existe en esta jornada.</p>`, [['Cancelar', false], ['Abrir la existente', true]]);
      if (!ch) return false;
      const keep = { notes: S.st.notes };
      openStation(dup.id, true);
      if (keep.notes && !(dup.notes || '').includes(keep.notes)) dup.notes = [dup.notes, keep.notes].filter(Boolean).join('\n');
      await saveStationDraft(); renderCampo(); return true;
    }
  }
  if (S.st.lat == null && needFix) {
    try { setStationFix(await freshFix(20000, 12000)); } catch (_) { /* se fija con la primera foto */ }
  }
  if (!S.stPersisted) { S.st.time_local = localIso(new Date()); S.st.time_utc = new Date().toISOString(); S.stPersisted = true; S.d.stations.push(S.st); DB.setKv('activeSt', S.st.id); S.st._stampedAs = stampSig(S.st); }
  await saveStationDraft();
  return true;
}
function setStationFix(fx) {
  const u = Geo.toUTM(fx.lat, fx.lon);
  const near = Geo.nearestPoint(S.layers.flatMap(l => l.features), fx.lat, fx.lon);
  Object.assign(S.st, { lat: fx.lat, lon: fx.lon, alt: fx.alt, accuracy: fx.acc, gps_time_utc: new Date(fx.ts).toISOString(), utm_zone: u.zone, utm_e: u.e, utm_n: u.n, nearest_feature: near ? near.name : null, nearest_dist_m: near ? Math.round(near.d * 10) / 10 : null });
}
async function saveStationDraft() {
  if (!S.stPersisted) return;
  S.st.edited_at = new Date().toISOString();
  const { _stampedAs, ...clean } = S.st;
  await DB.put('stations', clean);
}
function stationQa(s) {
  const q = [];
  if (s.accuracy != null && s.accuracy > S.set.maxAcc) q.push(`Precisión GPS ±${Math.round(s.accuracy)} m > ${S.set.maxAcc} m`);
  if (s.lat == null) q.push('Estación sin coordenadas');
  const same = S.layers.flatMap(l => l.features).find(x => x.type === 'Point' && up(x.name) === s.station);
  if (same && s.lat != null) { const d = Geo.dist(s.lat, s.lon, same.coords[0][0], same.coords[0][1]); if (d > 50) q.push(`A ${Math.round(d)} m del punto KMZ "${same.name}"`); }
  return q;
}
async function saveStation(quiet) {
  if (!(await ensureStation())) return false;
  const s = S.st;
  if (s.lat == null) {
    const ph = photosOf(s.id).find(p => p.lat != null);
    if (ph) setStationFix({ lat: ph.lat, lon: ph.lon, alt: ph.alt, acc: ph.accuracy ?? 0, ts: Date.parse(ph.gps_time_utc || ph.time_utc) });
    else if (S.fix) setStationFix(S.fix);
  }
  s.qa = stationQa(s);
  const renamed = s._stampedAs !== stampSig(s);
  await saveStationDraft();
  s.saved_at = new Date(Date.now() + 5).toISOString();
  { const { _stampedAs, ...clean } = s; await DB.put('stations', clean); }
  if (renamed) {
    const phs = photosOf(s.id);
    if (phs.length) { busy(true, 'Actualizando rótulo de las fotos…'); try { for (const p of phs) { p.station = s.station; await restamp(p); } } finally { busy(false); } }
    for (const a of S.d.audios.filter(a => a.station_id === s.id)) { a.station = s.station; a.edited_at = new Date().toISOString(); await DB.put('audios', a); }
    s._stampedAs = stampSig(s);
  }
  const n = photosOf(s.id).filter(p => !p.voided).length, na = audiosOf(s.id).length;
  clearTimeout(saveStation._t); saveStation._t = setTimeout(autoSync, 8000); requestBgSync();
  if (!quiet) toast(`Estación ${s.station} guardada ✓ · ${n} fotos · ${na} audios${s.qa.length ? ' · QA: ' + s.qa[0] : ''}`, 4000);
  await reload();
  return true;
}

/* ---------------- notas de voz ---------------- */
function pickAudioMime() {
  const c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/aac'];
  return (window.MediaRecorder && MediaRecorder.isTypeSupported) ? c.find(t => MediaRecorder.isTypeSupported(t)) || '' : '';
}
async function toggleRec() {
  if (S.rec) { S.rec.mr.stop(); return; }
  if (!window.MediaRecorder) { toast('Este navegador no permite grabar audio'); return; }
  if (!(await ensureStation())) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch (e) { toast('Permiso de micrófono denegado'); return; }
  const mime = pickAudioMime();
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : undefined);
  const chunks = [], t0 = Date.now(), station = S.st;
  mr.ondataavailable = e => e.data && e.data.size && chunks.push(e.data);
  mr.onstop = async () => {
    stream.getTracks().forEach(t => t.stop()); clearInterval(S.rec.timer);
    const dur = (Date.now() - t0) / 1000; S.rec = null; recUi(false);
    if (dur < 0.8) { toast('Grabación muy corta, descartada'); return; }
    const type = (mr.mimeType || mime || 'audio/webm').split(';')[0];
    const blob = new Blob(chunks, { type });
    const ext = /mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
    const n = Math.max(0, ...S.d.audios.filter(a => a.station_id === station.id).map(a => a.n)) + 1;
    const now = new Date(t0);
    const a = { id: uid(), station_id: station.id, jornada_id: station.jornada_id, project: station.project, campaign: station.campaign, component: station.component, specialist: station.specialist, person: station.person, date: station.date, station: station.station, n,
      time_local: localIso(now), time_utc: now.toISOString(), duration_s: Math.round(dur), mime: type, size: blob.size, send: true, created_at: new Date().toISOString(), app_version: APP_VERSION };
    a.file_name = `${station.specialist}_${safeName(station.station)}_${station.date.replace(/-/g, '')}_A${pad(n)}.${ext}`;
    await DB.saveWithBlob('audios', a, { audio: blob });
    S.d.audios.push(a); toast(`Nota de voz ${n} guardada ✓ (${fmtDur(dur)})`);
    if (S.st && S.st.id === station.id) renderAudios();
    reload();
  };
  mr.start(1000);
  S.rec = { mr, t0, timer: setInterval(() => { $('#recTimer').textContent = `● ${fmtDur((Date.now() - t0) / 1000)}`; }, 500) };
  recUi(true); navigator.vibrate && navigator.vibrate(30);
}
function recUi(on) {
  const b = $('#btnRec'); b.classList.toggle('recOn', on); b.textContent = on ? '■ Detener y guardar' : '🎙 Grabar nota de voz';
  $('#recTimer').hidden = !on; if (on) $('#recTimer').textContent = '● 00:00';
}
const audioUrls = new Map();
function renderAudios() {
  const list = $('#audList'); const as = S.st ? audiosOf(S.st.id) : [];
  list.innerHTML = as.map(a => `<div class="aud" data-id="${a.id}"><small>A${a.n} · ${fmtDur(a.duration_s || 0)}</small><audio controls preload="none"></audio><button type="button" class="x" title="Eliminar">✕</button></div>`).join('');
  list.querySelectorAll('.aud').forEach(async el => {
    const id = el.dataset.id;
    el.querySelector('.x').onclick = () => deleteAudio(id);
    if (!audioUrls.has(id)) { const b = await DB.get('blobs', id); if (b && b.audio) audioUrls.set(id, URL.createObjectURL(b.audio)); }
    el.querySelector('audio').src = audioUrls.get(id) || '';
  });
}
async function deleteAudio(id) {
  const a = S.d.audios.find(x => x.id === id); if (!a) return;
  if (!(await ask(`<p>¿Eliminar la nota de voz A${a.n}?</p>${a.uploaded_at ? '<p class="hint">Ya está en Drive: quedará marcada como ANULADA en la matriz.</p>' : ''}`, [['No', false], ['Eliminar', true]]))) return;
  if (a.uploaded_at) { a.voided = true; a.edited_at = new Date().toISOString(); await DB.put('audios', a); }
  else { await DB.del('audios', id); await DB.del('blobs', id); S.d.audios = S.d.audios.filter(x => x.id !== id); }
  renderAudios(); reload();
}

/* ---------------- GPS y brújula ---------------- */
let fixWaiters = [];
function startGps() {
  if (!('geolocation' in navigator)) { gpsUi(null, 'Este navegador no tiene GPS'); return; }
  if (S.gpsWatch != null) navigator.geolocation.clearWatch(S.gpsWatch);
  S.gpsWatch = navigator.geolocation.watchPosition(p => {
    S.fix = { lat: p.coords.latitude, lon: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy, ts: p.timestamp, got: Date.now() };
    gpsUi(S.fix); fixWaiters.splice(0).forEach(w => w(S.fix)); nearSuggest();
    fixListeners.forEach(f => f(S.fix)); Track.onFix(S.fix);
    if (S.map && $('#view-mapa').classList.contains('active')) updateMe();
  }, e => gpsUi(null, e.code === 1 ? 'Permiso de ubicación denegado' : 'Buscando GPS…'), { enableHighAccuracy: true, maximumAge: 0, timeout: 60000 });
}
function gpsUi(fx, msg) {
  const b = $('#gpsBar');
  if (!fx) { b.className = 'gpsbar'; $('#gpsText').textContent = msg || 'GPS en espera'; return; }
  b.className = 'gpsbar ' + (fx.acc <= 10 ? 'good' : fx.acc <= S.set.maxAcc ? 'fair' : 'poor');
  const u = Geo.toUTM(fx.lat, fx.lon);
  $('#gpsText').textContent = `±${Math.round(fx.acc)} m · UTM ${u.zone} ${Math.round(u.e)} E ${Math.round(u.n)} N${fx.alt != null ? ' · ' + Math.round(fx.alt) + ' msnm' : ''}`;
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
  const chip = $('#nearChip'); if (!S.fix || !S.jor || !S.st) { chip.hidden = true; return; }
  const n = Geo.nearestPoint(S.layers.flatMap(l => l.visible === false ? [] : l.features), S.fix.lat, S.fix.lon);
  const cur = up($('#formEstacion').elements.station.value);
  if (n && n.d <= 60 && up(n.name) !== cur && !S.stPersisted) { chip.hidden = false; chip.dataset.name = n.name; chip.textContent = `📍 Punto cercano: ${n.name} (${Math.round(n.d)} m) · tocar para usar`; }
  else chip.hidden = true;
}
function startCompass() {
  const h = e => {
    let v = null;
    if (typeof e.webkitCompassHeading === 'number') v = e.webkitCompassHeading;
    else if (e.alpha != null && (e.absolute || e.type === 'deviceorientationabsolute')) v = Geo.cameraHeading(e.alpha, e.beta, e.gamma);
    if (v != null && isFinite(v)) {
      S.heading = (v + 360) % 360; S.headingAt = Date.now(); if (!$('#camera').hidden) camHud();
      if (S.map && Date.now() - (startCompass._t || 0) > 400 && $('#view-mapa').classList.contains('active')) { startCompass._t = Date.now(); updateMe(); }
    }
  };
  if ('ondeviceorientationabsolute' in window) addEventListener('deviceorientationabsolute', h);
  else addEventListener('deviceorientation', h);
}
function reqCompassPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    DeviceOrientationEvent.requestPermission().catch(() => {});
}
const headingNow = () => (S.set.north && S.heading != null && Date.now() - S.headingAt < 3000) ? S.heading : null;

/* ---------------- cámara ---------------- */
async function openCamera() {
  if (!(await ensureStation())) return;
  reqCompassPermission();
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $('#sysCam').click(); return; }
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
  } catch (e) { toast('No se pudo abrir la cámara integrada; se usa la del teléfono'); $('#sysCam').click(); return; }
  const v = $('#video'); v.srcObject = S.stream; await v.play().catch(() => {});
  $('#camCaption').value = ''; $('#camera').hidden = false; camHud();
}
function closeCamera() {
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  S.stream = null; $('#video').srcObject = null; $('#camera').hidden = true; reload();
}
function camHud() {
  const fx = S.fix;
  $('#camInfo').textContent = `${S.st ? S.st.station : '—'} · ${fx ? '±' + Math.round(fx.acc) + ' m' : 'sin GPS'}${fx && Date.now() - fx.got > 15000 ? ' (antiguo)' : ''}`;
  const h = headingNow(); $('#camHeading').textContent = h == null ? 'Rumbo —' : `Rumbo ${Math.round(h)}° mag.`;
  $('#camCount').textContent = S.st ? `${photosOf(S.st.id).filter(p => !p.voided).length} 📷` : '';
}
async function grabFrame() {
  const track = S.stream.getVideoTracks()[0];
  // takePhoto da mejor resolución, pero en algunos Android congela la cámara: se limita a 5 s y se verifica la pista
  if ('ImageCapture' in window && !S.noTakePhoto) {
    try {
      const b = await Promise.race([new ImageCapture(track).takePhoto(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000))]);
      if (b && b.size) return b;
    } catch (e) { console.warn('takePhoto', e); S.noTakePhoto = true; }
  }
  const v = $('#video'), c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('No se capturó imagen')), 'image/jpeg', 0.95));
}
/* Mantiene la cámara viva entre disparos: si la pista terminó o el video se congeló, se reabre. */
async function keepCameraAlive() {
  if (!S.stream || $('#camera').hidden) return;
  const t = S.stream.getVideoTracks()[0], v = $('#video');
  if (t && t.readyState === 'live' && !t.muted && !v.paused) return;
  try {
    S.stream.getTracks().forEach(x => x.stop());
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } } });
    v.srcObject = S.stream; await v.play().catch(() => {});
  } catch (e) { toast('La cámara se cerró: toque Listo y vuelva a abrirla'); }
}
async function shootInApp() {
  if (S.busy || !S.stream) return;
  S.busy = true; const btn = $('#camShoot'); btn.disabled = true;
  try {
    const shotAt = new Date(), heading = headingNow();
    const blob = await grabFrame();
    navigator.vibrate && navigator.vibrate(40);
    const fx = await freshFix(15000, 20000);
    if (!(await acceptAccuracy(fx))) return;
    const p = await savePhoto(blob, { shotAt, fx, heading, mode: 'app', caption: $('#camCaption').value.trim() });
    $('#camCaption').value = '';
    toast(`Foto ${p.n} guardada ✓ · puede tomar otra`, 2000);
  } catch (e) { toast('Error: ' + e.message, 6000); }
  finally { S.busy = false; btn.disabled = false; await keepCameraAlive(); camHud(); }
}
/* Foto desde la cámara del sistema o desde la galería del teléfono. En galería se usa el GPS y la fecha EXIF si existen. */
async function captureFromFile(file, mode, multi) {
  if (!multi) busy(true, 'Obteniendo GPS y guardando…');
  try {
    let shotAt = new Date(), fx = null; const qa = [];
    const ex = await Photo.exifDate(file);
    if (mode === 'galeria') {
      const g = await exifGps(file);
      if (ex) shotAt = ex;
      if (g) fx = { ...g, acc: null, ts: shotAt.getTime() };
      else { fx = await freshFix(30000, 15000); qa.push('Foto de galería sin GPS: se usó la posición del teléfono al importar'); }
      if (!ex) qa.push('Foto de galería sin fecha EXIF: se usó la hora de importación');
      if (fx.lat != null && S.st.lat != null && Geo.dist(fx.lat, fx.lon, S.st.lat, S.st.lon) > 100) qa.push(`Foto tomada a ${Math.round(Geo.dist(fx.lat, fx.lon, S.st.lat, S.st.lon))} m de la estación`);
    } else {
      fx = await freshFix(15000, 25000);
      if (!multi) busy(false);
      if (!(await acceptAccuracy(fx))) return;
      if (!multi) busy(true, 'Guardando…');
      if (ex && Math.abs(ex - shotAt) > 5 * 60000) qa.push('Fecha EXIF de la foto difiere >5 min de la captura');
      if (file.lastModified && shotAt - file.lastModified > 10 * 60000) qa.push('Archivo podría no ser recién tomado');
    }
    const p = await savePhoto(file, { shotAt, fx, heading: null, mode, qa });
    if (!multi && mode !== 'sistema') toast(`Foto ${p.n} guardada ✓ · ${p.station}`);
    return p;
  } catch (e) { toast('Error: ' + e.message, 6000); }
  finally { if (!multi) { busy(false); reload(); } }
}
async function exifGps(blob) {
  try {
    const P = window.piexif; const o = P.load(await Photo.readDataURL(blob.slice(0, 256 * 1024, 'image/jpeg')));
    const g = o.GPS; if (!g || !g[P.GPSIFD.GPSLatitude]) return null;
    const dms = a => a[0][0] / a[0][1] + a[1][0] / a[1][1] / 60 + a[2][0] / a[2][1] / 3600;
    let lat = dms(g[P.GPSIFD.GPSLatitude]), lon = dms(g[P.GPSIFD.GPSLongitude]);
    if (g[P.GPSIFD.GPSLatitudeRef] === 'S') lat = -lat;
    if (g[P.GPSIFD.GPSLongitudeRef] === 'W') lon = -lon;
    const alt = g[P.GPSIFD.GPSAltitude] ? g[P.GPSIFD.GPSAltitude][0] / g[P.GPSIFD.GPSAltitude][1] * (g[P.GPSIFD.GPSAltitudeRef] === 1 ? -1 : 1) : null;
    return isFinite(lat) && isFinite(lon) && (lat || lon) ? { lat, lon, alt } : null;
  } catch (_) { return null; }
}
async function acceptAccuracy(fx) {
  if (fx.acc == null || fx.acc <= S.set.maxAcc) return true;
  return ask(`<h3>Precisión GPS baja</h3><p>Precisión estimada ±${Math.round(fx.acc)} m (umbral ${S.set.maxAcc} m). Quedará marcado en QA/QC.</p>`, [['Cancelar', false], ['Guardar igual', true]]);
}
/* Textos de la banda según la configuración del proyecto */
function stampLines(p, cfg) {
  const F = cfg.fields, L = [];
  if (F.proyecto) L.push([p.project, p.campaign, p.component].filter(Boolean).join(' · '));
  if (F.evaluador) L.push(`Evaluador: ${p.person || p.specialist}${p.person ? ' (' + p.specialist + ')' : ''}`);
  if (F.estacion) L.push(`Estación: ${p.station}${p.place ? '  ·  ' + p.place : ''}`);
  if (F.leyenda && p.caption) L.push(`Foto ${p.n}: ${p.caption}`);
  if (F.fecha) L.push(`${(p.time_local || '').replace('T', ' ').slice(0, 19)} (${Photo.fmtOffset(p.utc_offset_minutes || 0)})`);
  if (F.wgs && p.lat != null) L.push(`WGS84: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}${p.accuracy != null ? '  ±' + p.accuracy.toFixed(0) + ' m' : ''}${F.altitud && p.alt != null ? '  ·  ' + Math.round(p.alt) + ' msnm' : ''}`);
  else if (F.altitud && p.alt != null) L.push(`Altitud: ${Math.round(p.alt)} msnm`);
  if (F.utm && p.utm_zone) L.push(`UTM ${p.utm_zone}: E ${Math.round(p.utm_e)}  N ${Math.round(p.utm_n)}`);
  if (F.rumbo && S.set.north) L.push(`Rumbo cámara (magnético aprox.): ${p.heading == null ? 'no disponible' : Math.round(p.heading) + '°'}`);
  return L;
}
async function stampPhoto(original, p) {
  const cfg = await stampCfg(p.project);
  const st = S.d.stations.find(s => s.id === p.station_id) || {};
  return Photo.stamp(original, p, { lines: stampLines({ ...p, place: st.place }, cfg), logo: await DB.kv('logo:' + p.project), cfg, north: S.set.north && cfg.fields.rumbo !== false, quality: +S.set.jpegQ || 0.9 });
}
async function savePhoto(original, { shotAt, fx, heading, mode, qa = [], caption = '' }) {
  readStationForm();
  const s = S.st;
  if (s.lat == null && fx.lat != null && mode !== 'galeria') setStationFix(fx);
  const u = fx.lat != null ? Geo.toUTM(fx.lat, fx.lon) : {};
  const n = Math.max(0, ...S.d.photos.filter(p => p.station_id === s.id).map(p => p.n)) + 1;
  const local = localIso(shotAt);
  const p = {
    id: uid(), station_id: s.id, jornada_id: s.jornada_id, project: s.project, campaign: s.campaign, component: s.component, specialist: s.specialist, person: s.person, date: s.date, station: s.station, n, caption,
    time_local: local, time_utc: shotAt.toISOString(), utc_offset_minutes: -shotAt.getTimezoneOffset(),
    lat: fx.lat, lon: fx.lon, alt: fx.alt, accuracy: fx.acc, gps_time_utc: new Date(fx.ts).toISOString(), gps_age_s: Math.round((shotAt - fx.ts) / 1000),
    utm_zone: u.zone, utm_e: u.e, utm_n: u.n, heading, heading_reference: heading == null ? null : 'magnetico_aprox_camara',
    camera_mode: mode, send: true, app_version: APP_VERSION, created_at: new Date().toISOString(),
  };
  p.photo_name = `${s.specialist}_${safeName(s.station)}_${s.date.replace(/-/g, '')}_F${pad(n)}`;
  p.qa = [...qa, ...photoQa(p)];
  p.sha256_original = await Photo.sha256(original);
  const st = await stampPhoto(original, p);
  p.width = st.width; p.height = st.height;
  const thumb = await Photo.thumb(st.blob, 1024, 0.78);
  const origBlob = new Blob([await original.arrayBuffer()], { type: original.type || 'image/jpeg' });
  await DB.saveWithBlob('photos', p, { original: origBlob, stamped: st.blob, thumb });
  S.d.photos.push(p);
  await saveStationDraft();
  if (S.st && S.st.id === s.id) renderStation();
  return p;
}
function photoQa(p) {
  const q = [];
  if (p.accuracy != null && p.accuracy > S.set.maxAcc) q.push(`Precisión GPS ±${Math.round(p.accuracy)} m > ${S.set.maxAcc} m`);
  if (p.camera_mode !== 'galeria' && p.gps_age_s > 60) q.push(`Posición GPS de hace ${p.gps_age_s} s`);
  if (p.time_local.slice(0, 10) !== p.date) q.push(`Fecha de la foto (${p.time_local.slice(0, 10)}) distinta a la de la jornada`);
  return q;
}
async function restamp(p) {
  const b = await DB.get('blobs', p.id); if (!b || !b.original) return;
  const st = await stampPhoto(b.original, p);
  const thumb = await Photo.thumb(st.blob, 1024, 0.78);
  p.edited_at = new Date().toISOString();
  await DB.saveWithBlob('photos', p, { original: b.original, stamped: st.blob, thumb });
  thumbUrls.delete(p.id);
}

/* ---------------- ficha de foto ---------------- */
const thumbUrls = new Map();
async function thumbUrl(id) {
  if (thumbUrls.has(id)) return thumbUrls.get(id);
  const b = await DB.get('blobs', id); const u = b && b.thumb ? URL.createObjectURL(b.thumb) : ''; thumbUrls.set(id, u); return u;
}
async function photoDialog(id) {
  const p = S.d.photos.find(x => x.id === id); if (!p) return;
  const b = await DB.get('blobs', id); const url = b ? URL.createObjectURL(b.stamped) : '';
  const rows = [['Archivo', p.photo_name + '.jpg'], ['Estación', p.station], ['Fecha', p.time_local.replace('T', ' ').slice(0, 19)], ['UTM', p.utm_zone ? `${p.utm_zone} ${Math.round(p.utm_e)} E / ${Math.round(p.utm_n)} N` : ''], ['Precisión', p.accuracy != null ? `±${p.accuracy.toFixed(1)} m` : 'EXIF'], ['Rumbo', p.heading != null ? Math.round(p.heading) + '° mag.' : ''], ['QA/QC', (p.qa || []).join('; ') || 'OK'], ['Estado', p.voided ? 'ANULADA' : p.uploaded_at && !needsUpload(p) ? 'en Drive ☁️' : 'en teléfono']].filter(x => x[1]);
  const v = await ask(`<img src="${url}" alt=""><label>Leyenda<textarea id="pdCap" rows="2" placeholder="Qué muestra la foto">${esc(p.caption)}</textarea></label><label class="check"><input type="checkbox" id="pdSend" ${p.send !== false ? 'checked' : ''}> Enviar a Drive e incluir en productos</label><table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`,
    [['🗑 Eliminar', 'del', 'danger'], ['Compartir', 'share'], [p.voided ? 'Reactivar' : 'Anular', 'void'], ['Cerrar', 'close'], ['Guardar', true]]);
  const cap = (document.getElementById('pdCap') || {}).value || '', send = (document.getElementById('pdSend') || {}).checked;
  URL.revokeObjectURL(url);
  if (v === true) {
    const capChanged = cap.trim() !== (p.caption || '');
    p.caption = cap.trim();
    p.send = !!send;
    if (capChanged) { busy(true, 'Rotulando…'); try { await restamp(p); } finally { busy(false); } }
    else await DB.put('photos', p);
    toast('Foto actualizada ✓');
  }
  if (v === 'share' && b) await shareOrDownload(b.stamped, p.photo_name + '.jpg', `${p.station} foto ${p.n}`);
  if (v === 'del') await deletePhoto(p);
  if (v === 'void') {
    const ok = await ask(`<h3>${p.voided ? 'Reactivar' : 'Anular'} foto</h3><p>${p.voided ? 'Volverá a contarse en los productos.' : 'La foto NO se borra: queda marcada como ANULADA en la matriz y sale del KMZ y la galería.'}</p>`, [['Cancelar', false], ['Confirmar', true]]);
    if (ok) { p.voided = !p.voided; p.edited_at = new Date().toISOString(); await DB.put('photos', p); }
  }
  await reload();
}

/* Borrado definitivo con doble confirmación. Si ya estaba en Drive, la copia de Drive no se toca. */
async function deletePhoto(p, quiet) {
  const b = await DB.get('blobs', p.id); const url = b && b.thumb ? URL.createObjectURL(b.thumb) : '';
  const ok = await ask(`<h3>¿Eliminar esta foto?</h3><img src="${url}" alt="" style="max-height:38vh;object-fit:contain"><p><b>${esc(p.station)} · foto ${p.n}</b>${p.caption ? ' · ' + esc(p.caption) : ''}</p><p>Se borra del teléfono (rotulada y original) y <b>no se puede recuperar</b>.</p>${p.uploaded_at ? '<p class="hint">Ya fue enviada a Drive: la copia en Drive se queda; bórrela allí si no la necesita.</p>' : ''}<label class="check"><input type="checkbox" id="delOk"> Sí, quiero eliminarla</label>`,
    [['Cancelar', false], ['Eliminar', true, 'danger']]);
  const sure = (document.getElementById('delOk') || {}).checked;
  if (url) URL.revokeObjectURL(url);
  if (!ok) return false;
  if (!sure) { toast('Marque "Sí, quiero eliminarla" para confirmar'); return false; }
  await DB.del('photos', p.id); await DB.del('blobs', p.id);
  S.d.photos = S.d.photos.filter(x => x.id !== p.id);
  thumbUrls.delete(p.id);
  const st = S.d.stations.find(x => x.id === p.station_id);
  if (st) { st.edited_at = new Date().toISOString(); const { _stampedAs, ...c } = st; await DB.put('stations', c); }
  if (!quiet) toast('Foto eliminada');
  await reload();
  return true;
}

/* ---------------- FOTOS: galería con selección ---------------- */
function scopePhotos(scope) {
  const j = S.jor;
  return S.d.photos.filter(p => scope === 'jor' ? j && p.jornada_id === j.id : scope === 'camp' ? j && p.project === j.project && p.campaign === j.campaign : scope === 'pend' ? needsUpload(p) || (p.send === false && !p.uploaded_at && !p.voided) : true);
}
function filteredPhotos() {
  const q = $('#fText').value.trim().toLowerCase();
  return scopePhotos($('#fScope').value).filter(p => !q || [p.station, p.caption, p.photo_name, p.component].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.time_utc.localeCompare(a.time_utc));
}
function renderFotos() {
  if (!S.jor && ['jor', 'camp'].includes($('#fScope').value)) $('#fScope').value = 'all';
  const ps = filteredPhotos(), act = ps.filter(p => !p.voided);
  const sel = act.filter(p => p.send !== false), pend = act.filter(needsUpload);
  $('#selInfo').textContent = `${sel.length} de ${act.length} seleccionadas`;
  $('#qaBox').innerHTML = `<div><b>${act.length}</b><span>fotos</span></div><div class="${pend.length ? 'alert' : ''}"><b>${pend.length}</b><span>por enviar</span></div><div class="${act.some(p => (p.qa || []).length) ? 'alert' : ''}"><b>${act.filter(p => (p.qa || []).length).length}</b><span>alertas QA/QC</span></div>`;
  const g = $('#galGrid');
  if (!ps.length) { g.innerHTML = '<p class="hint">No hay fotos en este filtro.</p>'; return; }
  g.innerHTML = ps.slice(0, 400).map(p => `<div class="galCard" data-id="${p.id}"><div class="ph ${p.voided || p.send === false ? 'off' : ''}"><img data-th="${p.id}" alt=""><span class="n">${esc(p.station)} · ${p.n}</span>${p.voided ? '' : `<span class="sel ${p.send !== false ? 'on' : ''}" data-sel="${p.id}">${p.send !== false ? '✓' : ''}</span>`}${p.uploaded_at && !needsUpload(p) ? '<span class="up">☁️</span>' : ''}</div><div class="meta"><b>${esc(p.caption || 'sin leyenda')}</b><span>${dmy(p.time_local.slice(0, 10))} ${p.time_local.slice(11, 16)}${p.voided ? ' · ANULADA' : ''}${(p.qa || []).length ? ' · QA' : ''}</span></div></div>`).join('');
  g.querySelectorAll('.galCard').forEach(el => el.onclick = async e => { const s = e.target.closest('[data-sel]'); if (s) { e.stopPropagation(); await toggleSend(s.dataset.sel); reload(); } else photoDialog(el.dataset.id); });
  g.querySelectorAll('img[data-th]').forEach(async im => { im.src = await thumbUrl(im.dataset.th); });
}
async function toggleSend(id, val) {
  const p = S.d.photos.find(x => x.id === id); if (!p || p.voided) return;
  p.send = val != null ? val : p.send === false; await DB.put('photos', p);
}
function bindFotos() {
  $('#fScope').onchange = renderFotos; $('#fText').oninput = renderFotos;
  $('#selAll').onclick = async () => { for (const p of filteredPhotos()) if (!p.voided && p.send === false) await toggleSend(p.id, true); reload(); };
  $('#selNone').onclick = async () => { for (const p of filteredPhotos()) if (!p.voided && p.send !== false) await toggleSend(p.id, false); reload(); };
  $('#btnSendSel').onclick = () => syncDrive(true);
  $('#btnCopySel').onclick = () => makePackage($('#fScope').value);
}

/* ---------------- mapa ---------------- */
function bindMap() {
  $('#btnFollow').onclick = () => {
    if (!S.map) return;
    if (!S.fix) { toast('Esperando señal GPS del equipo… salga a cielo abierto'); return; }
    S.follow = !S.follow || !S.map.getBounds().contains([S.fix.lat, S.fix.lon]);
    if (S.follow) S.map.setView([S.fix.lat, S.fix.lon], Math.max(S.map.getZoom(), 17));
    $('#btnFollow').classList.toggle('on', S.follow);
  };
  $('#btnPoint').onclick = markPoint;
  $('#btnTrack').onclick = () => S.trk ? Track.stop() : Track.start();
  $('#btnTrkPause').onclick = () => Track.togglePause();
  $('#btnTrkStop').onclick = () => Track.stop();
  $('#kmlIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importLayer(f); };
  $('#tilesIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await importTiles(f); };
  $('#btnLayers').onclick = () => { const p = $('#layerPanel'); p.hidden = !p.hidden; renderLayerPanel(); };
  // botones dentro de los globos del mapa (eliminar punto o track)
  $('#map').addEventListener('click', e => { const b = e.target.closest('[data-delpt],[data-deltr]'); if (b) { e.preventDefault(); b.dataset.delpt ? deletePoint(b.dataset.delpt) : deleteTrack(b.dataset.deltr); } });
}
/* Cuadrícula de fondo: sin señal y sin mapa descargado el mapa no queda en gris, se ven posición, puntos y tracks */
const GridLayer = L.GridLayer.extend({
  createTile(c) {
    const t = document.createElement('canvas'), z = this._tileZoom; t.width = t.height = 256;
    const g = t.getContext('2d'); g.fillStyle = '#eef2ec'; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(31,59,45,0.14)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 0.5); g.lineTo(256, 0.5); g.moveTo(0.5, 0); g.lineTo(0.5, 256); g.stroke();
    if (z >= 15) { g.strokeStyle = 'rgba(31,59,45,0.06)'; g.beginPath(); for (let i = 64; i < 256; i += 64) { g.moveTo(0, i + .5); g.lineTo(256, i + .5); g.moveTo(i + .5, 0); g.lineTo(i + .5, 256); } g.stroke(); }
    return t;
  },
});
async function initMap() {
  if (S.map) { S.map.invalidateSize(); renderMapData(); updateMe(true); return; }
  const m = L.map('map', { zoomControl: true, preferCanvas: true, maxZoom: 21 });
  S.map = m;
  new GridLayer({ maxZoom: 21, zIndex: 0 }).addTo(m);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap', zIndex: 1 });
  const meta = await DB.kv('tiles_meta');
  const offOpt = { maxZoom: 21, maxNativeZoom: meta ? meta.maxZ : 18, minZoom: meta ? Math.max(0, meta.minZ - 1) : 0, attribution: meta ? meta.attr : '', zIndex: 2 };
  if (meta && meta.bounds) offOpt.bounds = L.latLngBounds([meta.bounds.s, meta.bounds.w], [meta.bounds.n, meta.bounds.e]).pad(0.5);
  const off = L.tileLayer('_tiles/{z}/{x}/{y}.png', offOpt);
  osm.addTo(m); if (meta) off.addTo(m);
  S.mapLayers.base = L.control.layers({ 'OpenStreetMap (con señal / lo ya visto)': osm }, { 'Mapa offline importado': off }, { position: 'topright' }).addTo(m);
  L.control.scale({ imperial: false, position: 'topleft' }).addTo(m);
  m.on('dragstart', () => { if (S.follow) { S.follow = false; $('#btnFollow').classList.remove('on'); } });
  S.follow = true; $('#btnFollow').classList.add('on');
  m.setView(S.fix ? [S.fix.lat, S.fix.lon] : [-9.19, -75.02], S.fix ? 17 : 5);
  renderMapData(!S.fix);
  updateMe(true);
}
/* Mi posición: punto azul grande con borde blanco, círculo de precisión y flecha de rumbo; se actualiza con cada lectura del GPS */
function updateMe(center) {
  const m = S.map, fx = S.fix; if (!m || !m._loaded) return;   // el mapa aún no tiene vista: dibujar ahora deja un círculo gigante
  const panel = $('#posPanel');
  if (!fx) { panel.innerHTML = '<b>Buscando señal GPS…</b><br><small>El GPS del equipo funciona sin datos móviles; a cielo abierto tarda menos.</small>'; return; }
  const ll = [fx.lat, fx.lon], h = S.heading != null && Date.now() - S.headingAt < 5000 ? S.heading : null;
  const html = `<div class="me ${fx.acc > S.set.maxAcc ? 'weak' : ''}">${h != null ? `<div class="me-cone" style="transform:rotate(${Math.round(h)}deg)"></div>` : ''}<div class="me-pulse"></div><div class="me-dot"></div></div>`;
  if (!S.me) {
    S.me = {
      acc: L.circle(ll, { radius: fx.acc, color: '#1d4ed8', weight: 1.5, fillColor: '#3b82f6', fillOpacity: 0.12, interactive: false }).addTo(m),
      dot: L.marker(ll, { icon: L.divIcon({ className: 'me-icon', html, iconSize: [64, 64], iconAnchor: [32, 32] }), interactive: false, zIndexOffset: 2000, keyboard: false }).addTo(m),
    };
  } else {
    S.me.acc.setLatLng(ll).setRadius(fx.acc);
    S.me.dot.setLatLng(ll);
    if (S.me.html !== html) S.me.dot.setIcon(L.divIcon({ className: 'me-icon', html, iconSize: [64, 64], iconAnchor: [32, 32] }));
  }
  S.me.html = html;
  if (S.follow && (center || !m.getBounds().pad(-0.25).contains(ll))) m.panTo(ll, { animate: true });
  const u = Geo.toUTM(fx.lat, fx.lon), age = Math.round((Date.now() - fx.got) / 1000);
  panel.innerHTML = `<b class="${fx.acc <= 10 ? 'g' : fx.acc <= S.set.maxAcc ? 'f' : 'p'}">±${Math.round(fx.acc)} m</b> · UTM ${u.zone} <b>${Math.round(u.e)}</b> E <b>${Math.round(u.n)}</b> N${fx.alt != null ? ' · ' + Math.round(fx.alt) + ' msnm' : ''}<br><small>${fx.lat.toFixed(6)}, ${fx.lon.toFixed(6)} · ${age > 5 ? 'hace ' + age + ' s · ' : ''}GPS del equipo${navigator.onLine ? '' : ' · <b>sin datos móviles: funciona igual</b>'}</small>`;
}
function renderMapData(fit) {
  const m = S.map; if (!m) return;
  if (S.mapLayers.data) S.mapLayers.data.remove();
  const g = L.featureGroup().addTo(m); S.mapLayers.data = g;
  const P = S.jor ? S.jor.project : null;
  const done = new Set(S.d.stations.filter(s => !s.voided && (!P || s.project === P)).map(s => s.station));
  for (const l of S.layers) if (l.visible !== false) for (const f of l.features) {
    const st = f.style || {};
    const pop = `<b>${esc(f.name)}</b><br><small>${esc(l.name)}</small>${f.desc ? '<br>' + esc(f.desc) : ''}`;
    if (f.type === 'Point') { const ok = done.has(up(f.name)); L.circleMarker(f.coords[0], { radius: 7, color: ok ? '#1b5e20' : '#1f3b2d', weight: 2, fillColor: ok ? '#2f9e5b' : (st.icon || '#e9c46a'), fillOpacity: 1 }).bindPopup(pop + (ok ? '<br>✓ evaluada' : '<br>pendiente')).bindTooltip(f.name).addTo(g); }
    else if (f.type === 'LineString') L.polyline(f.coords, { color: st.line || '#d17a22', opacity: st.lineA ?? 1, weight: st.width || 3 }).bindPopup(pop).addTo(g);
    else L.polygon([f.coords, ...(f.holes || [])], { color: st.line || '#2d6a4f', weight: st.noOutline ? 0 : (st.width || 2), fillColor: st.fill || st.line || '#2d6a4f', fillOpacity: st.fillA != null ? Math.min(st.fillA, 0.6) : 0.15 }).bindPopup(pop).addTo(g);
  }
  for (const s of S.d.stations.filter(s => !s.voided && s.lat != null && (!P || s.project === P))) {
    const mk = L.circleMarker([s.lat, s.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(g);
    mk.bindTooltip(s.station);
    mk.bindPopup(() => { const d = document.createElement('div'); const ph = photosOf(s.id).filter(p => !p.voided); d.innerHTML = `<b>${esc(s.station)}</b> · ${dmy(s.date)}<br>${esc(s.component)} · ${ph.length} fotos · ${audiosOf(s.id).length} audios${s.notes ? '<br><small>' + esc(s.notes.slice(0, 120)) + '</small>' : ''}<br><img alt="">`; if (ph[0]) thumbUrl(ph[0].id).then(u => d.querySelector('img').src = u); return d; });
  }
  // tracks y puntos marcados
  for (const t of S.d.tracks.filter(t => !t.voided && (!P || t.project === P) && (t.pts || []).length > 1 && (!S.trk || t.id !== S.trk.id))) {
    L.polyline(t.pts.map(q => [q[0], q[1]]), { color: '#d62b2b', weight: 4, opacity: 0.85 }).bindPopup(`<b>${esc(t.name)}</b> · ${Math.round(t.distance_m || 0)} m · ${Math.round((t.duration_s || 0) / 60)} min<br><small>${esc(t.specialist)} · ${esc((t.started_local || '').replace('T', ' ').slice(0, 16))}${t.notes ? '<br>' + esc(t.notes) : ''}</small><br><button class="sm danger" data-deltr="${t.id}">Eliminar track</button>`).addTo(g);
  }
  for (const t of S.d.points.filter(t => !t.voided && (!P || t.project === P))) {
    L.circleMarker([t.lat, t.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#f0781f', fillOpacity: 1 }).bindTooltip(t.name).bindPopup(`<b>${esc(t.name)}</b> · ±${Math.round(t.accuracy || 0)} m<br><small>${t.utm_zone ? `${t.utm_zone} ${Math.round(t.utm_e)} E / ${Math.round(t.utm_n)} N<br>` : ''}${esc((t.time_local || '').replace('T', ' ').slice(0, 16))}${t.notes ? '<br>' + esc(t.notes) : ''}</small><br><button class="sm danger" data-delpt="${t.id}">Eliminar punto</button>`).addTo(g);
  }
  if (S.trk) { S.trkLine = L.polyline(S.trk.pts.map(q => [q[0], q[1]]), { color: '#d62b2b', weight: 5, dashArray: S.trk.status === 'paused' ? '6 8' : null }).addTo(g); }
  if (fit && g.getLayers().length) { try { m.fitBounds(g.getBounds().pad(0.2), { maxZoom: 16 }); } catch (_) {} }
}

/* ---------------- puntos marcados (promedio de lecturas GPS) ---------------- */
const fixListeners = new Set();
function needJornada() {
  if (S.jor) return true;
  ask('<p>Para marcar puntos o grabar tracks primero inicie una <b>jornada</b> (proyecto, campaña y evaluador): así quedan en sus productos y en Drive.</p>', [['Ir a Campo', true]]).then(() => showView('campo'));
  return false;
}
async function markPoint() {
  if (!needJornada()) return;
  if (!S.fix) { toast('Esperando señal GPS del equipo… salga a cielo abierto'); return; }
  // se promedian las lecturas de hasta 10 s (o 8 lecturas) ponderadas por precisión
  const fixes = [S.fix];
  busy(true, 'Promediando GPS… quédese quieto');
  await new Promise(res => {
    const t0 = Date.now();
    const f = fx => { fixes.push(fx); $('#busyText').textContent = `Promediando GPS… ${fixes.length} lecturas · ±${Math.round(Math.min(...fixes.map(x => x.acc)))} m`; if (fixes.length >= 8) done(); };
    const done = () => { fixListeners.delete(f); clearTimeout(tm); res(); };
    const tm = setTimeout(done, Math.max(2500, 10000 - (Date.now() - t0)));
    fixListeners.add(f);
  });
  busy(false);
  const good = fixes.filter(x => x.acc <= Math.max(S.set.maxAcc, Math.min(...fixes.map(y => y.acc)) * 2));
  const w = good.map(x => 1 / Math.max(1, x.acc) ** 2), W = w.reduce((a, b) => a + b, 0);
  const lat = good.reduce((a, x, i) => a + x.lat * w[i], 0) / W, lon = good.reduce((a, x, i) => a + x.lon * w[i], 0) / W;
  const alts = good.filter(x => x.alt != null).map(x => x.alt), acc = Math.min(...good.map(x => x.acc)) / Math.sqrt(Math.min(good.length, 4));
  const n = S.d.points.filter(t => t.jornada_id === S.jor.id).length + 1, def = `P-${String(n).padStart(3, '0')}`;
  const u = Geo.toUTM(lat, lon);
  const ok = await ask(`<h3>📍 Marcar punto</h3><p class="hint">${good.length} lecturas · ±${Math.round(acc)} m · UTM ${u.zone} ${Math.round(u.e)} E ${Math.round(u.n)} N</p><label>Nombre<input id="ptName" value="${def}" autocapitalize="characters"></label><label>Nota<textarea id="ptNote" rows="2" placeholder="ej. Nido, cruce de quebrada, acceso"></textarea></label>`, [['Cancelar', false], ['Guardar punto', true]]);
  const name = up(($('#ptName') || {}).value || def) || def, notes = (($('#ptNote') || {}).value || '').trim();
  if (!ok) return;
  const now = new Date(), j = S.jor;
  const t = { id: uid(), jornada_id: j.id, project: j.project, campaign: j.campaign, component: j.component, specialist: j.specialist, person: j.person, date: j.date, name, notes,
    lat, lon, alt: alts.length ? alts.reduce((a, b) => a + b, 0) / alts.length : null, accuracy: Math.round(acc * 10) / 10, n_fixes: good.length,
    utm_zone: u.zone, utm_e: u.e, utm_n: u.n, time_local: localIso(now), time_utc: now.toISOString(), created_at: now.toISOString(), app_version: APP_VERSION };
  await DB.put('points', t); S.d.points.push(t);
  renderMapData(); toast(`Punto ${name} guardado ✓`);
  clearTimeout(markPoint._t); markPoint._t = setTimeout(autoSync, 8000);
}
async function deletePoint(id) {
  const t = S.d.points.find(x => x.id === id); if (!t) return;
  if (!(await ask(`<p>¿Eliminar el punto <b>${esc(t.name)}</b>? No se puede deshacer.</p>`, [['Cancelar', false], ['Eliminar', true, 'danger']]))) return;
  await DB.del('points', id); S.d.points = S.d.points.filter(x => x.id !== id);
  await touchJornada(t.jornada_id); S.map && S.map.closePopup(); renderMapData(); toast('Punto eliminado');
}
async function deleteTrack(id) {
  const t = S.d.tracks.find(x => x.id === id); if (!t) return;
  if (!(await ask(`<p>¿Eliminar el track <b>${esc(t.name)}</b> (${Math.round(t.distance_m || 0)} m)? No se puede deshacer.</p>`, [['Cancelar', false], ['Eliminar', true, 'danger']]))) return;
  await DB.del('tracks', id); S.d.tracks = S.d.tracks.filter(x => x.id !== id);
  await touchJornada(t.jornada_id); S.map && S.map.closePopup(); renderMapData(); toast('Track eliminado');
}
/* marca la jornada como modificada para regenerar sus productos en el próximo envío */
async function touchJornada(jid) { const j = S.d.jornadas.find(x => x.id === jid); if (j) { j.edited_at = new Date().toISOString(); await DB.put('jornadas', j); } }

/* ---------------- track: recorrido con el GPS del equipo ----------------
   Graba mientras la app está abierta (se mantiene la pantalla encendida). Cada punto se guarda en el teléfono:
   si la app se cierra, al abrirla el track continúa. */
const Track = {
  async start() {
    if (!needJornada()) return;
    const j = S.jor, n = S.d.tracks.filter(t => t.jornada_id === j.id).length + 1, now = new Date();
    S.trk = { id: uid(), jornada_id: j.id, project: j.project, campaign: j.campaign, component: j.component, specialist: j.specialist, person: j.person, date: j.date,
      name: `T-${String(n).padStart(2, '0')}`, notes: '', status: 'rec', pts: [], distance_m: 0, duration_s: 0, paused_ms: 0,
      started_at: now.toISOString(), started_local: localIso(now), time_utc: now.toISOString(), created_at: now.toISOString(), app_version: APP_VERSION };
    await DB.put('tracks', S.trk); S.d.tracks.push(S.trk);
    this.wake(); this.ui(); renderMapData();
    toast('⏺ Grabando track: mantenga la app abierta (la pantalla no se apagará)', 5000);
    if (S.fix) this.onFix(S.fix);
  },
  async resume() {
    const t = (await DB.all('tracks')).find(x => x.status === 'rec' || x.status === 'paused');
    if (!t) return;
    S.trk = S.d.tracks.find(x => x.id === t.id) || t; S.trk.gap = true;
    this.wake(); this.ui();
    toast(`⏺ El track ${t.name} sigue ${t.status === 'rec' ? 'grabando' : 'en pausa'}`, 4000);
  },
  onFix(fx) {
    const t = S.trk; if (!t || t.status !== 'rec' || fx.acc > Math.max(30, S.set.maxAcc)) return;
    const last = t.pts[t.pts.length - 1];
    const d = last ? Geo.dist(last[0], last[1], fx.lat, fx.lon) : Infinity;
    if (last && d < Math.max(4, fx.acc * 0.6)) { this.ui(); return; }          // filtra el "baile" del GPS estando quieto
    if (last && !t.gap) t.distance_m += d;
    t.gap = false;
    t.pts.push([+fx.lat.toFixed(7), +fx.lon.toFixed(7), fx.alt != null ? Math.round(fx.alt * 10) / 10 : null, Math.round(fx.acc), fx.ts || Date.now()]);
    if (S.trkLine) S.trkLine.addLatLng([fx.lat, fx.lon]);
    this.ui();
    if (!this._sv || Date.now() - this._sv > 8000) { this._sv = Date.now(); this.save(); }
  },
  async save() { const t = S.trk; if (!t) return; t.duration_s = Math.round((Date.now() - Date.parse(t.started_at) - (t.paused_ms || 0) - (t.status === 'paused' ? Date.now() - t.paused_at : 0)) / 1000); const { gap, ...c } = t; await DB.put('tracks', c); },
  async togglePause() {
    const t = S.trk; if (!t) return;
    if (t.status === 'rec') { t.status = 'paused'; t.paused_at = Date.now(); this.release(); }
    else { t.paused_ms = (t.paused_ms || 0) + (Date.now() - (t.paused_at || Date.now())); t.status = 'rec'; t.gap = true; this.wake(); }
    await this.save(); this.ui(); renderMapData();
  },
  async stop() {
    const t = S.trk; if (!t) return;
    if (t.status === 'paused') { t.paused_ms = (t.paused_ms || 0) + (Date.now() - t.paused_at); t.status = 'rec'; }
    await this.save();
    const v = await ask(`<h3>Terminar track</h3><p>${t.pts.length} puntos · ${Math.round(t.distance_m)} m · ${fmtDur(t.duration_s)}</p><label>Nombre<input id="trName" value="${esc(t.name)}" autocapitalize="characters"></label><label>Nota<textarea id="trNote" rows="2" placeholder="ej. Transecto de flora, acceso a E-05">${esc(t.notes)}</textarea></label>`,
      [['Seguir grabando', false], ['Descartar', 'discard', 'danger'], ['Guardar track', true]]);
    if (!v) return;
    if (v === 'discard') {
      if (!(await ask('<p>¿Descartar este track? Se borra del teléfono.</p>', [['No', false], ['Descartar', true, 'danger']]))) return;
      await DB.del('tracks', t.id); S.d.tracks = S.d.tracks.filter(x => x.id !== t.id);
    } else {
      t.name = up(($('#trName') || {}).value || t.name) || t.name; t.notes = (($('#trNote') || {}).value || '').trim();
      const now = new Date(); t.status = 'done'; t.ended_at = now.toISOString(); t.ended_local = localIso(now); t.saved_at = now.toISOString();
      await this.save();
      toast(`Track ${t.name} guardado ✓ · ${Math.round(t.distance_m)} m`);
      clearTimeout(this._as); this._as = setTimeout(autoSync, 8000);
    }
    S.trk = null; S.trkLine = null; this.release(); this.ui(); renderMapData();
  },
  async wake() { try { if ('wakeLock' in navigator && document.visibilityState === 'visible' && S.trk && S.trk.status === 'rec') { S.wakeLock = await navigator.wakeLock.request('screen'); } } catch (_) {} },
  release() { try { S.wakeLock && S.wakeLock.release(); } catch (_) {} S.wakeLock = null; },
  ui() {
    const t = S.trk, p = $('#trkPanel'), b = $('#btnTrack');
    b.classList.toggle('rec', !!t); b.textContent = t ? '■' : '⏺'; b.title = t ? 'Terminar track' : 'Grabar track';
    p.hidden = !t; if (!t) return;
    const dur = Math.round((Date.now() - Date.parse(t.started_at) - (t.paused_ms || 0) - (t.status === 'paused' ? Date.now() - t.paused_at : 0)) / 1000);
    $('#trkInfo').innerHTML = `${t.status === 'rec' ? '<span class="recdot"></span>' : '⏸'} <b>${esc(t.name)}</b> · ${t.distance_m >= 1000 ? (t.distance_m / 1000).toFixed(2) + ' km' : Math.round(t.distance_m) + ' m'} · ${fmtDur(dur)} · ${t.pts.length} pts`;
    $('#btnTrkPause').textContent = t.status === 'rec' ? 'Pausa' : 'Seguir';
  },
};
setInterval(() => { if (S.trk) Track.ui(); }, 1000);

async function importLayer(file) {
  const last = (await DB.kv('lastJor', {})) || {};
  const P = S.jor ? S.jor.project : up(last.project);
  busy(true, 'Leyendo capa…');
  try {
    const feats = await Geo.readKmlFile(file);
    const name = file.name.replace(/\.(kmz|kml)$/i, '');
    await DB.put('layers', { key: `${P || 'GENERAL'}::${name}`, project: P || 'GENERAL', name, features: feats, visible: true, imported_at: new Date().toISOString() });
    if (!P) S.allLayers = true;
    await reload(); renderMapData(true);
    const c = t => feats.filter(f => f.type === t).length;
    toast(`Capa "${name}" guardada en el teléfono: ${c('Point')} puntos, ${c('LineString')} líneas, ${c('Polygon')} polígonos`, 5000);
  } catch (e) { toast('Capa: ' + e.message, 6000); }
  finally { busy(false); }
}
async function renderLayerPanel() {
  const p = $('#layerPanel');
  const P = S.jor ? S.jor.project : '—';
  p.innerHTML = `<b>Capas guardadas</b><label class="check"><input type="checkbox" id="allLy" ${S.allLayers ? 'checked' : ''}> Ver capas de todos los proyectos</label>` + (S.layers.length ? S.layers.map(l => `<label class="check"><input type="checkbox" data-k="${esc(l.key)}" ${l.visible !== false ? 'checked' : ''}> ${esc(l.name)} <small>(${l.features.length} · ${esc(l.project)})</small> <button type="button" class="sm ghost" data-del="${esc(l.key)}">Quitar</button></label>`).join('') : `<p class="hint">Sin capas para ${esc(P)}. Importe un KMZ/KML: queda guardado en el teléfono.</p>`)
    + `<p class="hint" id="tilesInfo"></p>`;
  DB.kv('tiles_meta').then(m => { const t = $('#tilesInfo'); if (t) t.textContent = m ? `Mapa offline: ${m.count} teselas, zoom ${m.minZ}–${m.maxZ}. ${m.attr || ''}` : 'Sin mapa offline importado.'; });
  $('#allLy').onchange = async e => { S.allLayers = e.target.checked; await DB.setKv('allLayers', S.allLayers); await reload(); renderLayerPanel(); };
  p.querySelectorAll('input[data-k]').forEach(i => i.onchange = async () => { const l = S.layers.find(x => x.key === i.dataset.k); l.visible = i.checked; await DB.put('layers', l); renderMapData(); });
  p.querySelectorAll('button[data-del]').forEach(b => b.onclick = async e => { e.preventDefault(); if (await ask('<p>¿Quitar esta capa del teléfono?</p>', [['No', false], ['Quitar', true]])) { await DB.del('layers', b.dataset.del); await reload(); renderLayerPanel(); } });
}
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
      await cache.put(new URL(`_tiles/${z}/${x}/${y}.png`, location.href).href, new Response(await f.async('blob'), { headers: { 'Content-Type': type } }));
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

/* ---------------- productos ---------------- */
async function galleryImage(p) {
  const b = await DB.get('blobs', p.id); if (!b || !b.stamped) return null;
  const blob = await Photo.thumb(b.stamped, 1400, 0.8);
  const im = await Photo.loadImg(blob);
  return { blob, w: im.naturalWidth, h: im.naturalHeight };
}
const kmzThumb = async p => (await DB.get('blobs', p.id) || {}).thumb;
async function productsOf(j, progress) {
  const d = dataOfJor(j), base = jorBase(j), out = [];
  progress && progress('Matriz Excel…');
  out.push([`${base}_MATRIZ.xlsx`, await Exports.matrix(d)]);
  progress && progress('KMZ de fotos…');
  out.push([`${base}_FOTOS.kmz`, await Exports.kmz(d, kmzThumb, `${j.project} ${j.campaign} · ${j.specialist} · ${dmy(j.date)}`)]);
  if (d.photos.some(p => !p.voided && p.send !== false)) {
    out.push([`${base}_GALERIA.docx`, await Exports.gallery(d, galleryImage, { title: 'Galería fotográfica', subtitle: `${j.project} · ${j.campaign} · ${j.component} · ${j.person || j.specialist} · ${dmy(j.date)}`, header: `${j.project} · ${j.campaign} — Galería fotográfica` }, (i, n) => progress && progress(`Galería Word ${i}/${n}…`))]);
  }
  const g = Exports.gpx(d, `${j.project} ${j.campaign} · ${j.specialist} · ${dmy(j.date)}`);
  if (g) out.push([`${base}_PUNTOS_TRACKS.gpx`, g]);
  out.push([`datos_${base}.json`, new Blob([JSON.stringify({ schema: 'albafield/2', app: APP_VERSION, generated_utc: new Date().toISOString(), ...d }, null, 1)], { type: 'application/json' })]);
  return out;
}
function jornadasInScope(scope) {
  const j = S.jor;
  if (scope === 'jor') return j ? [j] : [];
  if (scope === 'camp') return j ? S.d.jornadas.filter(x => x.project === j.project && x.campaign === j.campaign) : [];
  if (scope === 'pend') { const ids = new Set([...S.d.photos.filter(needsUpload), ...S.d.audios.filter(needsUpload)].map(x => x.jornada_id)); return S.d.jornadas.filter(x => ids.has(x.id)); }
  return [...S.d.jornadas];
}
function renderSendInfo() {
  const js = jornadasInScope($('#pkScope').value);
  if (!js.length) { $('#pkInfo').textContent = S.jor ? 'No hay datos en este alcance.' : 'Sin jornada activa: elija "Todo lo del teléfono".'; return; }
  const ids = new Set(js.map(j => j.id));
  const ph = S.d.photos.filter(p => ids.has(p.jornada_id) && !p.voided && p.send !== false), au = S.d.audios.filter(a => ids.has(a.jornada_id) && !a.voided);
  const st = S.d.stations.filter(s => ids.has(s.jornada_id) && !s.voided);
  $('#pkInfo').textContent = `${js.length} jornada(s) · ${st.length} estaciones · ${ph.length} fotos seleccionadas · ${au.length} audios`;
}
async function makePackage(scope) {
  const js = jornadasInScope(scope);
  if (!js.length) { toast('No hay jornadas en este alcance'); return; }
  busy(true, 'Preparando copia…');
  try {
    const groups = js.map(j => { const d = dataOfJor(j); return { j, path: jorPath(j), data: { ...d, photos: d.photos.filter(p => !p.voided && p.send !== false), audios: d.audios.filter(a => !a.voided) } }; });
    const blob = await Exports.pack(groups, {
      getPhoto: p => DB.get('blobs', p.id), getAudio: a => DB.get('blobs', a.id), includeOriginals: $('#pkOrig').checked, app: APP_VERSION,
      products: g => productsOf(g.j, t => $('#busyText').textContent = `${g.j.date} · ${t}`),
      progress: (i, n) => $('#busyText').textContent = `Copiando archivos ${i}/${n}…`,
    });
    busy(false);
    const name = `AlbaField_${js.length === 1 ? jorBase(js[0]) : (S.jor ? S.jor.project : 'TODO')}_${Exports.stampNow()}.zip`;
    const how = await shareOrDownload(blob, name, 'Alba Field ' + name);
    if (how === 'downloaded') toast(`Copia guardada en Descargas: ${name} (${fmtMB(blob.size)})`, 6000);
  } catch (e) { busy(false); toast('Copia: ' + e.message, 7000); }
}
async function singleProduct(kind) {
  const js = jornadasInScope($('#pkScope').value);
  if (!js.length) { toast('No hay jornadas en este alcance'); return; }
  busy(true, 'Generando…');
  try {
    const ids = new Set(js.map(j => j.id));
    const d = { jornadas: js };
    for (const k of ['stations', 'photos', 'audios']) d[k] = S.d[k].filter(x => ids.has(x.jornada_id));
    const base = js.length === 1 ? jorBase(js[0]) : `${js[0].project}_${Exports.stampNow()}`;
    let blob, name;
    if (kind === 'xlsx') { blob = await Exports.matrix(d); name = `${base}_MATRIZ.xlsx`; }
    if (kind === 'kmz') { blob = await Exports.kmz(d, kmzThumb, base); name = `${base}_FOTOS.kmz`; }
    if (kind === 'docx') { const j = js[0]; blob = await Exports.gallery(d, galleryImage, { title: 'Galería fotográfica', subtitle: `${j.project} · ${j.campaign}${js.length === 1 ? ' · ' + j.component + ' · ' + (j.person || j.specialist) + ' · ' + dmy(j.date) : ''}`, header: `${j.project} · ${j.campaign} — Galería fotográfica` }, (i, n) => $('#busyText').textContent = `Galería ${i}/${n}…`); name = `${base}_GALERIA.docx`; }
    busy(false); await shareOrDownload(blob, name, name);
  } catch (e) { busy(false); toast(e.message, 6000); }
}

/* ---------------- Google Drive ---------------- */
async function renderConsLinks() {
  const urls = (await DB.kv('cons_urls', {})) || {};
  const ks = Object.keys(urls).sort();
  $('#consLinks').innerHTML = ks.length ? '<b>Consolidados del equipo (Google Sheets)</b>' + ks.map(k => `<a class="linkrow" href="${esc(urls[k])}" target="_blank" rel="noopener">📊 ${esc(k)}</a>`).join('') : '';
}
async function renderDriveState() {
  renderConsLinks();
  const c = await Drive.cfg();
  $('#drAuto').checked = !!S.set.drAuto; $('#drCopy').checked = !!S.set.drCopy;
  const n = S.d.photos.filter(needsUpload).length, na = S.d.audios.filter(needsUpload).length;
  const ver = await DB.kv('drive_ver'), last = await DB.kv('sync_last');
  $('#drState').innerHTML = !Drive.ready(c) ? 'No configurado. Ver Ajustes → Google Drive.'
    : `Configurado ✓${c.rootName ? ' · carpeta: ' + esc(c.rootName) : ''} · <b>${n} fotos y ${na} audios por enviar</b>`
      + (last ? `<br>Último intento: ${new Date(last.at).toLocaleString()} · ${last.ok} enviados${last.failed ? ', ' + last.failed + ' con error' : ''}${last.aborted ? ' · ' + esc(last.aborted) : ''}` : '');
  // aviso fijo si el receptor está desactualizado (la app sigue enviando igual)
  const v = ver ? ver.v : null;
  $('#verWarn').hidden = !(Drive.ready(c) && v && v < 4);
  if (v && v < 4) $('#verWarn').innerHTML = `<b>Receptor de Drive versión ${v}.</b> Las fotos se envían igual, pero sin envío por partes (las fotos pesadas fallan con señal débil)${v < 3 ? ', sin configuración del equipo y sin consolidado' : ''}. <a href="guia.html#drive" target="_blank">Actualícelo a la versión 4</a> (5 minutos, la URL no cambia).`;
  renderPendList();
}
/* Lista de pendientes con su estado: el usuario ve qué falta y por qué */
function renderPendList() {
  const items = [...S.d.photos.filter(needsUpload).map(x => [x.photo_name + '.jpg', x]), ...S.d.audios.filter(needsUpload).map(x => [x.file_name, x])]
    .sort((a, b) => (b[1].fail_count || 0) - (a[1].fail_count || 0) || (a[1].time_utc || '').localeCompare(b[1].time_utc || ''));
  const el = $('#pendList');
  if (!items.length) { el.innerHTML = ''; $('#btnRetry').hidden = true; return; }
  $('#btnRetry').hidden = false;
  const now = Date.now();
  el.innerHTML = `<b>Pendientes (${items.length})</b>` + items.slice(0, 40).map(([name, x]) => {
    const st = x.sync_error ? (ts(x.next_try_at) > now ? `reintento ${new Date(x.next_try_at).toLocaleTimeString().slice(0, 5)}` : 'reintento al próximo envío') : (x.uploaded_at ? 'editado: se reenviará' : 'en cola');
    return `<div class="pend ${x.sync_error ? 'err' : ''}"><span>${esc(name)}</span><small>${st}${x.sync_error ? ' · ' + esc(x.sync_error) : ''}</small></div>`;
  }).join('') + (items.length > 40 ? `<small>… y ${items.length - 40} más</small>` : '');
}
function drLog(t) { const l = $('#drLog'); l.textContent = `${new Date().toLocaleTimeString()} ${t}\n` + l.textContent.slice(0, 3000); }
/* Envío automático: al abrir la app, al volver la señal, al volver a la app y cada 2 min mientras haya pendientes */
async function autoSync() {
  if (!S.set.drAuto || !navigator.onLine || S.syncing || S.stream || S.rec) return;
  try {
    if (!Drive.ready(await Drive.cfg())) return;
    const pend = S.d.photos.some(needsUpload) || S.d.audios.some(needsUpload) || S.d.jornadas.some(jornadaDirty);
    if (pend) await syncDrive(false);
  } catch (_) {}
}
/* Pide al navegador que envíe en segundo plano cuando haya señal (Android/Chrome; en iPhone se envía al abrir la app) */
function requestBgSync() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready.then(r => r.sync && r.sync.register('albafield-media')).catch(() => {});
}
function jornadaDirty(j) {
  const t = ts(j.products_at);
  const kids = [...S.d.stations.filter(s => s.jornada_id === j.id), ...S.d.photos.filter(p => p.jornada_id === j.id), ...S.d.audios.filter(a => a.jornada_id === j.id),
    ...S.d.points.filter(x => x.jornada_id === j.id), ...S.d.tracks.filter(x => x.jornada_id === j.id && x.status !== 'rec')];
  return (kids.length && kids.some(x => Math.max(ts(x.created_at), ts(x.edited_at), ts(x.saved_at)) > t)) || ts(j.edited_at) > t;
}
const mediaPending = j => S.d.photos.some(p => p.jornada_id === j.id && needsUpload(p)) || S.d.audios.some(a => a.jornada_id === j.id && needsUpload(a));
async function syncDrive(manual) {
  if (S.syncing) return; const c = await Drive.cfg();
  if (!Drive.ready(c)) { if (manual) { showView('ajustes'); toast('Configure Google Drive en Ajustes'); } return; }
  if (!navigator.onLine) { if (manual) toast('Sin señal: se enviará solo cuando vuelva la conexión'); requestBgSync(); return; }
  if (S.stPersisted && manual) { const before = stampSig(S.st) + '|' + S.st.notes; readStationForm(); if (before !== stampSig(S.st) + '|' + S.st.notes) await saveStationDraft(); }
  S.syncing = true; $('#syncDot').hidden = false;
  if (manual) busy(true, 'Conectando con Google Drive…');
  const step = t => { if (manual) $('#busyText').textContent = t; };
  let res = { ok: 0, failed: 0, touched: [] }, prodOk = 0, prodFail = 0;
  try {
    // 1) fotos y audios (motor compartido con el segundo plano)
    res = await Sync.run({ manual, log: drLog, onStep: (i, n, name) => step(`Enviando ${i}/${n} · ${name}`) });
    if (res.busy) { if (manual) toast('Ya se está enviando en segundo plano; espere unos segundos'); return; }
    await loadAll();
    // 2) productos y consolidado: por jornada, cuando ya no le faltan archivos (o si lo pide el usuario)
    if (!res.aborted || res.kind === 'net' && res.ok) {
      const ver = res.ver || 2;
      for (const j of S.d.jornadas.filter(j => (res.touched.includes(j.id) || jornadaDirty(j)) && (manual || !mediaPending(j)))) {
        if (!navigator.onLine) break;
        try {
          const prods = await productsOf(j, t => step(`${j.date} · ${t}`));
          for (const [n, blob] of prods) { step(`Subiendo ${n}…`); await Drive.upload([...jorPath(j), 'PRODUCTOS'], n, blob, { ver, onPart: (k, t) => step(`Subiendo ${n} · parte ${k}/${t}`) }); }
          if (ver >= 3) {
            step(`Consolidando ${j.project}/${j.campaign} en Google Sheets…`);
            try {
              const r = await Drive.consolidate(j.project, j.campaign, Exports.tables(dataOfJor(j)));
              const urls = (await DB.kv('cons_urls', {})) || {}; if (r.url) urls[`${j.project}/${j.campaign}`] = r.url; await DB.setKv('cons_urls', urls);
              drLog(`✓ Consolidado ${j.project}/${j.campaign}: ${r.nuevos || 0} nuevos, ${r.actualizados || 0} actualizados`);
            } catch (e) { drLog(`⚠ Consolidado ${j.project}/${j.campaign}: ${e.message}`); }
          }
          const fresh = (await DB.get('jornadas', j.id)) || j;
          fresh.products_at = new Date().toISOString(); await DB.put('jornadas', fresh);
          prodOk++; drLog(`✓ Productos de ${j.date} actualizados`);
        } catch (e) { prodFail++; drLog(`✗ Productos ${j.date}: ${e.message}`); if (e.kind === 'auth') break; }
      }
    }
    const left = S.d.photos.filter(needsUpload).length + S.d.audios.filter(needsUpload).length;
    await DB.setKv('sync_last', { at: new Date().toISOString(), ok: res.ok, failed: res.failed + prodFail, left, aborted: res.aborted || null });
    drLog(`Envío: ${res.ok} archivos${prodOk ? ' + productos de ' + prodOk + ' jornada(s)' : ''}${res.failed ? ', ' + res.failed + ' con error' : ''}${left ? ' · quedan ' + left : ''}`);
    if (left) requestBgSync();
    if (manual) {
      if (res.kind === 'auth') toast('Drive: ' + res.aborted + ' · revise Ajustes → Google Drive o use Diagnóstico', 9000);
      else if (left) toast(`Enviados ${res.ok}. Quedan ${left}: se reintentan solos${res.aborted ? ' (' + res.aborted + ')' : ''}`, 7000);
      else toast(res.ok || prodOk ? `Drive al día ✓ · ${res.ok} archivos enviados` : 'Todo está al día en Drive ✓', 5000);
    }
  } catch (e) { drLog('✗ ' + e.message); if (manual) toast('Drive: ' + e.message, 7000); }
  finally { S.syncing = false; $('#syncDot').hidden = true; busy(false); await loadAll(); await reload(); }
  if (manual && S.set.drCopy && res.touched && res.touched.length) {
    const cur = S.jor;
    for (const j of S.d.jornadas.filter(j => res.touched.includes(j.id))) { S.jor = j; await makePackage('jor'); }
    S.jor = cur;
  }
}

/* ---------------- diagnóstico de envío: un informe que se puede copiar y enviar ---------------- */
async function runDiagnostics() {
  const L = [], add = (ok, t) => L.push(`${ok === true ? '✅' : ok === false ? '❌' : 'ℹ️'} ${t}`);
  busy(true, 'Diagnosticando el envío…');
  try {
    add(null, `Alba Field ${APP_VERSION} · ${navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+/)?.[0] || ''}`);
    add(navigator.onLine, navigator.onLine ? 'El teléfono indica que hay conexión' : 'Sin conexión de datos (el GPS y la captura funcionan igual)');
    const c = await Drive.cfg();
    add(!!c.url, c.url ? 'URL del receptor cargada' : 'Falta la URL del receptor');
    add(!!Drive.folderId(c.folder), Drive.folderId(c.folder) ? 'Enlace de carpeta válido' : 'Falta o no es válido el enlace de la carpeta');
    add(!!c.token, c.token ? 'Clave cargada' : 'Falta la clave');
    let ver = null;
    if (Drive.ready(c) && navigator.onLine) {
      const t0 = performance.now();
      try { const r = await Drive.ping(); ver = r.version || 2; add(true, `Receptor responde en ${Math.round(performance.now() - t0)} ms · carpeta "${r.root}" · versión ${ver}${ver < 4 ? ' (recomendado: 4)' : ''}`); }
      catch (e) { add(false, `Receptor: ${e.message}`); }
      if (ver) {
        try {
          const test = new Blob([new Uint8Array(200 * 1024).map((_, i) => i % 251)], { type: 'application/octet-stream' });
          const t1 = performance.now();
          await Drive.upload(['_DIAGNOSTICO'], `prueba_${(await DB.kv('lastJor', {}) || {}).specialist || 'ALBA'}.bin`, test, { ver: 2 });
          const s = (performance.now() - t1) / 1000, kbps = Math.round(200 / s);
          add(true, `Prueba de envío de 200 KB: ${s.toFixed(1)} s (~${kbps} KB/s)${kbps < 30 ? ' · señal débil: las fotos pesadas tardarán' : ''}`);
        } catch (e) { add(false, `Prueba de envío: ${e.message}`); }
      }
    }
    const pend = [...S.d.photos.filter(needsUpload), ...S.d.audios.filter(needsUpload)];
    const sizes = await Promise.all(pend.slice(0, 60).map(async x => { const b = await DB.get('blobs', x.id); const bl = b && (b.stamped || b.audio); return bl ? bl.size : 0; }));
    add(pend.length ? null : true, `${pend.length} archivos pendientes${pend.length ? ` · ${fmtMB(sizes.reduce((a, b) => a + b, 0))} · el más pesado ${fmtMB(Math.max(0, ...sizes))}` : ''}`);
    const errs = [...new Set(pend.map(x => x.sync_error).filter(Boolean))];
    errs.slice(0, 4).forEach(e => add(false, `Error registrado: ${e}`));
    add('serviceWorker' in navigator && !!navigator.serviceWorker.controller, navigator.serviceWorker && navigator.serviceWorker.controller ? 'Funciona sin señal (app guardada en el teléfono)' : 'La app aún no está guardada para uso sin señal: ábrala una vez con señal');
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    add(null, reg && 'sync' in reg ? 'Envío en segundo plano disponible (Android/Chrome)' : 'Sin envío en segundo plano en este navegador: se envía al abrir la app');
    add(null, `Envío automático: ${S.set.drAuto ? 'activado' : 'DESACTIVADO (actívelo en Entregar)'}`);
    if (navigator.storage && navigator.storage.estimate) { const e = await navigator.storage.estimate(); add(null, `Espacio usado ${fmtMB(e.usage || 0)} de ${fmtMB(e.quota || 0)}`); }
  } finally { busy(false); }
  const txt = L.join('\n');
  const v = await ask(`<h3>Diagnóstico de envío</h3><pre class="diag">${esc(txt)}</pre>`, [['Cerrar', false], ['Copiar informe', 'copy', 'primary']]);
  if (v === 'copy') { try { await navigator.clipboard.writeText(txt); toast('Informe copiado: péguelo en WhatsApp o correo'); } catch (_) { prompt('Copie el informe:', txt); } }
  renderDriveState();
}

/* ---------------- entrega: botones, consolidación, restauración ---------------- */
function bindSend() {
  $('#pkScope').onchange = renderSendInfo;
  $('#btnPack').onclick = () => makePackage($('#pkScope').value);
  $('#btnXlsx').onclick = () => singleProduct('xlsx');
  $('#btnKmz').onclick = () => singleProduct('kmz');
  $('#btnDocx').onclick = () => singleProduct('docx');
  $('#btnDrive').onclick = () => syncDrive(true);
  $('#btnDiag').onclick = runDiagnostics;
  $('#btnRetry').onclick = async () => {
    for (const st of ['photos', 'audios']) for (const x of await DB.all(st)) if (x.next_try_at) { x.next_try_at = null; await DB.put(st, x); }
    await loadAll(); syncDrive(true);
  };
  $('#pendBadge').onclick = () => showView('enviar');
  $('#drAuto').onchange = async e => { S.set.drAuto = e.target.checked; await DB.setKv('settings', S.set); if (S.set.drAuto) autoSync(); };
  $('#drCopy').onchange = async e => { S.set.drCopy = e.target.checked; await DB.setKv('settings', S.set); };
  $('#consIn').onchange = async e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) await consolidate(fs); };
  $('#restoreIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await restore(f); };
}
async function consolidate(files) {
  const log = t => { $('#consLog').textContent += t + '\n'; };
  $('#consLog').textContent = ''; busy(true, 'Consolidando…');
  try {
    const r = await Exports.consolidate(files, log, uid);
    busy(false);
    log(`Total: ${r.stations} estaciones, ${r.photos} fotos · evaluadores: ${r.esps.join(', ')}${r.conflicts ? ' · conflictos: ' + r.conflicts : ''}`);
    await shareOrDownload(r.blob, r.name, 'Alba Field GENERAL');
  } catch (e) { busy(false); log('✗ ' + e.message); }
}
async function restore(file) {
  busy(true, 'Leyendo respaldo…'); let added = 0, skipped = 0;
  try {
    const zip = await JSZip.loadAsync(file);
    const j = zip.file('datos.json'); if (!j) throw new Error('No es un paquete de Alba Field (falta datos.json)');
    let data = JSON.parse(await j.async('string'));
    if (Array.isArray(data.records)) data = Exports.migrateV1(data.records, uid);
    const byBase = new Map(Object.values(zip.files).filter(f => !f.dir).map(f => [f.name.split('/').pop(), f]));
    for (const k of ['jornadas', 'stations', 'points', 'tracks']) for (const o of data[k] || []) if (!(await DB.get(k, o.id))) { await DB.put(k, o); added++; } else skipped++;
    for (const [i, p] of (data.photos || []).entries()) {
      $('#busyText').textContent = `Restaurando fotos ${i + 1}/${data.photos.length}`;
      if (await DB.get('photos', p.id)) { skipped++; continue; }
      const st = byBase.get(p.photo_name + '.jpg'), og = byBase.get(p.photo_name + '_original.jpg');
      if (!st) { skipped++; continue; }
      const stamped = new Blob([await st.async('uint8array')], { type: 'image/jpeg' });
      const original = og ? new Blob([await og.async('uint8array')], { type: 'image/jpeg' }) : stamped;
      if (!og) p.qa = [...new Set([...(p.qa || []), 'Restaurado sin foto original'])];
      await DB.saveWithBlob('photos', p, { original, stamped, thumb: await Photo.thumb(stamped, 1024, 0.78) }); added++;
    }
    for (const a of data.audios || []) {
      if (await DB.get('audios', a.id)) { skipped++; continue; }
      const f = byBase.get(a.file_name); if (!f) { skipped++; continue; }
      await DB.saveWithBlob('audios', a, { audio: new Blob([await f.async('uint8array')], { type: a.mime || 'audio/webm' }) }); added++;
    }
    await loadAll();
    toast(`Respaldo: ${added} elementos restaurados, ${skipped} ya existían u omitidos`, 6000);
  } catch (e) { toast('Restaurar: ' + e.message, 7000); }
  finally { busy(false); reload(); }
}


/* ---------------- configuración central del equipo ---------------- */
/* Enlace #cfg=… (código QR del coordinador): configura Drive y descarga la configuración del equipo. */
async function handleSetupLink() {
  const c = Drive.parseSetup(location.hash);
  if (!c) return;
  history.replaceState(null, '', location.pathname + location.search);
  const prev = await Drive.cfg();
  if (prev.url && (prev.url !== c.url || prev.folder !== c.folder) && !(await ask('<h3>Cambiar carpeta del equipo</h3><p>Este teléfono ya enviaba a otra carpeta de Drive. ¿Usar la nueva configuración?</p>', [['No', false], ['Sí, usar la nueva', true]]))) return;
  await DB.setKv('drive_cfg', { ...prev, ...c });
  toast('Enlace del equipo recibido ✓ · descargando configuración…', 5000);
  setTimeout(() => refreshTeamConfig(true), 600);
}
async function refreshTeamConfig(manual) {
  const c = await Drive.cfg();
  if (!Drive.ready(c)) { if (manual) toast('Primero configure Google Drive (o abra el enlace del equipo)'); return; }
  if (!navigator.onLine) { if (manual) toast('Sin señal: se usará la configuración guardada'); return; }
  const tc = await DB.kv('team_cfg');
  if (!manual && tc && Date.now() - ts(tc.at) < 6 * 3600 * 1000) return;
  try { if ((await Drive.version()) < 3) { if (manual) toast('Su receptor de Drive es antiguo: actualícelo a la versión 4 para usar la configuración del equipo', 7000); return; } } catch (_) { return; }
  if (refreshTeamConfig._busy) return; refreshTeamConfig._busy = true;
  if (manual) busy(true, 'Descargando configuración del equipo…');
  try {
    const r = await Drive.teamConfig();
    const n = await applyTeamConfig(r);
    if (manual) toast(`Configuración actualizada ✓ · ${n.projects} proyectos, ${n.evaluators} evaluadores, ${n.stations} estaciones planificadas`, 6000);
  } catch (e) { if (manual) toast('Configuración: ' + e.message, 7000); }
  finally { refreshTeamConfig._busy = false; if (manual) busy(false); renderTeamState(); if (manual) { await reload(); loadProjectSettings(); } }
}
const cell = v => String(v ?? '').trim();
const yes = v => !/^(no|n|false|0)$/i.test(cell(v));
async function applyTeamConfig(r) {
  const C = r.config || {};
  const projects = (C.PROYECTOS || []).filter(p => cell(p.PROYECTO) && yes(p.ACTIVO ?? 'SI')).map(p => up(p.PROYECTO));
  const evals = (C.EVALUADORES || []).filter(e => cell(e.CODIGO)).map(e => ({ code: up(e.CODIGO), name: cell(e.NOMBRE), specialty: cell(e.ESPECIALIDAD), projects: cell(e.PROYECTOS || '*').split(',').map(x => up(x)).filter(Boolean) }));
  let nst = 0;
  const names = {};
  for (const p of C.PROYECTOS || []) if (cell(p.PROYECTO)) names[up(p.PROYECTO)] = { name: cell(p.NOMBRE), client: cell(p.CLIENTE) };
  for (const P of projects) {
    const prev = await projCfg(P);
    const components = (C.COMPONENTES || []).filter(c => up(c.PROYECTO) === P).map(c => cell(c.COMPONENTE)).filter(Boolean);
    const campaigns = (C.CAMPANAS || []).filter(c => up(c.PROYECTO) === P).map(c => up(c.CAMPANA)).filter(Boolean);
    const evaluators = evals.filter(e => e.projects.includes('*') || e.projects.includes(P)).map(e => ({ code: e.code, name: e.name, specialty: e.specialty }));
    await DB.setKv('proj:' + P, { ...prev, components: components.length ? components : prev.components, campaigns: campaigns.length ? campaigns : prev.campaigns, evaluators: evaluators.length ? evaluators : prev.evaluators, ...(names[P] || {}), central: true });
    const ro = (C.ROTULO || []).find(x => up(x.PROYECTO) === P);
    if (ro) {
      const sc = await stampCfg(P);
      const pos = cell(ro.LOGO_POSICION).toLowerCase(), size = +ro.LOGO_TAMANO, bg = cell(ro.FONDO_TEXTO).toLowerCase(), band = cell(ro.POSICION_DATOS).toLowerCase();
      await DB.setKv('stamp:' + P, { ...sc, ...(/^(tl|tr|bl|br)$/.test(pos) ? { logoPos: pos } : {}), ...(size >= 5 && size <= 45 ? { logoSize: size } : {}), ...(/^(outline|dark|light)$/.test(bg) ? { textStyle: bg } : {}), ...(/^(top|bottom)$/.test(band) ? { bandPos: band } : {}) });
    }
    const lg = (r.logos || {})[P];
    if (lg) { const bin = atob(lg.data), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); await DB.setKv('logo:' + P, new Blob([a], { type: lg.mime || 'image/png' })); }
    // estaciones planificadas → capa del mapa (sugerencias, avance y QA/QC de distancia)
    const feats = (C.ESTACIONES || []).filter(e => up(e.PROYECTO) === P && cell(e.ESTACION) && isFinite(+e.LATITUD) && isFinite(+e.LONGITUD) && +e.LATITUD && +e.LONGITUD)
      .map(e => ({ name: up(e.ESTACION), desc: [cell(e.COMPONENTE), cell(e.DESCRIPCION)].filter(Boolean).join(' · '), type: 'Point', coords: [[+e.LATITUD, +e.LONGITUD]], component: cell(e.COMPONENTE) }));
    const key = `${P}::Estaciones planificadas (equipo)`;
    if (feats.length) { const old = await DB.get('layers', key); await DB.put('layers', { key, project: P, name: 'Estaciones planificadas (equipo)', features: feats, visible: old ? old.visible : true, central: true, imported_at: new Date().toISOString() }); }
    else await DB.del('layers', key);
    nst += feats.length;
  }
  const known = (await DB.kv('projects', [])) || [];
  await DB.setKv('projects', [...new Set([...known, ...projects])]);
  await DB.setKv('team_cfg', { at: new Date().toISOString(), projects, sheetUrl: r.sheetUrl, evaluators: evals.length, stations: nst });
  return { projects: projects.length, evaluators: evals.length, stations: nst };
}
async function renderTeamState() {
  const tc = await DB.kv('team_cfg'), c = await Drive.cfg();
  const el = $('#teamState'); if (!el) return;
  el.innerHTML = !Drive.ready(c) ? 'Sin configurar. Abra el enlace o QR que le compartió el coordinador, o complete Google Drive más abajo.'
    : tc ? `Actualizada ${new Date(tc.at).toLocaleString()} · ${tc.projects.length} proyectos (${tc.projects.map(esc).join(', ')}) · ${tc.evaluators} evaluadores · ${tc.stations} estaciones planificadas`
    : 'Drive configurado. Toque "Actualizar configuración" para descargarla.';
  $('#btnTeamSheet').hidden = !(tc && tc.sheetUrl);
  if (tc && tc.sheetUrl) $('#btnTeamSheet').href = tc.sheetUrl;
}
async function shareTeamLink() {
  const c = await Drive.cfg();
  if (!Drive.ready(c)) { toast('Configure y pruebe Google Drive primero'); return; }
  const link = Drive.setupLink(c, location.origin + location.pathname);
  let svg = '';
  try { const q = qrcode(0, 'M'); q.addData(link); q.make(); svg = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch (e) { svg = '<p class="hint">No se pudo generar el QR; use el enlace.</p>'; }
  const v = await ask(`<h3>Configurar el equipo</h3><p>Cada especialista escanea este código con la cámara del celular (o abre el enlace) y su app queda conectada a la carpeta de Drive y a la configuración central.</p><div class="qr">${svg}</div><p class="warn">Incluye la clave del receptor: compártalo solo con su equipo.</p>`,
    [['Cerrar', false], ['Copiar enlace', 'copy'], ['Compartir', 'share', 'primary']]);
  if (v === 'copy') { try { await navigator.clipboard.writeText(link); toast('Enlace copiado ✓'); } catch (_) { prompt('Copie el enlace:', link); } }
  if (v === 'share') { try { await navigator.share({ title: 'Alba Field · configuración del equipo', text: 'Abra este enlace en su celular para configurar Alba Field:', url: link }); } catch (e) { if (e.name !== 'AbortError') { try { await navigator.clipboard.writeText(link); toast('Enlace copiado ✓'); } catch (_) {} } } }
}

/* ---------------- ajustes ---------------- */
const cfgP = () => up($('#cfgProject').value) || (S.jor ? S.jor.project : '');
async function loadProjectSettings() {
  const inp = $('#cfgProject');
  if (!inp.value) inp.value = S.jor ? S.jor.project : up(((await DB.kv('lastJor', {})) || {}).project);
  $('#dlProject').innerHTML = opt(await knownProjects());
  const P = cfgP(), c = await projCfg(P), sc = await stampCfg(P);
  $('#catEval').value = c.evaluators.map(e => `${e.code} | ${e.name}`).join('\n');
  $('#catComp').value = (c.components.length ? c.components : DEFAULT_COMPONENTS).join('\n');
  $('#catCamp').value = c.campaigns.join('\n');
  $('#sLogoPos').value = sc.logoPos; $('#sLogoBg').value = sc.logoBg ? '1' : '0'; $('#sLogoSize').value = sc.logoSize; $('#sLogoSizeV').textContent = sc.logoSize; $('#sBandPos').value = sc.bandPos; $('#sTextStyle').value = sc.textStyle || 'outline';
  $('#sFields').innerHTML = STAMP_FIELDS.map(([k, l]) => `<label class="check"><input type="checkbox" data-f="${k}" ${sc.fields[k] ? 'checked' : ''}> ${l}</label>`).join('');
  $('#sFields').querySelectorAll('input').forEach(i => i.onchange = drawPreview);
  $('#logoDel').hidden = !(P && await DB.kv('logo:' + P));
  drawPreview();
}
function readStampForm() {
  const fields = {}; $('#sFields').querySelectorAll('input').forEach(i => fields[i.dataset.f] = i.checked);
  return { logoPos: $('#sLogoPos').value, logoBg: $('#sLogoBg').value === '1', logoSize: +$('#sLogoSize').value, bandPos: $('#sBandPos').value, textStyle: $('#sTextStyle').value, fields: { ...DEFAULT_STAMP.fields, ...fields } };
}
async function drawPreview() {
  const c = $('#stampPrev'), g = c.getContext('2d'), W = c.width, H = c.height;
  const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#9cc3d9'); gr.addColorStop(0.55, '#d8e4c8'); gr.addColorStop(0.56, '#7a9a5b'); gr.addColorStop(1, '#4f6b3a');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.fillStyle = '#5d7c47'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(60 + i * 90, H * 0.56, 40 + (i % 3) * 14, Math.PI, 0); g.fill(); }
  const cfg = readStampForm(), P = cfgP() || 'PROYECTO';
  const now = new Date(), u = Geo.toUTM(-17.64, -71.34);
  const sp = { project: P, campaign: 'C01', component: 'Flora', specialist: 'ESP01', person: 'Nombre Apellido', station: 'E-01', place: 'Quebrada Honda', n: 1, caption: 'Vista general de la estación', time_local: localIso(now), utc_offset_minutes: -now.getTimezoneOffset(), lat: -17.640123, lon: -71.340456, accuracy: 4, alt: 1250, utm_zone: u.zone, utm_e: u.e, utm_n: u.n, heading: 35 };
  const logoBlob = P && await DB.kv('logo:' + P);
  const logoImg = logoBlob ? await Photo.loadImg(logoBlob).catch(() => null) : null;
  Photo.drawOverlay(g, W, H, sp, { lines: stampLines(sp, cfg), cfg, north: S.set.north && cfg.fields.rumbo, logoImg });
}
function bindSettings() {
  $('#btnTeamRefresh').onclick = () => refreshTeamConfig(true);
  $('#btnTeamShare').onclick = shareTeamLink;
  renderTeamState();
  $('#cfgProject').addEventListener('change', e => { e.target.value = up(e.target.value); loadProjectSettings(); });
  ['#sLogoPos', '#sLogoBg', '#sBandPos', '#sTextStyle'].forEach(id => $(id).onchange = drawPreview);
  $('#sLogoSize').oninput = e => { $('#sLogoSizeV').textContent = e.target.value; drawPreview(); };
  $('#btnStamp').onclick = async () => { const P = cfgP(); if (!P) { toast('Escriba el proyecto a configurar'); return; } await DB.setKv('stamp:' + P, readStampForm()); toast(`Rótulo guardado para ${P} ✓`); };
  $('#btnCats').onclick = async () => {
    const P = cfgP(); if (!P) { toast('Escriba el proyecto a configurar'); return; }
    const lines = id => $(id).value.split('\n').map(s => s.trim()).filter(Boolean);
    const evaluators = lines('#catEval').map(l => { const [code, ...n] = l.split('|'); return { code: up(code), name: n.join('|').trim() }; }).filter(e => CODE_RE.test(e.code));
    await DB.setKv('proj:' + P, { evaluators, components: lines('#catComp'), campaigns: lines('#catCamp').map(up) });
    const projs = (await DB.kv('projects', [])) || []; if (!projs.includes(P)) await DB.setKv('projects', [...projs, P]);
    toast(`Catálogos de ${P} guardados ✓`); fillJornadaLists();
  };
  $('#logoIn').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const P = cfgP(); if (!P) { toast('Escriba el proyecto a configurar'); return; }
    if (f.size > 5 * 1048576) { toast('Logo máximo 5 MB'); return; }
    const small = f.type === 'image/png' ? await pngSmall(f) : await Photo.thumb(f, 800, 0.9).catch(() => f);
    await DB.setKv('logo:' + P, small); toast('Logo guardado para ' + P); loadProjectSettings();
  };
  $('#logoDel').onclick = async () => { const P = cfgP(); await DB.setKv('logo:' + P, null); loadProjectSettings(); };
  $('#formSet').onsubmit = async e => {
    e.preventDefault(); const f = e.target; if (!f.reportValidity()) return;
    for (const el of f.elements) if (el.name) S.set[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? +el.value : el.value.trim();
    await DB.setKv('settings', S.set); toast('Ajustes guardados ✓'); drawPreview();
  };
  const fs = $('#formSet'); for (const el of fs.elements) if (el.name) { if (el.type === 'checkbox') el.checked = !!S.set[el.name]; else if (S.set[el.name] != null) el.value = S.set[el.name]; }
  const fd = $('#formDrive');
  Drive.cfg().then(c => { fd.elements.url.value = c.url || ''; fd.elements.folder.value = c.folder || ''; fd.elements.token.value = c.token || ''; fd.elements.orig.checked = !!c.orig; });
  const readDrive = () => ({ url: fd.elements.url.value.trim(), folder: fd.elements.folder.value.trim(), token: fd.elements.token.value.trim(), orig: fd.elements.orig.checked });
  fd.onsubmit = async e => {
    e.preventDefault(); const c = readDrive();
    if (c.folder && !Drive.folderId(c.folder)) { toast('El enlace de carpeta no es válido (debe contener /folders/…)'); return; }
    await DB.setKv('drive_cfg', { ...(await Drive.cfg()), ...c }); toast('Google Drive guardado ✓'); renderDriveState();
  };
  $('#btnPing').onclick = async () => {
    const c = readDrive(); await DB.setKv('drive_cfg', { ...(await Drive.cfg()), ...c });
    if (!navigator.onLine) { toast('Sin señal'); return; }
    busy(true, 'Probando conexión…');
    try {
      const r = await Drive.ping(); await DB.setKv('drive_cfg', { ...(await Drive.cfg()), rootName: r.root }); busy(false);
      if ((r.version || 2) < 3) { toast(`Conexión correcta ✓ · las fotos se envían. Para envío por partes, configuración del equipo y consolidado, actualice el receptor a la versión 4 (guía)`, 9000); renderDriveState(); return; }
      if (r.version < 4) toast(`Conexión correcta ✓ · receptor v${r.version}: actualícelo a v4 para envío por partes con señal débil`, 7000);
      toast(`Conexión correcta ✓ · carpeta "${r.root}"`, 4000); renderDriveState(); refreshTeamConfig(true);
    }
    catch (e) { busy(false); toast('Drive: ' + e.message, 7000); }
  };
  $('#btnPersist').onclick = async () => { if (navigator.storage && navigator.storage.persist) { const ok = await navigator.storage.persist(); toast(ok ? 'Datos protegidos ✓' : 'El navegador no lo concedió. Instale la app en la pantalla de inicio.', 6000); renderStorage(); } };
  $('#btnUpdate').onclick = checkUpdate;
}
async function pngSmall(f) {
  const im = await Photo.loadImg(f); const s = Math.min(1, 800 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(b => r(b || f), 'image/png'));
}
async function checkUpdate() {
  if (!navigator.onLine) { toast('Necesita señal para buscar actualizaciones'); return; }
  if (!('serviceWorker' in navigator)) { location.reload(); return; }
  busy(true, 'Buscando actualización…');
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { busy(false); location.reload(); return; }
    await reg.update();
    await new Promise(r => setTimeout(r, 2500));
    if (reg.installing || reg.waiting) { $('#busyText').textContent = 'Instalando versión nueva…'; setTimeout(() => location.reload(), 4000); return; }
    busy(false); toast(`Ya tiene la última versión (${APP_VERSION}) ✓`);
  } catch (e) { busy(false); toast('No se pudo buscar: ' + e.message); }
}
async function renderStorage() {
  if (!navigator.storage || !navigator.storage.estimate) { $('#storeInfo').textContent = 'No disponible'; return; }
  const e = await navigator.storage.estimate(); const p = navigator.storage.persisted ? await navigator.storage.persisted() : false;
  $('#storeInfo').textContent = `Usado ${fmtMB(e.usage || 0)} de ${fmtMB(e.quota || 0)} · ${S.d.jornadas.length} jornadas · ${S.d.stations.length} estaciones · ${S.d.photos.length} fotos · ${S.d.audios.length} audios · ${p ? 'protegido ✓' : 'NO protegido: instale la app y toque el botón'}`;
}

init().catch(e => { console.error(e); toast('Error al iniciar: ' + e.message, 10000); });
