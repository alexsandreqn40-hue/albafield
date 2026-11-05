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

  /* Genera la copia rotulada.
     p = metadatos de la foto (lat, lon, heading…); lines = textos de la banda ya armados según la configuración del proyecto.
     cfg = { logoPos: tl|tr|bl|br, logoSize: % del ancho, logoBg: bool, bandPos: top|bottom } */
  async function stamp(original, p, { lines = [], logo = null, cfg = {}, north = true, quality = 0.9 } = {}) {
    const img = await loadImg(original);
    const s = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * s), H = Math.round(img.naturalHeight * s);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, W, H);
    drawOverlay(g, W, H, p, { lines, cfg, north, logoImg: logo ? await loadImg(logo).catch(() => null) : null });
    let blob = await toBlob(c, quality);
    if (p && p.lat != null) { try { blob = await writeExif(blob, p); } catch (e) { console.warn('EXIF no escrito', e); } }
    return { blob, width: W, height: H };
  }

  /* Dibuja banda de datos, logo y norte sobre un lienzo (se usa también para la vista previa en Ajustes). */
  function drawOverlay(g, W, H, p, { lines, cfg = {}, north, logoImg }) {
    const bandTop = cfg.bandPos === 'top';
    const fs = Math.max(14, Math.round(Math.min(W, H) / 34));
    g.font = `600 ${fs}px system-ui, -apple-system, Roboto, sans-serif`;
    const txt = (lines || []).filter(Boolean).map(t => fit(g, t, W - fs * 2));
    const lh = Math.round(fs * 1.35), pad = Math.round(fs * 0.8);
    const bandH = txt.length ? txt.length * lh + pad * 2 : 0;
    if (bandH) {
      const y0 = bandTop ? 0 : H - bandH;
      const st = cfg.textStyle || 'outline';   // outline: sin fondo | dark: banda oscura | light: banda clara
      if (st === 'dark') { g.fillStyle = 'rgba(0,0,0,0.62)'; g.fillRect(0, y0, W, bandH); }
      if (st === 'light') { g.fillStyle = 'rgba(255,255,255,0.78)'; g.fillRect(0, y0, W, bandH); }
      g.textBaseline = 'top'; g.textAlign = 'left'; g.lineJoin = 'round';
      txt.forEach((t, i) => {
        const y = y0 + pad + i * lh;
        if (st === 'light') { g.fillStyle = '#111'; g.fillText(t, fs, y); return; }
        if (st === 'outline') { g.lineWidth = Math.max(3, fs * 0.22); g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(t, fs, y); }
        g.fillStyle = '#fff'; g.fillText(t, fs, y);
      });
    }
    const pos = cfg.logoPos || 'tr';
    const logoTop = pos[0] === 't', logoLeft = pos[1] === 'l';
    let logoBox = null;
    if (logoImg) {
      const lw = Math.round(W * Math.min(45, Math.max(5, +cfg.logoSize || 20)) / 100);
      const lhh = Math.round(lw * logoImg.naturalHeight / logoImg.naturalWidth);
      const m = fs, bg = cfg.logoBg !== false ? 8 : 0;
      const x = logoLeft ? m + bg : W - lw - m - bg;
      let y = logoTop ? m + bg : H - lhh - m - bg;
      if (logoTop && bandTop) y += bandH; if (!logoTop && !bandTop) y -= bandH;
      if (bg) { g.fillStyle = 'rgba(255,255,255,0.92)'; g.fillRect(x - bg, y - bg, lw + bg * 2, lhh + bg * 2); }
      g.drawImage(logoImg, x, y, lw, lhh);
      logoBox = { top: logoTop, left: logoLeft };
    }
    if (north && p && p.heading != null) {
      const r = Math.round(Math.min(W, H) * 0.05);
      // esquina libre: del lado contrario a la banda; si el logo ocupa esa fila, al otro costado
      const top = !bandTop;
      const left = logoBox && logoBox.top === top ? !logoBox.left : true;
      const cx = left ? fs + r * 1.3 : W - fs - r * 1.3;
      const cy = top ? fs + r * 1.6 : H - fs - r * 1.3;
      g.save(); g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(cx, cy, r * 1.3, 0, Math.PI * 2); g.fill();
      g.translate(cx, cy); g.rotate(-p.heading * Math.PI / 180);
      g.beginPath(); g.moveTo(0, -r); g.lineTo(r * 0.45, r * 0.75); g.lineTo(0, r * 0.4); g.lineTo(-r * 0.45, r * 0.75); g.closePath();
      g.fillStyle = '#c0392b'; g.fill();
      g.fillStyle = '#111'; g.font = `700 ${Math.round(r * 0.55)}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText('N', 0, -r * 1.02); g.restore();
    }
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
    zero[P.ImageIFD.ImageDescription] = ascii(`${rec.project}/${rec.campaign}/${rec.specialist}/${rec.station} ${rec.caption || rec.component || ''}`).slice(0, 250);
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

  return { fmtOffset, stamp, drawOverlay, thumb, sha256, exifDate, loadImg, readDataURL };
})();
