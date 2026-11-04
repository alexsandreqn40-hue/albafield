/* Alba Field 2 · productos: matriz Excel (.xlsx), KMZ por estación, galería fotográfica Word (.docx), paquete ZIP y consolidación.
   Todo se genera en el teléfono/PC, sin servidor. */
const Exports = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const pad = n => String(n).padStart(2, '0');
  const stampNow = () => { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; };
  const num = v => (v == null || v === '' || !isFinite(v)) ? '' : Number(v);
  const r1 = v => v == null ? null : Math.round(v * 10) / 10;
  const hhmm = t => (t || '').slice(11, 19);
  const dmy = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
  const qaTxt = x => (x.qa || []).join('; ') || 'OK';
  const statusTxt = x => x.voided ? 'ANULADO' : x.uploaded_at && !(x.edited_at > x.uploaded_at) ? 'EN DRIVE' : x.send === false ? 'NO SELECCIONADO' : 'EN TELÉFONO';

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

  /* ---------- columnas de la matriz ---------- */
  const C = {
    JORNADAS: [
      ['ID_JORNADA', j => j.id, 38], ['PROYECTO', j => j.project, 12], ['CAMPANA', j => j.campaign, 12], ['COMPONENTE', j => j.component, 16],
      ['EVALUADOR_COD', j => j.specialist, 12], ['EVALUADOR', j => j.person, 24], ['FECHA', j => j.date, 11],
      ['N_ESTACIONES', (j, x) => x.st.filter(s => s.jornada_id === j.id && !s.voided).length, 12],
      ['N_FOTOS', (j, x) => x.ph.filter(p => p.jornada_id === j.id && !p.voided).length, 9],
      ['N_AUDIOS', (j, x) => x.au.filter(a => a.jornada_id === j.id && !a.voided).length, 9],
      ['INICIO', j => j.created_at, 22], ['CIERRE', j => j.closed_at || '', 22], ['VERSION_APP', j => j.app_version, 10],
    ],
    ESTACIONES: [
      ['ID_ESTACION', s => s.id, 38], ['ID_JORNADA', s => s.jornada_id, 38], ['PROYECTO', s => s.project, 12], ['CAMPANA', s => s.campaign, 12],
      ['COMPONENTE', s => s.component, 16], ['EVALUADOR_COD', s => s.specialist, 12], ['EVALUADOR', s => s.person, 22], ['FECHA', s => s.date, 11],
      ['HORA', s => hhmm(s.time_local), 9], ['ESTACION', s => s.station, 14], ['LUGAR', s => s.place, 22], ['OBSERVACIONES', s => s.notes, 50],
      ['LATITUD', s => num(s.lat), 12], ['LONGITUD', s => num(s.lon), 12], ['ALTITUD_M', s => num(r1(s.alt)), 10], ['PRECISION_M', s => num(r1(s.accuracy)), 10],
      ['UTM_ZONA', s => s.utm_zone, 8], ['UTM_ESTE', s => num(s.utm_e), 12], ['UTM_NORTE', s => num(s.utm_n), 13],
      ['PUNTO_KML_CERCANO', s => s.nearest_feature, 16], ['DIST_PUNTO_KML_M', s => num(s.nearest_dist_m != null ? Math.round(s.nearest_dist_m) : null), 10],
      ['N_FOTOS', (s, x) => x.ph.filter(p => p.station_id === s.id && !p.voided).length, 8],
      ['N_AUDIOS', (s, x) => x.au.filter(a => a.station_id === s.id && !a.voided).length, 8],
      ['FOTOS', (s, x) => x.ph.filter(p => p.station_id === s.id && !p.voided).map(p => p.photo_name + '.jpg').join('; '), 40],
      ['AUDIOS', (s, x) => x.au.filter(a => a.station_id === s.id && !a.voided).map(a => a.file_name).join('; '), 30],
      ['QAQC', qaTxt, 30], ['ANULADO', s => s.voided ? 'SI' : 'NO', 8], ['EDITADO', s => s.edited_at || '', 20],
    ],
    FOTOS: [
      ['ID_FOTO', p => p.id, 38], ['ID_ESTACION', p => p.station_id, 38], ['PROYECTO', p => p.project, 12], ['CAMPANA', p => p.campaign, 12],
      ['COMPONENTE', p => p.component, 16], ['EVALUADOR_COD', p => p.specialist, 12], ['ESTACION', p => p.station, 14], ['N_FOTO', p => p.n, 7],
      ['LEYENDA', p => p.caption, 40], ['FECHA', p => (p.time_local || '').slice(0, 10), 11], ['HORA', p => hhmm(p.time_local), 9], ['FECHA_HORA_UTC', p => p.time_utc, 22],
      ['LATITUD', p => num(p.lat), 12], ['LONGITUD', p => num(p.lon), 12], ['ALTITUD_M', p => num(r1(p.alt)), 10], ['PRECISION_M', p => num(r1(p.accuracy)), 10],
      ['UTM_ZONA', p => p.utm_zone, 8], ['UTM_ESTE', p => num(p.utm_e), 12], ['UTM_NORTE', p => num(p.utm_n), 13],
      ['RUMBO_MAG_APROX', p => num(p.heading != null ? Math.round(p.heading) : null), 10],
      ['ARCHIVO', p => p.photo_name + '.jpg', 40], ['ARCHIVO_ORIGINAL', p => p.photo_name + '_original.jpg', 40], ['SHA256_ORIGINAL', p => p.sha256_original, 20],
      ['MODO', p => p.camera_mode, 9], ['INCLUIDA_EN_PRODUCTOS', p => p.send === false || p.voided ? 'NO' : 'SI', 12],
      ['QAQC', qaTxt, 30], ['ANULADA', p => p.voided ? 'SI' : 'NO', 8], ['ESTADO', statusTxt, 14], ['VERSION_APP', p => p.app_version, 9],
    ],
    AUDIOS: [
      ['ID_AUDIO', a => a.id, 38], ['ID_ESTACION', a => a.station_id, 38], ['PROYECTO', a => a.project, 12], ['CAMPANA', a => a.campaign, 12],
      ['EVALUADOR_COD', a => a.specialist, 12], ['ESTACION', a => a.station, 14], ['N_AUDIO', a => a.n, 8],
      ['FECHA', a => (a.time_local || '').slice(0, 10), 11], ['HORA', a => hhmm(a.time_local), 9], ['DURACION_S', a => num(a.duration_s), 10],
      ['ARCHIVO', a => a.file_name, 40], ['FORMATO', a => a.mime, 18], ['ANULADO', a => a.voided ? 'SI' : 'NO', 8], ['ESTADO', statusTxt, 14],
    ],
  };
  const rowsOf = (cols, list, x) => [cols.map(c => c[0]), ...list.map(o => cols.map(c => { try { const v = c[1](o, x); return v ?? ''; } catch (_) { return ''; } }))];
  const wOf = cols => cols.map(c => c[2]);
  const byTime = (a, b) => (a.time_utc || a.created_at || '').localeCompare(b.time_utc || b.created_at || '');

  function qaRows(x) {
    const rows = [['TIPO', 'ID', 'EVALUADOR', 'ESTACION', 'FECHA', 'OBSERVACION_QAQC']];
    for (const s of x.st) {
      for (const q of (s.qa || [])) rows.push(['ESTACION', s.id, s.specialist, s.station, s.date, q]);
      if (!s.voided && !x.ph.some(p => p.station_id === s.id && !p.voided)) rows.push(['ESTACION', s.id, s.specialist, s.station, s.date, 'Estación sin fotografías']);
      if (!s.voided && !(s.notes || '').trim() && !x.au.some(a => a.station_id === s.id && !a.voided)) rows.push(['ESTACION', s.id, s.specialist, s.station, s.date, 'Estación sin observaciones ni notas de voz']);
    }
    for (const p of x.ph) for (const q of (p.qa || [])) rows.push(['FOTO', p.id, p.specialist, p.station, (p.time_local || '').slice(0, 16).replace('T', ' '), q]);
    return rows;
  }
  function summaryRows(x) {
    const rows = [['AGRUPACION', 'VALOR', 'ESTACIONES', 'FOTOS', 'AUDIOS']];
    for (const [label, key] of [['Evaluador', 'specialist'], ['Componente', 'component'], ['Fecha', 'date'], ['Estación', 'station']]) {
      const m = new Map();
      const add = (k, i) => { k = k || '(vacío)'; const a = m.get(k) || [0, 0, 0]; a[i]++; m.set(k, a); };
      x.st.filter(s => !s.voided).forEach(s => add(s[key], 0));
      x.ph.filter(p => !p.voided).forEach(p => add(key === 'date' ? (p.date || (p.time_local || '').slice(0, 10)) : p[key], 1));
      x.au.filter(a => !a.voided).forEach(a => add(key === 'date' ? (a.date || (a.time_local || '').slice(0, 10)) : a[key], 2));
      [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'es', { numeric: true })).forEach(([k, a]) => rows.push([label, k, ...a]));
    }
    return rows;
  }
  /* d = {jornadas, stations, photos, audios} */
  function norm(d) {
    return { jo: [...(d.jornadas || [])].sort(byTime), st: [...(d.stations || [])].sort(byTime), ph: [...(d.photos || [])].sort(byTime), au: [...(d.audios || [])].sort(byTime) };
  }
  async function matrix(d, extra = []) {
    const x = norm(d);
    return xlsx([
      { name: 'JORNADAS', rows: rowsOf(C.JORNADAS, x.jo, x), widths: wOf(C.JORNADAS) },
      { name: 'ESTACIONES', rows: rowsOf(C.ESTACIONES, x.st, x), widths: wOf(C.ESTACIONES) },
      { name: 'FOTOS', rows: rowsOf(C.FOTOS, x.ph, x), widths: wOf(C.FOTOS) },
      { name: 'AUDIOS', rows: rowsOf(C.AUDIOS, x.au, x), widths: wOf(C.AUDIOS) },
      { name: 'RESUMEN', rows: summaryRows(x), widths: [14, 24, 11, 9, 9] },
      { name: 'QAQC', rows: qaRows(x), widths: [10, 38, 12, 14, 17, 50] },
      ...extra,
    ]);
  }

  /* ---------- KMZ: 1 punto por estación, todas sus fotos en el globo, carpetas por día ---------- */
  async function kmz(d, getThumb, name = 'Alba Field') {
    const z = new JSZip(), x = norm(d);
    const days = new Map();
    for (const s of x.st.filter(s => !s.voided && s.lat != null)) { const k = s.date || (s.time_local || '').slice(0, 10); if (!days.has(k)) days.set(k, []); days.get(k).push(s); }
    let folders = '';
    for (const [day, sts] of [...days.entries()].sort()) {
      let pms = '';
      for (const s of sts) {
        const phs = x.ph.filter(p => p.station_id === s.id && !p.voided && p.send !== false);
        const aus = x.au.filter(a => a.station_id === s.id && !a.voided);
        let imgs = '';
        for (const p of phs) {
          const t = getThumb ? await getThumb(p) : null;
          if (t) { const f = `files/${p.photo_name}.jpg`; z.file(f, t, { compression: 'STORE' }); imgs += `<p><img src="${f}" width="420"/><br/><b>Foto ${p.n}</b>${p.caption ? ' · ' + esc(p.caption) : ''}</p>`; }
        }
        const rows = [['Estación', s.station], ['Componente', s.component], ['Evaluador', s.person || s.specialist], ['Fecha', `${dmy(s.date)} ${hhmm(s.time_local).slice(0, 5)}`], ['Lugar', s.place],
          ['Observaciones', s.notes], ['UTM', s.utm_zone ? `${s.utm_zone} ${Math.round(s.utm_e)} E / ${Math.round(s.utm_n)} N` : ''], ['Precisión', s.accuracy != null ? `±${Math.round(s.accuracy)} m` : ''],
          ['Fotos', phs.length], ['Notas de voz', aus.map(a => a.file_name).join(', ')], ['QA/QC', qaTxt(s)]]
          .filter(r => r[1] !== '' && r[1] != null).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('');
        const ext = C.ESTACIONES.slice(2, 21).map(([h, f]) => { let v = ''; try { v = f(s, x); } catch (_) {} return `<Data name="${h}"><value>${esc(v)}</value></Data>`; }).join('');
        pms += `<Placemark><name>${esc(s.station)}</name><styleUrl>#est</styleUrl><TimeStamp><when>${esc(s.time_utc || '')}</when></TimeStamp><description><![CDATA[<table>${rows}</table>${imgs}]]></description><ExtendedData>${ext}</ExtendedData><Point><coordinates>${s.lon},${s.lat}${s.alt != null ? ',' + s.alt.toFixed(1) : ''}</coordinates></Point></Placemark>`;
      }
      folders += `<Folder><name>${esc(dmy(day))}</name>${pms}</Folder>`;
    }
    const st = `<Style id="est"><IconStyle><color>ff4f9e2d</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle><LabelStyle><scale>0.8</scale></LabelStyle></Style>`;
    z.file('doc.kml', `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(name)}</name>${st}${folders}</Document></kml>`);
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.google-earth.kmz' });
  }

  /* ---------- Galería fotográfica Word: 2 fotos por página con tabla de datos ---------- */
  const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const run = (t, o = {}) => `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}<w:sz w:val="${o.sz || 18}"/><w:szCs w:val="${o.sz || 18}"/>${o.color ? `<w:color w:val="${o.color}"/>` : ''}</w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const para = (runs, o = {}) => `<w:p><w:pPr>${o.keep ? '<w:keepNext/>' : ''}<w:spacing w:before="${o.before || 0}" w:after="${o.after || 0}"/>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}</w:pPr>${runs}</w:p>`;
  const cell = (inner, o = {}) => `<w:tc><w:tcPr><w:tcW w:w="${o.w || 4819}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>${inner}</w:tc>`;
  const kv = (k, v) => para(run(k + ': ', { b: true }) + run(v || '—'), { keep: true });
  function drawing(rid, id, cx, cy, name) {
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="${esc(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${esc(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  }
  /* getImage(photo) → {blob, w, h} (JPEG reducido). meta = {title, subtitle} */
  async function gallery(d, getImage, meta = {}, progress) {
    const x = norm(d), z = new JSZip();
    const stById = new Map(x.st.map(s => [s.id, s]));
    const phs = x.ph.filter(p => !p.voided && p.send !== false && !(stById.get(p.station_id) || {}).voided)
      .sort((a, b) => ((stById.get(a.station_id) || {}).time_utc || '').localeCompare((stById.get(b.station_id) || {}).time_utc || '') || (a.n - b.n));
    if (!phs.length) throw new Error('No hay fotografías seleccionadas para la galería');
    const EMU = 360000, maxW = 15.6 * EMU, maxH = 8.4 * EMU;
    const border = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="7F8C83"/>`).join('') + '</w:tblBorders>';
    let body = para(run(meta.title || 'Galería fotográfica', { b: true, sz: 28, color: '1F3B2D' }), { jc: 'center', after: 60 })
      + para(run(meta.subtitle || '', { sz: 20 }), { jc: 'center', after: 200 });
    const rels = [];
    for (const [i, p] of phs.entries()) {
      progress && progress(i + 1, phs.length);
      const s = stById.get(p.station_id) || {};
      const im = await getImage(p);
      let cellImg = para(run('(imagen no disponible)'), { jc: 'center' });
      if (im && im.blob) {
        const k = Math.min(maxW / im.w, maxH / im.h);
        const rid = 'rIdImg' + (i + 1), fn = `media/foto${i + 1}.jpg`;
        z.file('word/' + fn, im.blob, { compression: 'STORE' }); rels.push([rid, fn]);
        cellImg = para(drawing(rid, i + 1, Math.round(im.w * k), Math.round(im.h * k), p.photo_name), { jc: 'center', keep: true });
      }
      const utm = p.utm_zone ? `${p.utm_zone} · ${Math.round(p.utm_e)} E · ${Math.round(p.utm_n)} N` : '';
      const desc = [p.caption, s.notes].filter(Boolean).join(' — ');
      body += `<w:tbl><w:tblPr><w:tblW w:w="9638" w:type="dxa"/><w:jc w:val="center"/>${border}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="4819"/><w:gridCol w:w="4819"/></w:tblGrid>`
        + `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(cellImg, { span: 2, w: 9638 })}</w:tr>`
        + `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(kv('Fotografía N°', String(i + 1)), { fill: 'E8F1EA' })}${cell(kv('Estación', p.station), { fill: 'E8F1EA' })}</w:tr>`
        + `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(kv('Fecha', `${dmy((p.time_local || '').slice(0, 10))} ${hhmm(p.time_local).slice(0, 5)}`))}${cell(kv('UTM WGS84', utm))}</w:tr>`
        + `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(kv('Descripción', desc), { span: 2, w: 9638 })}</w:tr></w:tbl>`;
      const last = i === phs.length - 1;
      body += last ? '' : (i % 2 === 1 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : para('', { after: 240 }));
    }
    const sect = `<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>`;
    z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W_NS}><w:body>${body}${sect}</w:body></w:document>`);
    z.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W_NS}>${para(run(meta.header || meta.title || '', { sz: 16, color: '5B665F' }), { jc: 'right' })}</w:hdr>`);
    z.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W_NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${run('Página ', { sz: 16 })}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:t>1</w:t></w:r><w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>${run(' · Generado con Alba Field', { sz: 16, color: '5B665F' })}</w:p></w:ftr>`);
    z.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="18"/><w:lang w:val="es-PE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`);
    z.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${rels.map(([id, t]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${t}"/>`).join('')}</Relationships>`);
    z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`);
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- migración de registros 1.x (1 foto = 1 registro) al modelo jornada → estación → fotos ---------- */
  function migrateV1(records, uid) {
    const jornadas = new Map(), stations = new Map(), photos = [];
    for (const r of [...records].sort((a, b) => (a.time_utc || '').localeCompare(b.time_utc || ''))) {
      const date = (r.time_local || '').slice(0, 10), P = String(r.project || '').toUpperCase(), K = String(r.campaign || '').toUpperCase();
      const jk = [P, K, r.specialist, date].join('|');
      if (!jornadas.has(jk)) jornadas.set(jk, { id: uid(), project: P, campaign: K, component: r.component || '', specialist: r.specialist, person: r.person || '', date, created_at: r.created_at || r.time_utc, closed_at: r.created_at, app_version: r.app_version, migrated: true });
      const j = jornadas.get(jk);
      const sk = jk + '|' + r.station;
      if (!stations.has(sk)) stations.set(sk, { id: uid(), jornada_id: j.id, project: P, campaign: K, component: r.component || '', specialist: r.specialist, person: r.person || '', date, station: r.station, place: r.place || '', notes: '',
        lat: r.lat, lon: r.lon, alt: r.alt, accuracy: r.accuracy, utm_zone: r.utm_zone, utm_e: r.utm_e, utm_n: r.utm_n, nearest_feature: r.nearest_feature, nearest_dist_m: r.nearest_dist_m,
        time_local: r.time_local, time_utc: r.time_utc, created_at: r.created_at, saved_at: r.created_at, qa: [], migrated: true, _n: 0 });
      const s = stations.get(sk);
      const note = [r.notes, r.action ? 'Acción: ' + r.action : ''].filter(Boolean).join(' · ');
      if (note && !s.notes.includes(note)) s.notes = [s.notes, note].filter(Boolean).join(' | ');
      photos.push({ ...r, project: P, campaign: K, station_id: s.id, jornada_id: j.id, date, n: ++s._n, caption: [r.category, r.notes].filter(Boolean).join(' · '), send: !r.voided, migrated: true });
    }
    const st = [...stations.values()].map(({ _n, ...s }) => s);
    return { jornadas: [...jornadas.values()], stations: st, photos, audios: [] };
  }

  function leeme(meta) {
    return `Alba Field – paquete de entrega
Generado: ${new Date().toISOString()}  (app ${meta.app})
Contenido: ${meta.counts}

Estructura (igual a la carpeta de Google Drive)
PROYECTO/CAMPAÑA/COMPONENTE/EVALUADOR/FECHA/
  FOTOS/        fotografías rotuladas con EXIF GPS (WGS84). El nombre coincide con la columna ARCHIVO de la hoja FOTOS.
  FOTOS/ORIGINALES/  fotografías originales sin modificar (huella SHA-256 en la matriz), si se incluyeron.
  AUDIOS/       notas de voz de cada estación.
  PRODUCTOS/    matriz Excel (JORNADAS, ESTACIONES, FOTOS, AUDIOS, RESUMEN, QAQC), KMZ por estación y galería fotográfica Word.
datos.json      datos completos: sirve para consolidar el equipo y para restaurar en otro teléfono.

Coordenadas: WGS84 (EPSG:4326) y UTM WGS84 calculado en el equipo.
Rumbo: magnético aproximado según el sensor del teléfono; no reemplaza un azimut con instrumento.
`;
  }

  /* Paquete ZIP. groups: [{path:[…], base, data:{jornadas,stations,photos,audios}}]; files(photo|audio) → blobs; products(group) → [[name, blob]] */
  async function pack(groups, { getPhoto, getAudio, products, includeOriginals, app, progress }) {
    const z = new JSZip(), all = { jornadas: [], stations: [], photos: [], audios: [] };
    let i = 0; const total = groups.reduce((n, g) => n + g.data.photos.length + g.data.audios.length, 0);
    for (const g of groups) {
      const dir = g.path.join('/') + '/';
      for (const p of g.data.photos) {
        const b = await getPhoto(p);
        if (b && b.stamped) z.file(`${dir}FOTOS/${p.photo_name}.jpg`, b.stamped, { compression: 'STORE' });
        if (includeOriginals && b && b.original) z.file(`${dir}FOTOS/ORIGINALES/${p.photo_name}_original.jpg`, b.original, { compression: 'STORE' });
        progress && progress(++i, total);
      }
      for (const a of g.data.audios) { const b = await getAudio(a); if (b && b.audio) z.file(`${dir}AUDIOS/${a.file_name}`, b.audio, { compression: 'STORE' }); progress && progress(++i, total); }
      for (const [n, blob] of await products(g)) z.file(`${dir}PRODUCTOS/${n}`, blob, { compression: 'STORE' });
      for (const k of Object.keys(all)) all[k].push(...g.data[k]);
    }
    z.file('datos.json', JSON.stringify({ schema: 'albafield/2', app, generated_utc: new Date().toISOString(), ...all }, null, 1));
    z.file('LEEME.txt', leeme({ app, counts: `${all.jornadas.length} jornadas, ${all.stations.length} estaciones, ${all.photos.length} fotos, ${all.audios.length} audios` }));
    return z.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  }

  /* Consolidación del coordinador: ZIP de Alba Field o datos*.json (versión 1 o 2) */
  async function consolidate(files, log, uid) {
    const maps = { jornadas: new Map(), stations: new Map(), photos: new Map(), audios: new Map() }, conflicts = [], sources = [];
    const strip = o => { const { uploaded_at, sync_error, send, ...rest } = o; return JSON.stringify(rest); };
    for (const f of files) {
      let data;
      try {
        if (/\.json$/i.test(f.name)) data = JSON.parse(await f.text());
        else {
          const zip = await JSZip.loadAsync(f);
          const j = zip.file('datos.json') || Object.values(zip.files).find(x => /(^|\/)datos[^/]*\.json$/.test(x.name));
          if (!j) throw new Error('no contiene datos.json');
          data = JSON.parse(await j.async('string'));
        }
        if (data && Array.isArray(data.records)) data = migrateV1(data.records, uid);
        if (!data || !Array.isArray(data.stations)) throw new Error('formato no reconocido');
      } catch (e) { log(`✗ ${f.name}: ${e.message}`); continue; }
      let n = 0, dup = 0;
      for (const k of Object.keys(maps)) for (const o of (data[k] || [])) {
        if (!o || !o.id) continue;
        const prev = maps[k].get(o.id);
        if (!prev) { maps[k].set(o.id, o); n++; }
        else if (strip(prev) === strip(o)) dup++;
        else { const keep = (o.edited_at || '') > (prev.edited_at || '') ? o : prev; maps[k].set(o.id, keep); conflicts.push([k.toUpperCase(), o.id, o.specialist, o.station || '', 'Mismo ID con datos distintos; se conservó la edición más reciente']); }
      }
      sources.push([f.name, (data.jornadas || []).map(j => j.specialist).filter((v, i, a) => a.indexOf(v) === i).join(', '), data.generated_utc || '', (data.stations || []).length, (data.photos || []).length, n, dup]);
      log(`✓ ${f.name}: ${n} elementos nuevos, ${dup} repetidos`);
    }
    const d = Object.fromEntries(Object.entries(maps).map(([k, m]) => [k, [...m.values()]]));
    if (!d.stations.length) throw new Error('No se encontraron estaciones');
    const bySha = new Map();
    for (const p of d.photos) if (p.sha256_original) { const a = bySha.get(p.sha256_original) || []; a.push(p); bySha.set(p.sha256_original, a); }
    for (const a of bySha.values()) if (a.length > 1) for (const p of a) p.qa = [...new Set([...(p.qa || []), `Foto idéntica en ${a.length} registros`])];
    const out = new JSZip();
    out.file('GENERAL.xlsx', await matrix(d, [
      { name: 'CONFLICTOS', rows: [['TIPO', 'ID', 'EVALUADOR', 'ESTACION', 'DETALLE'], ...conflicts], widths: [10, 38, 12, 14, 60] },
      { name: 'FUENTES', rows: [['ARCHIVO', 'EVALUADORES', 'GENERADO_UTC', 'ESTACIONES', 'FOTOS', 'NUEVOS', 'REPETIDOS'], ...sources], widths: [50, 16, 24, 11, 9, 9, 10] },
    ]));
    out.file('GENERAL.kmz', await kmz(d, null, 'Alba Field GENERAL'));
    out.file('datos_general.json', JSON.stringify({ schema: 'albafield/2', consolidated_utc: new Date().toISOString(), ...d }, null, 1));
    const esps = [...new Set(d.stations.map(s => s.specialist))].sort();
    return { blob: await out.generateAsync({ type: 'blob', compression: 'DEFLATE' }), name: `AlbaField_GENERAL_${stampNow()}.zip`, stations: d.stations.length, photos: d.photos.length, esps, conflicts: conflicts.length };
  }

  return { xlsx, matrix, kmz, gallery, pack, consolidate, migrateV1, stampNow };
})();
