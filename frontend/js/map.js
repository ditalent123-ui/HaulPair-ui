import * as L from '/vendor/leaflet/leaflet-src.esm.js';
import { t } from './i18n.js';

/**
 * Leaflet map wrapper. Tiles, attribution and zoom limits come from the
 * server's public config so the tile provider can be changed without code edits.
 */
export function createMap(element, mapConfig) {
  const map = L.map(element, {
    center: mapConfig.defaultCenter,
    zoom: mapConfig.defaultZoom,
    minZoom: 3,
    maxZoom: mapConfig.maxZoom,
    keyboard: true,
    zoomControl: true,
    worldCopyJump: true,
  });

  L.tileLayer(mapConfig.tileUrl, {
    maxZoom: mapConfig.maxZoom,
    attribution: mapConfig.attribution,
    crossOrigin: false,
  }).addTo(map);

  L.control.scale({ metric: true, imperial: false }).addTo(map);

  const markers = { origin: null, destination: null };
  let routeLayer = null;

  function markerIcon(kind) {
    const icon = document.createElement('div');
    icon.className = `map-marker map-marker--${kind}`;
    const label = document.createElement('span');
    label.textContent = kind === 'origin' ? 'A' : 'B';
    icon.append(label);
    return L.divIcon({ html: icon, className: '', iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] });
  }

  function setMarker(kind, location) {
    if (markers[kind]) {
      markers[kind].remove();
      markers[kind] = null;
    }
    if (!location) return;
    const title = `${t(kind === 'origin' ? 'map.origin' : 'map.destination')}: ${location.label}`;
    markers[kind] = L.marker([location.lat, location.lon], { icon: markerIcon(kind), title, alt: title, keyboard: true })
      .bindPopup(document.createTextNode(title))
      .addTo(map);
  }

  function showRoute({ outbound, return: ret }) {
    clearRoute();
    const layers = [];
    if (ret) {
      layers.push(
        L.polyline(ret.geometry, { color: getCss('--route-return'), weight: 4, opacity: 0.85, dashArray: '8 8' }).bindTooltip(
          t('map.return'),
          { sticky: true },
        ),
      );
    }
    // Casing + line for the outbound leg so it stays readable over any tile style.
    layers.push(L.polyline(outbound.geometry, { color: getCss('--route-casing'), weight: 8, opacity: 0.9 }));
    layers.push(
      L.polyline(outbound.geometry, { color: getCss('--route-outbound'), weight: 5, opacity: 0.95 }).bindTooltip(
        t('map.outbound'),
        { sticky: true },
      ),
    );
    routeLayer = L.featureGroup(layers).addTo(map);
    Object.values(markers).forEach((m) => m?.bringToFront?.());
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
  }

  function clearRoute() {
    routeLayer?.remove();
    routeLayer = null;
  }

  function fitMarkers() {
    const pts = Object.values(markers).filter(Boolean).map((m) => m.getLatLng());
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 9));
    if (pts.length === 2) map.fitBounds(L.latLngBounds(pts), { padding: [60, 60] });
  }

  function getCss(name) {
    // Route/marker colours come from the CSS theme palette (styles.css :root).
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#9dc954';
  }

  return {
    leaflet: map,
    setMarker,
    showRoute,
    clearRoute,
    fitMarkers,
    onClick: (fn) => map.on('click', (e) => fn({ lat: e.latlng.lat, lon: e.latlng.lng })),
    setPicking: (on) => element.classList.toggle('is-picking', on),
    invalidateSize: () => map.invalidateSize(),
  };
}
