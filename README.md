# Alba Field 1.0.0

App de registro de campo **con y sin señal** (PWA instalable en Android y iPhone).
Fotos rotuladas con GPS/UTM/rumbo, almacenamiento en el teléfono, Excel + KMZ + ZIP,
entrega a OneDrive y consolidación del equipo. Evolución de GeoField Etapa 1 y GeoField 0.1.0.

**Instalación y uso: abra `guia.html`.**

Resumen:
1. Suba el contenido de esta carpeta a GitHub Pages (o Netlify) → obtiene `https://…`.
2. En el teléfono abra esa dirección en Chrome → ⋮ → Instalar aplicación.
3. Ajustes → código de especialista → Captura → Tomar fotografía.
4. Con señal: Entregar → Generar y compartir paquete → OneDrive.

Estructura: `index.html`, `styles.css`, `sw.js` (offline), `manifest.webmanifest`, `js/` (código),
`vendor/` (Leaflet, JSZip, piexifjs — licencias incluidas), `icons/`.
No requiere servidor ni compilación. Los datos de campo nunca se suben al repositorio.
