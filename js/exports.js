/* Alba Field · productos: Excel (.xlsx), KMZ, paquete ZIP y consolidación del equipo. Todo se genera en el teléfono/PC, sin servidor. */
const Exports = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const pad = n => String(n).padStart(2, '0');
  const stampNow = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
  const num = v => (v == null || v === '' || !isFinite(v)) ? '' : Number(v);

  /* Columnas compatibles con la plantilla de GeoField Etapa 1 (R/Shiny): ID_REGISTRO, FOTO, OBSERVACION, CATEGORIA, IMPORTANCIA, LATITUD, LONGITUD… */
  const COLS = [
    ['ID_REGISTRO', r => r.id, 38], ['CORRELATIVO', r => r.code, 14],
    ['PROYECTO', r => r.project, 12], ['CAMPANA', r => r.campaign, 12], ['VERSION_PLANTILLA', r => r.template_version, 10],
    ['ESPECIALISTA', r => r.specialist, 10], ['RESPONSABLE', r => r.person, 22], ['ESPECIALIDAD', r => r.specialty, 16],
    ['ESTACION', r => r.station, 14], ['COMPONENTE', r => r.component, 16], ['CATEGORIA', r => r.category, 16],
    ['IMPORTANCIA', r => r.importance, 11], ['LUGAR', r => r.place, 22], ['OBSERVACION', r => r.notes, 40], ['ACCION', r => r.action, 22],
    ['FECHA', r => r.time_local.slice(0, 10), 11], ['HORA', r => r.time_local.slice(11, 19), 9], ['FECHA_HORA_UTC', r => r.time_utc, 22],
    ['LATITUD', r => num(r.lat), 12], ['LONGITUD', r => num(r.lon), 12], ['ALTITUD_M', r => num(r.alt != null ? Math.round(r.alt * 10) / 10 : null), 10],
    ['PRECISION_M', r => num(Math.round(r.accuracy * 10) / 10), 10], ['EDAD_GPS_S', r => num(r.gps_age_s), 9],
    ['UTM_ZONA', r => r.utm_zone, 8], ['UTM_ESTE', r => num(r.utm_e), 12], ['UTM_NORTE', r => num(r.utm_n), 13],
    ['RUMBO_MAG_APROX', r => num(r.heading != null ? Math.round(r.heading) : null), 10],
    ['PUNTO_KML_CERCANO', r => r.nearest_feature, 16], ['DIST_PUNTO_KML_M', r => num(r.nearest_dist_m != null ? Math.round(r.nearest_dist_m) : null), 10],
    ['FOTO', r => r.photo_name + '.jpg', 40], ['FOTO_ORIGINAL', r => r.photo_name + '_original.jpg', 40], ['SHA256_ORIGINAL', r => r.sha256_original, 20],
    ['MODO_CAMARA', r => r.camera_mode, 10], ['QAQC', r => (r.qa || []).join('; ') || 'OK', 30],
    ['ANULADO', r => r.voided ? 'SI' : 'NO', 8], ['EDITADO', r => r.edited_at || '', 20], ['ESTADO_ENVIO', r => r.status, 12], ['VERSION_APP', r => r.app_version, 9],
  ];

  function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetXml(rows, widths) {
    const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    const body = rows.map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => {
      const ref = colName(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : '';
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      if (v === '' || v == null) return ri === 0 ? `<c r="${ref}"${st} t="inlineStr"><is><t></t></is></c>` : '';
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    const last = colName(Math.max(0, (rows[0] || []).length - 1)) + Math.max(1, rows.length);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${body}</sheetData>${rows.length > 1 ? `<autoFilter ref="A1:${last}"/>` : ''}</worksheet>`;
  }
  const safeSheet = (n, used) => { let s = String(n).replace(/[\[\]:*?/\\]/g, '_').slice(0, 31) || 'Hoja'; let k = s, i = 2; while (used.has(k.toLowerCase())) k = s.slice(0, 28) + '_' + i++; used.add(k.toLowerCase()); return k; };

  /* sheets: [{name, rows:[[...]], widths:[...]}] → Blob .xlsx */
  async function xlsx(sheets) {
    const z = new JSZip(), used = new Set();
    sheets = sheets.map(s => ({ ...s, name: safeSheet(s.name, used) }));
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
    z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${(dn => dn.length ? `<definedNames>${dn.join('')}</definedNames>` : '')(sheets.map((s, i) => s.rows.length > 1 ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name).replace(/'/g, "''")}'!$A$1:$${colName(s.rows[0].length - 1)}$${s.rows.length}</definedName>` : '').filter(Boolean))}</workbook>`);
    z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F3B2D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
    sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, s.widths)));
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const recordRows = recs => [COLS.map(c => c[0]), ...recs.map(r => COLS.map(c => { try { const v = c[1](r); return v ?? ''; } catch (_) { return ''; } }))];
  const widths = COLS.map(c => c[2]);

  function summaryRows(recs) {
    const rows = [['AGRUPACION', 'VALOR', 'REGISTROS', 'CON_OBSERVACION_QAQC', 'ANULADOS']];
    for (const [label, key] of [['Especialista', 'specialist'], ['Componente', 'component'], ['Importancia', 'importance'], ['Estación', 'station'], ['Fecha', r => r.time_local.slice(0, 10)]]) {
      const m = new Map();
      for (const r of recs) { const k = (typeof key === 'function' ? key(r) : r[key]) || '(vacío)'; const a = m.get(k) || [0, 0, 0]; a[0]++; if ((r.qa || []).length) a[1]++; if (r.voided) a[2]++; m.set(k, a); }
      [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).forEach(([k, a]) => rows.push([label, k, ...a]));
    }
    return rows;
  }
  function qaRows(recs) {
    const rows = [['ID_REGISTRO', 'ESPECIALISTA', 'ESTACION', 'FECHA', 'OBSERVACION_QAQC']];
    for (const r of recs) for (const q of (r.qa || [])) rows.push([r.id, r.specialist, r.station, r.time_local.slice(0, 16).replace('T', ' '), q]);
    return rows;
  }

  async function recordsXlsx(recs, title = 'REGISTROS') {
    return xlsx([
      { name: title, rows: recordRows(recs), widths },
      { name: 'RESUMEN', rows: summaryRows(recs), widths: [14, 24, 11, 22, 10] },
      { name: 'QAQC', rows: qaRows(recs), widths: [38, 12, 14, 17, 50] },
    ]);
  }

  /* KMZ: puntos con estilo por importancia, carpetas por especialista y miniatura embebida. getThumb(rec)→Blob|null */
  async function kmz(recs, getThumb, name = 'Alba Field') {
    const z = new JSZip();
    const styles = { Alta: 'ff2b39c0', Media: 'ff0aa5e0', Baja: 'ff4f9e2d' };
    const groups = new Map();
    for (const r of recs) { if (!groups.has(r.specialist)) groups.set(r.specialist, []); groups.get(r.specialist).push(r); }
    let folders = '';
    for (const [esp, rs] of groups) {
      let pms = '';
      for (const r of rs) {
        let img = '';
        const t = getThumb ? await getThumb(r) : null;
        if (t) { const f = `files/${r.photo_name}.jpg`; z.file(f, t, { compression: 'STORE' }); img = `<img src="${f}" width="480"/><br/>`; }
        const rowsHtml = [['Estación', r.station], ['Componente', r.component], ['Categoría', r.category], ['Importancia', r.importance], ['Lugar', r.place], ['Observación', r.notes], ['Acción', r.action], ['Fecha', r.time_local.slice(0, 19).replace('T', ' ')], ['Responsable', r.person || r.specialist], ['Precisión', `±${Math.round(r.accuracy)} m`], ['UTM', `${r.utm_zone} ${Math.round(r.utm_e)} E / ${Math.round(r.utm_n)} N`], ['QAQC', (r.qa || []).join('; ') || 'OK'], ['Foto', r.photo_name + '.jpg']]
          .filter(x => x[1]).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('');
        const ext = COLS.map(([h, f]) => { let v = ''; try { v = f(r); } catch (_) {} return `<Data name="${h}"><value>${esc(v)}</value></Data>`; }).join('');
        pms += `<Placemark><name>${esc(r.station)}${r.voided ? ' (ANULADO)' : ''}</name><styleUrl>#imp_${esc(r.importance || 'Media')}</styleUrl><TimeStamp><when>${esc(r.time_utc)}</when></TimeStamp><description><![CDATA[${img}<table>${rowsHtml}</table>]]></description><ExtendedData>${ext}</ExtendedData><Point><coordinates>${r.lon},${r.lat}${r.alt != null ? ',' + r.alt.toFixed(1) : ''}</coordinates></Point></Placemark>`;
      }
      folders += `<Folder><name>${esc(esp)}</name>${pms}</Folder>`;
    }
    const st = Object.entries(styles).map(([k, c]) => `<Style id="imp_${k}"><IconStyle><color>${c}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>`).join('');
    z.file('doc.kml', `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>${st}${folders}</Document></kml>`);
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.google-earth.kmz' });
  }

  function leeme(meta) {
    return `Alba Field – paquete de entrega
Generado: ${new Date().toISOString()}  (app ${meta.app})
Especialista: ${meta.specialist}   Proyecto/Campaña: ${meta.project}/${meta.campaign}
Registros: ${meta.count}

Contenido
- ${meta.base}.xlsx  → matriz de registros (hojas REGISTROS, RESUMEN, QAQC). Columnas compatibles con GeoField Etapa 1.
- ${meta.base}.kmz   → abrir en Google Earth / QGIS. Miniaturas embebidas.
- fotos_rotuladas/   → JPG con rótulo y EXIF GPS (WGS84). El nombre coincide con la columna FOTO.
- originales/        → fotografía original sin modificar. Su huella SHA-256 está en la columna SHA256_ORIGINAL.
- datos.json         → datos completos (sirve para consolidar el equipo y para restaurar en el teléfono).

Coordenadas: WGS84 (EPSG:4326) y UTM WGS84 calculado en el equipo.
Rumbo: magnético aproximado según el sensor del teléfono; no reemplaza un azimut con instrumento.
Hora: reloj del teléfono (local y UTC).
`;
  }

  /* Paquete ZIP de entrega/respaldo. getBlobs(rec) → {original, stamped, thumb} */
  async function pack(recs, getBlobs, { includeOriginals = true, light = false, meta, progress } = {}) {
    const z = new JSZip();
    const base = `${meta.specialist}_${meta.project}_${meta.campaign}`;
    const thumbs = new Map();
    let i = 0;
    for (const r of recs) {
      const b = await getBlobs(r);
      if (b) {
        if (b.thumb) thumbs.set(r.id, b.thumb);
        if (!light) {
          if (b.stamped) z.file(`fotos_rotuladas/${r.photo_name}.jpg`, b.stamped, { compression: 'STORE' });
          if (includeOriginals && b.original) z.file(`originales/${r.photo_name}_original.jpg`, b.original, { compression: 'STORE' });
        }
      }
      progress && progress(++i, recs.length);
    }
    z.file(`${base}.xlsx`, await recordsXlsx(recs), { compression: 'STORE' });
    z.file(`${base}.kmz`, await kmz(recs, r => thumbs.get(r.id), base), { compression: 'STORE' });
    z.file('datos.json', JSON.stringify({ schema: 'geofield.records/1', app: meta.app, generated_utc: new Date().toISOString(), specialist: meta.specialist, records: recs }, null, 1));
    z.file('LEEME.txt', leeme({ ...meta, base, count: recs.length }));
    const blob = await z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { blob, name: `AlbaField_${base}_${stampNow()}${light ? '_liviano' : ''}.zip` };
  }

  /* Consolidación del coordinador. files: File[] (.zip de Alba Field o datos.json) */
  async function consolidate(files, log) {
    const byId = new Map(), conflicts = [], sources = [];
    const strip = r => { const { status, uploaded_at, delivered_at, sync_error, ...rest } = r; return JSON.stringify(rest); };
    for (const f of files) {
      let data;
      try {
        if (/\.json$/i.test(f.name)) data = JSON.parse(await f.text());
        else {
          const zip = await JSZip.loadAsync(f);
          const j = zip.file('datos.json') || Object.values(zip.files).find(x => /(^|\/)datos\.json$/.test(x.name));
          if (!j) throw new Error('no contiene datos.json');
          data = JSON.parse(await j.async('string'));
        }
        if (!data || !Array.isArray(data.records)) throw new Error('formato no reconocido');
      } catch (e) { log(`✗ ${f.name}: ${e.message}`); continue; }
      let n = 0, dup = 0;
      for (const r of data.records) {
        if (!r || !r.id) continue;
        const prev = byId.get(r.id);
        if (!prev) { byId.set(r.id, r); n++; }
        else if (strip(prev) === strip(r)) dup++;
        else {
          // versión editada: queda la de edición más reciente; se informa
          const keep = (r.edited_at || '') > (prev.edited_at || '') ? r : prev;
          byId.set(r.id, keep); conflicts.push([r.id, r.specialist, r.station, 'Mismo ID con datos distintos; se conservó la edición más reciente']);
        }
      }
      sources.push([f.name, data.specialist || '', data.generated_utc || '', data.records.length, n, dup]);
      log(`✓ ${f.name}: ${n} nuevos, ${dup} repetidos`);
    }
    const recs = [...byId.values()].sort((a, b) => (a.specialist + a.time_utc).localeCompare(b.specialist + b.time_utc));
    if (!recs.length) throw new Error('No se encontraron registros');
    // QA de equipo: misma fotografía (SHA-256) en registros distintos
    const bySha = new Map();
    for (const r of recs) if (r.sha256_original) { const a = bySha.get(r.sha256_original) || []; a.push(r); bySha.set(r.sha256_original, a); }
    for (const a of bySha.values()) if (a.length > 1) for (const r of a) r.qa = [...new Set([...(r.qa || []), `Foto idéntica en ${a.length} registros`])];

    const esps = [...new Set(recs.map(r => r.specialist))].sort();
    const out = new JSZip();
    const general = await xlsx([
      { name: 'GENERAL', rows: recordRows(recs), widths },
      ...esps.map(e => ({ name: e, rows: recordRows(recs.filter(r => r.specialist === e)), widths })),
      { name: 'RESUMEN', rows: summaryRows(recs), widths: [14, 24, 11, 22, 10] },
      { name: 'QAQC', rows: qaRows(recs), widths: [38, 12, 14, 17, 50] },
      { name: 'CONFLICTOS', rows: [['ID_REGISTRO', 'ESPECIALISTA', 'ESTACION', 'DETALLE'], ...conflicts], widths: [38, 12, 14, 60] },
      { name: 'FUENTES', rows: [['ARCHIVO', 'ESPECIALISTA', 'GENERADO_UTC', 'REGISTROS', 'NUEVOS', 'REPETIDOS'], ...sources], widths: [50, 12, 24, 10, 10, 10] },
    ]);
    out.file('GENERAL.xlsx', general);
    for (const e of esps) out.file(`especialistas/${e}.xlsx`, await recordsXlsx(recs.filter(r => r.specialist === e), e));
    out.file('GENERAL.kmz', await kmz(recs, null, 'Alba Field GENERAL'));
    out.file('datos_general.json', JSON.stringify({ schema: 'geofield.records/1', consolidated_utc: new Date().toISOString(), records: recs }, null, 1));
    const blob = await out.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    return { blob, name: `AlbaField_GENERAL_${stampNow()}.zip`, count: recs.length, esps, conflicts: conflicts.length };
  }

  return { xlsx, recordsXlsx, kmz, pack, consolidate, COLS };
})();
