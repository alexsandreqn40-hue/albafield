/* Alba Field · fotografía: rótulo, EXIF GPS, miniaturas y huella SHA-256 del original. */
const Photo = (() => {
  async function loadImg(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();           // los navegadores actuales aplican la orientación EXIF
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
  function toBlob(canvas, q) { return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('No se pudo generar la imagen')), 'image/jpeg', q)); }

  async function sha256(blob) {
    const h = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function thumb(blob, max = 640, q = 0.75) {
    const img = await loadImg(blob);
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return toBlob(c, q);
  }

  function fmtOffset(min) { const s = min >= 0 ? '+' : '-', a = Math.abs(min); return `UTC${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`; }

  /* Genera la copia rotulada. rec = registro ya con coordenadas; logo = Blob o null. */
  async function stamp(original, rec, { logo = null, north = true, quality = 0.9 } = {}) {
    const img = await loadImg(original);
    const s = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * s), H = Math.round(img.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, W, H);
    const fs = Math.max(14, Math.round(Math.min(W, H) / 34));
    g.font = `600 ${fs}px system-ui, -apple-system, Roboto, sans-serif`;
    const lines = [
      `${rec.project} · ${rec.campaign} · ${rec.specialist}${rec.person ? ' · ' + rec.person : ''}`,
      `Estación: ${rec.station}  |  ${rec.component}${rec.category ? ' · ' + rec.category : ''}`,
      rec.place ? `Lugar: ${rec.place}` : null,
      `${rec.time_local.replace('T', ' ').slice(0, 19)} (${fmtOffset(rec.utc_offset_minutes)})`,
      `WGS84: ${rec.lat.toFixed(6)}, ${rec.lon.toFixed(6)}  ±${rec.accuracy.toFixed(0)} m${rec.alt != null ? '  ·  ' + Math.round(rec.alt) + ' msnm' : ''}`,
      `UTM ${rec.utm_zone}: E ${Math.round(rec.utm_e)}  N ${Math.round(rec.utm_n)}`,
      north ? `Rumbo cámara (magnético aprox.): ${rec.heading == null ? 'no disponible' : Math.round(rec.heading) + '°'}` : null,
    ].filter(Boolean).map(t => fit(g, t, W - fs * 2));
    const lh = Math.round(fs * 1.35), pad = Math.round(fs * 0.8);
    const bandH = lines.length * lh + pad * 2;
    g.fillStyle = 'rgba(0,0,0,0.62)'; g.fillRect(0, H - bandH, W, bandH);
    g.fillStyle = '#fff'; g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, fs, H - bandH + pad + i * lh));

    if (logo) {
      try {
        const li = await loadImg(logo);
        const lw = Math.round(W * 0.2), lhh = Math.round(lw * li.naturalHeight / li.naturalWidth);
        const x = W - lw - fs, y = fs;
        g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(x - 8, y - 8, lw + 16, lhh + 16);
        g.drawImage(li, x, y, lw, lhh);
      } catch (_) { /* logo dañado: se omite sin bloquear la captura */ }
    }
    if (north && rec.heading != null) {
      const r = Math.round(Math.min(W, H) * 0.05), cx = fs + r * 1.3, cy = fs + r * 1.3;
      g.save(); g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(cx, cy, r * 1.3, 0, Math.PI * 2); g.fill();
      g.translate(cx, cy); g.rotate(-rec.heading * Math.PI / 180);
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.45, r * 0.75); g.lineTo(0, r * 0.4); g.lineTo(-r * 0.45, r * 0.75); g.closePath();
      g.fillStyle = '#c0392b'; g.fill();
      g.fillStyle = '#111'; g.font = `700 ${Math.round(r * 0.55)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText('N', 0, -r * 1.02); g.restore();
    }
    let blob = await toBlob(c, quality);
    try { blob = await writeExif(blob, rec); } catch (e) { console.warn('EXIF no escrito', e); }
    return { blob, width: W, height: H };
  }
  function fit(g, t, max) { if (g.measureText(t).width <= max) return t; while (t.length > 4 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t + '…'; }

  const ascii = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');
  function readDataURL(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
  function dataURLtoBlob(u) { const b = atob(u.split(',')[1]); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new Blob([a], { type: 'image/jpeg' }); }

  /* EXIF con GPS y fecha en la copia rotulada → la leen QGIS (ImportPhotos), Google Earth, exifr (Etapa 1). */
  async function writeExif(blob, rec) {
    const P = window.piexif; if (!P) return blob;
    const d = new Date(rec.time_utc);
    const loc = rec.time_local.slice(0, 19).replace('T', ' ').replace(/-/g, ':');
    const zero = {}, exif = {}, gps = {};
    zero[P.ImageIFD.Make] = 'Alba Field'; zero[P.ImageIFD.Software] = 'Alba Field ' + rec.app_version;
    zero[P.ImageIFD.ImageDescription] = ascii(`${rec.project}/${rec.campaign}/${rec.specialist}/${rec.station} ${rec.component}`).slice(0, 250);
    zero[P.ImageIFD.Artist] = ascii(rec.person || rec.specialist).slice(0, 64);
    zero[P.ImageIFD.DateTime] = loc; zero[P.ImageIFD.Orientation] = 1;
    exif[P.ExifIFD.DateTimeOriginal] = loc; exif[P.ExifIFD.DateTimeDigitized] = loc;
    exif[P.ExifIFD.UserComment] = 'ASCII\0\0\0' + ascii(`id=${rec.id}`);
    gps[P.GPSIFD.GPSVersionID] = [2, 3, 0, 0];
    gps[P.GPSIFD.GPSLatitudeRef] = rec.lat < 0 ? 'S' : 'N'; gps[P.GPSIFD.GPSLatitude] = P.GPSHelper.degToDmsRational(Math.abs(rec.lat));
    gps[P.GPSIFD.GPSLongitudeRef] = rec.lon < 0 ? 'W' : 'E'; gps[P.GPSIFD.GPSLongitude] = P.GPSHelper.degToDmsRational(Math.abs(rec.lon));
    if (rec.alt != null) { gps[P.GPSIFD.GPSAltitudeRef] = rec.alt < 0 ? 1 : 0; gps[P.GPSIFD.GPSAltitude] = [Math.round(Math.abs(rec.alt) * 100), 100]; }
    if (rec.heading != null) { gps[P.GPSIFD.GPSImgDirectionRef] = 'M'; gps[P.GPSIFD.GPSImgDirection] = [Math.round(rec.heading * 100), 100]; }
    gps[P.GPSIFD.GPSDateStamp] = `${d.getUTCFullYear()}:${String(d.getUTCMonth() + 1).padStart(2, '0')}:${String(d.getUTCDate()).padStart(2, '0')}`;
    gps[P.GPSIFD.GPSTimeStamp] = [[d.getUTCHours(), 1], [d.getUTCMinutes(), 1], [d.getUTCSeconds(), 1]];
    gps[P.GPSIFD.GPSMapDatum] = 'WGS-84';
    const bytes = P.dump({ '0th': zero, Exif: exif, GPS: gps });
    return dataURLtoBlob(P.insert(bytes, await readDataURL(blob)));
  }

  /* Fecha EXIF del original (cuando viene de la cámara del sistema) para control QA. */
  async function exifDate(blob) {
    try {
      const P = window.piexif;
      const head = await readDataURL(blob.slice(0, 256 * 1024, 'image/jpeg'));
      const o = P.load(head);
      const s = (o.Exif && o.Exif[P.ExifIFD.DateTimeOriginal]) || (o['0th'] && o['0th'][P.ImageIFD.DateTime]);
      if (!s) return null;
      const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(s);
      return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
    } catch (_) { return null; }
  }

  return { stamp, thumb, sha256, exifDate, loadImg };
})();
