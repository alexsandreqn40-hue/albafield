/* Alba Field · utilidades geográficas: UTM WGS84, distancias, lectura KML/KMZ, rumbo. */
const Geo = (() => {
  const R = Math.PI / 180;

  /* WGS84 → UTM (zona automática; hemisferio sur con falso norte 10 000 000). Precisión sub-métrica. */
  function toUTM(lat, lon) {
    const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
    const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
    let zone = Math.floor((lon + 180) / 6) + 1;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
    const lon0 = ((zone - 1) * 6 - 180 + 3) * R;
    const φ = lat * R, λ = lon * R;
    const N = a / Math.sqrt(1 - e2 * Math.sin(φ) ** 2);
    const T = Math.tan(φ) ** 2, C = ep2 * Math.cos(φ) ** 2, A = Math.cos(φ) * (λ - lon0);
    const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * φ
      - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * φ)
      + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * φ)
      - (35 * e2 ** 3 / 3072) * Math.sin(6 * φ));
    let E = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T ** 2 + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
    let Nn = k0 * (M + N * Math.tan(φ) * (A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
      + (61 - 58 * T + T ** 2 + 600 * C - 330 * ep2) * A ** 6 / 720));
    if (lat < 0) Nn += 10000000;
    return { zone: zone + (lat < 0 ? 'S' : 'N'), e: Math.round(E * 100) / 100, n: Math.round(Nn * 100) / 100 };
  }

  function dist(lat1, lon1, lat2, lon2) {
    const dφ = (lat2 - lat1) * R, dλ = (lon2 - lon1) * R;
    const h = Math.sin(dφ / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin(dλ / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(h));
  }

  /* Rumbo hacia donde apunta la cámara trasera (W3C DeviceOrientation, ejemplo de la especificación).
     Con el teléfono plano se usa el borde superior. Magnético y aproximado. */
  function cameraHeading(alpha, beta, gamma) {
    const x = (beta || 0) * R, y = (gamma || 0) * R, z = (alpha || 0) * R;
    const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z), sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);
    const Vx = -cZ * sY - sZ * sX * cY, Vy = -sZ * sY + cZ * sX * cY;
    if (Math.hypot(Vx, Vy) < 0.25) return (360 - alpha) % 360; // casi plano
    let h = Math.atan2(Vx, Vy) / R;
    return (h + 360) % 360;
  }

  /* KML/KMZ → lista de entidades {name, desc, type: Point|LineString|Polygon, coords:[[lat,lon]...], holes:[...]} */
  async function readKmlFile(file) {
    let text;
    if (/\.kmz$/i.test(file.name) || (await peekZip(file))) {
      const zip = await JSZip.loadAsync(file);
      const kmls = Object.values(zip.files).filter(f => !f.dir && /\.kml$/i.test(f.name));
      if (!kmls.length) throw new Error('El KMZ no contiene un archivo .kml');
      kmls.sort((a, b) => (a.name.toLowerCase() === 'doc.kml' ? -1 : 0) - (b.name.toLowerCase() === 'doc.kml' ? -1 : 0));
      text = await kmls[0].async('string');
    } else text = await file.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('KML con formato inválido');
    const out = [];
    const pms = doc.getElementsByTagNameNS('*', 'Placemark');
    for (const pm of pms) {
      const name = childText(pm, 'name') || 'Sin nombre';
      const desc = (childText(pm, 'description') || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
      for (const g of pm.getElementsByTagNameNS('*', 'Point')) { const c = coordsOf(g); if (c.length) out.push({ name, desc, type: 'Point', coords: [c[0]] }); }
      for (const g of pm.getElementsByTagNameNS('*', 'LineString')) { const c = coordsOf(g); if (c.length > 1) out.push({ name, desc, type: 'LineString', coords: c }); }
      for (const g of pm.getElementsByTagNameNS('*', 'Polygon')) {
        const ob = g.getElementsByTagNameNS('*', 'outerBoundaryIs')[0];
        const c = ob ? coordsOf(ob) : [];
        const holes = [...g.getElementsByTagNameNS('*', 'innerBoundaryIs')].map(coordsOf).filter(h => h.length > 2);
        if (c.length > 2) out.push({ name, desc, type: 'Polygon', coords: c, holes });
      }
    }
    if (!out.length) throw new Error('No se encontraron puntos, líneas ni polígonos');
    return out;
  }
  async function peekZip(file) { const b = new Uint8Array(await file.slice(0, 2).arrayBuffer()); return b[0] === 0x50 && b[1] === 0x4b; }
  function childText(el, tag) { for (const c of el.children) if (c.localName === tag) return c.textContent.trim(); return ''; }
  function coordsOf(el) {
    const c = el.getElementsByTagNameNS('*', 'coordinates')[0];
    if (!c) return [];
    return c.textContent.trim().split(/\s+/).map(t => t.split(',').map(Number))
      .filter(v => v.length >= 2 && isFinite(v[0]) && isFinite(v[1]) && Math.abs(v[1]) <= 90 && Math.abs(v[0]) <= 180)
      .map(v => [v[1], v[0]]);
  }

  /* Punto KML más cercano a una posición. */
  function nearestPoint(features, lat, lon) {
    let best = null;
    for (const f of features || []) if (f.type === 'Point') {
      const d = dist(lat, lon, f.coords[0][0], f.coords[0][1]);
      if (!best || d < best.d) best = { name: f.name, d };
    }
    return best;
  }

  return { toUTM, dist, cameraHeading, readKmlFile, nearestPoint };
})();
