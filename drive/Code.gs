/**
 * Alba Field · receptor para Google Drive (Google Apps Script) · versión 3
 *
 * Hace tres cosas:
 *  1. Recibe fotos, audios y productos de los teléfonos y los ordena en carpetas.
 *  2. Entrega la configuración central del equipo (hoja ALBA_FIELD_CONFIG en la carpeta raíz).
 *  3. Consolida automáticamente: una Google Sheet por PROYECTO/CAMPAÑA con todas las
 *     jornadas, estaciones, fotos y audios del equipo, más una hoja AVANCE.
 *
 * Instalación (una sola vez):
 *  1. Cambie CLAVE por una palabra secreta (la misma que usará el equipo).
 *  2. Implementar → Nueva implementación → Aplicación web
 *     Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 *  3. Copie la URL que termina en /exec y péguela en Alba Field → Ajustes → Google Drive.
 * Al actualizar este código: Implementar → Gestionar implementaciones → editar (lápiz) →
 * Versión: Nueva versión → Implementar. Así la URL /exec no cambia.
 */
const CLAVE = 'CAMBIE-ESTA-CLAVE';
const VERSION = 3;
const CONFIG_NAME = 'ALBA_FIELD_CONFIG';

/* Plantilla de la hoja de configuración: se crea sola la primera vez. */
const CONFIG_TEMPLATE = {
  PROYECTOS: [['PROYECTO', 'NOMBRE', 'CLIENTE', 'ACTIVO'], ['DEMO', 'Proyecto de ejemplo (puede borrar esta fila)', 'Cliente', 'SI']],
  EVALUADORES: [['CODIGO', 'NOMBRE', 'ESPECIALIDAD', 'PROYECTOS'], ['ESP01', 'Nombre Apellido', 'Flora', '*']],
  COMPONENTES: [['PROYECTO', 'COMPONENTE'], ['DEMO', 'Flora'], ['DEMO', 'Fauna terrestre']],
  CAMPANAS: [['PROYECTO', 'CAMPANA', 'INICIO', 'FIN'], ['DEMO', 'C01', '', '']],
  ESTACIONES: [['PROYECTO', 'COMPONENTE', 'ESTACION', 'LATITUD', 'LONGITUD', 'DESCRIPCION'], ['DEMO', 'Flora', 'E-01', -17.64, -71.34, 'Ejemplo']],
  ROTULO: [['PROYECTO', 'LOGO_POSICION', 'LOGO_TAMANO', 'FONDO_TEXTO', 'POSICION_DATOS'], ['DEMO', 'tr', 20, 'outline', 'bottom']],
  LEEME: [['Instrucciones'],
    ['Cada pestaña es una lista. Escriba una fila por elemento; no cambie los encabezados.'],
    ['PROYECTOS: códigos sin espacios (letras, números, guion). ACTIVO = NO lo oculta en los teléfonos.'],
    ['EVALUADORES: PROYECTOS = * para todos, o códigos separados por coma.'],
    ['ESTACIONES: estaciones planificadas; se ven en el mapa y alimentan la hoja AVANCE.'],
    ['ROTULO: LOGO_POSICION tl, tr, bl, br · LOGO_TAMANO 8 a 40 · FONDO_TEXTO outline, dark, light · POSICION_DATOS bottom, top.'],
    ['LOGOS: suba a la carpeta CONFIG_LOGOS un PNG o JPG con el código del proyecto como nombre (ej. DEMO.png).'],
    ['Los teléfonos toman los cambios al tocar Ajustes → Actualizar configuración, o solos cada 6 horas con señal.']],
};

function doGet() {
  return salida({ ok: true, app: 'Alba Field receptor', version: VERSION });
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.token !== CLAVE) return salida({ ok: false, error: 'Clave incorrecta' });
    const raiz = DriveApp.getFolderById(b.root);
    if (b.action === 'ping') return salida({ ok: true, root: raiz.getName(), version: VERSION });
    if (b.action === 'config') return salida(leerConfig(raiz));
    if (b.action === 'consolidate') return salida(conBloqueo(function () { return consolidar(raiz, b); }));

    const carpeta = conBloqueo(function () { return ruta(raiz, b.path || []); });
    if (b.action !== 'upload') return salida({ ok: true, url: carpeta.getUrl() });
    const blob = Utilities.newBlob(Utilities.base64Decode(b.data), b.mime || 'application/octet-stream', b.name);
    const previos = carpeta.getFilesByName(b.name);
    while (previos.hasNext()) previos.next().setTrashed(true);   // se reemplaza la versión anterior
    const f = carpeta.createFile(blob);
    return salida({ ok: true, id: f.getId(), url: carpeta.getUrl() });
  } catch (err) {
    return salida({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ---------- utilidades ---------- */
function conBloqueo(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);           // varios teléfonos enviando a la vez: se atienden en fila
  try { return fn(); } finally { lock.releaseLock(); }
}
function ruta(raiz, partes) {
  let c = raiz;
  partes.forEach(function (n) { c = subcarpeta(c, String(n)); });
  return c;
}
function subcarpeta(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}
function hojaDeCalculo(carpeta, nombre, plantilla) {
  const it = carpeta.getFilesByName(nombre);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  const ss = SpreadsheetApp.create(nombre);
  DriveApp.getFileById(ss.getId()).moveTo(carpeta);
  if (plantilla) {
    Object.keys(plantilla).forEach(function (n, i) {
      const sh = i === 0 ? ss.getSheets()[0].setName(n) : ss.insertSheet(n);
      const filas = plantilla[n];
      const ancho = Math.max.apply(null, filas.map(function (r) { return r.length; }));
      sh.getRange(1, 1, filas.length, ancho).setValues(filas.map(function (r) { return rellenar(r, ancho); }));
      estiloEncabezado(sh, ancho);
    });
  }
  return ss;
}
function rellenar(r, n) { const o = r.slice(0, n); while (o.length < n) o.push(''); return o; }
function estiloEncabezado(sh, ancho) {
  sh.getRange(1, 1, 1, ancho).setFontWeight('bold').setBackground('#1f3b2d').setFontColor('#ffffff');
  sh.setFrozenRows(1);
}
function salida(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function filasComoObjetos(sh) {
  if (!sh) return [];
  const v = sh.getDataRange().getValues();
  if (v.length < 2) return [];
  const h = v[0].map(function (x) { return String(x).trim().toUpperCase(); });
  return v.slice(1).filter(function (r) { return r.some(function (x) { return x !== '' && x !== null; }); })
    .map(function (r) { const o = {}; h.forEach(function (k, i) { if (k) o[k] = r[i]; }); return o; });
}

/* ---------- 2. configuración central ---------- */
function leerConfig(raiz) {
  const ss = conBloqueo(function () { return hojaDeCalculo(raiz, CONFIG_NAME, CONFIG_TEMPLATE); });
  const cfg = {};
  ['PROYECTOS', 'EVALUADORES', 'COMPONENTES', 'CAMPANAS', 'ESTACIONES', 'ROTULO'].forEach(function (n) {
    cfg[n] = filasComoObjetos(ss.getSheetByName(n));
  });
  // logos: CONFIG_LOGOS/<PROYECTO>.png|jpg (hasta 1 MB cada uno)
  const logos = {};
  const it = raiz.getFoldersByName('CONFIG_LOGOS');
  if (it.hasNext()) {
    const fs = it.next().getFiles();
    while (fs.hasNext()) {
      const f = fs.next(), m = /^(.+)\.(png|jpe?g)$/i.exec(f.getName());
      if (m && f.getSize() <= 1048576) logos[m[1].toUpperCase()] = { mime: f.getMimeType(), data: Utilities.base64Encode(f.getBlob().getBytes()) };
    }
  }
  return { ok: true, version: VERSION, config: cfg, logos: logos, sheetUrl: ss.getUrl() };
}

/* ---------- 3. consolidación ---------- */
/* b.project, b.campaign, b.tables = { JORNADAS: [[encabezado], [fila]…], ESTACIONES: …, FOTOS: …, AUDIOS: … } */
function consolidar(raiz, b) {
  const P = String(b.project || '').trim(), K = String(b.campaign || '').trim();
  if (!P || !K || !b.tables) return { ok: false, error: 'Faltan proyecto, campaña o datos' };
  const carpeta = ruta(raiz, [P, K]);
  const ss = hojaDeCalculo(carpeta, 'CONSOLIDADO_' + P + '_' + K, null);
  let nuevos = 0, actualizados = 0;
  ['JORNADAS', 'ESTACIONES', 'FOTOS', 'AUDIOS'].forEach(function (n) {
    const t = b.tables[n];
    if (!t || !t.length) return;
    let sh = ss.getSheetByName(n);
    if (!sh) {
      const vacia = ss.getSheets().filter(function (s) { return s.getLastRow() === 0 && /^(Hoja|Sheet)\s?1$/i.test(s.getName()); })[0];
      sh = vacia ? vacia.setName(n) : ss.insertSheet(n);
    }
    const r = upsert(sh, t[0], t.slice(1));
    nuevos += r.nuevos; actualizados += r.actualizados;
  });
  avance(raiz, ss, P);
  return { ok: true, url: ss.getUrl(), nuevos: nuevos, actualizados: actualizados };
}

/* Inserta o actualiza filas por la primera columna (ID). Si el teléfono trae columnas nuevas, se agregan al final. */
function upsert(sh, encabezado, filas) {
  let datos = sh.getLastRow() ? sh.getDataRange().getValues() : [];
  let h = datos.length ? datos[0].map(String) : [];
  if (!h.length) { h = encabezado.slice(); datos = [h]; }
  encabezado.forEach(function (c) { if (h.indexOf(c) < 0) h.push(c); });
  const pos = encabezado.map(function (c) { return h.indexOf(c); });
  const ids = {};
  for (let i = 1; i < datos.length; i++) ids[String(datos[i][0])] = i;
  let nuevos = 0, actualizados = 0;
  filas.forEach(function (f) {
    const id = String(f[0]);
    let i = ids[id];
    if (i === undefined) { i = datos.length; datos.push([]); ids[id] = i; nuevos++; } else actualizados++;
    const fila = rellenar(datos[i], h.length);
    pos.forEach(function (p, j) { fila[p] = f[j] === null || f[j] === undefined ? '' : f[j]; });
    datos[i] = fila;
  });
  datos[0] = h;
  datos = datos.map(function (r) { return rellenar(r, h.length); });
  sh.getRange(1, 1, datos.length, h.length).setValues(datos);
  estiloEncabezado(sh, h.length);
  return { nuevos: nuevos, actualizados: actualizados };
}

/* Hoja AVANCE: estaciones planificadas (configuración) frente a evaluadas (consolidado), por componente. */
function avance(raiz, ss, P) {
  const it = raiz.getFilesByName(CONFIG_NAME);
  const norm = function (s) { return String(s || '').trim().toUpperCase(); };
  const plan = it.hasNext() ? filasComoObjetos(SpreadsheetApp.open(it.next()).getSheetByName('ESTACIONES'))
    .filter(function (r) { return norm(r.PROYECTO) === P; }) : [];
  const ev = filasComoObjetos(ss.getSheetByName('ESTACIONES')).filter(function (r) { return r.ANULADO !== 'SI'; });
  const comps = {};
  const del = function (c) { return (comps[c] = comps[c] || { plan: {}, ev: {}, evaluadores: {} }); };
  plan.forEach(function (r) { del(String(r.COMPONENTE || '(sin componente)')).plan[norm(r.ESTACION)] = 1; });
  ev.forEach(function (r) { const o = del(String(r.COMPONENTE || '(sin componente)')); o.ev[norm(r.ESTACION)] = 1; o.evaluadores[r.EVALUADOR_COD] = 1; });
  const filas = [['COMPONENTE', 'PLANIFICADAS', 'EVALUADAS', 'EVALUADAS_PLANIFICADAS', 'AVANCE_%', 'PENDIENTES', 'FUERA_DE_PLAN', 'EVALUADORES']];
  Object.keys(comps).sort().forEach(function (c) {
    const o = comps[c], pl = Object.keys(o.plan), evs = Object.keys(o.ev);
    const hechas = pl.filter(function (s) { return o.ev[s]; });
    filas.push([c, pl.length, evs.length, hechas.length, pl.length ? Math.round(hechas.length / pl.length * 100) : '',
      pl.filter(function (s) { return !o.ev[s]; }).join(', '), evs.filter(function (s) { return !o.plan[s]; }).join(', '), Object.keys(o.evaluadores).join(', ')]);
  });
  filas.push(['Actualizado: ' + new Date().toISOString(), '', '', '', '', '', '', '']);
  const sh = ss.getSheetByName('AVANCE') || ss.insertSheet('AVANCE', 0);
  sh.clearContents();
  sh.getRange(1, 1, filas.length, filas[0].length).setValues(filas);
  estiloEncabezado(sh, filas[0].length);
}
