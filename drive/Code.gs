/**
 * Alba Field · receptor para Google Drive (Google Apps Script)
 * 1. Cambie CLAVE por una palabra secreta (la misma que pondrá en la app).
 * 2. Implementar → Nueva implementación → Aplicación web
 *    Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
 * 3. Copie la URL que termina en /exec y péguela en Alba Field → Ajustes → Google Drive.
 */
const CLAVE = 'CAMBIE-ESTA-CLAVE';

function doGet() {
  return salida({ ok: true, app: 'Alba Field receptor', version: 2 });
}

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents);
    if (b.token !== CLAVE) return salida({ ok: false, error: 'Clave incorrecta' });
    const raiz = DriveApp.getFolderById(b.root);
    if (b.action === 'ping') return salida({ ok: true, root: raiz.getName() });

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    let carpeta = raiz;
    try {
      (b.path || []).forEach(function (n) { carpeta = subcarpeta(carpeta, String(n)); });
    } finally { lock.releaseLock(); }

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

function subcarpeta(padre, nombre) {
  const it = padre.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : padre.createFolder(nombre);
}

function salida(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
