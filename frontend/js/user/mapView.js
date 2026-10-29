import * as L from '/vendor/leaflet/leaflet-src.esm.js';
import { createIcon } from '../icons.js';

/**
 * Leaflet map for the end-user screens: OpenStreetMap tiles (from the server's
 * public config), pickup "A" / destination "B" markers, the truck route and an
 * optional moving truck marker. Colours come from the CSS palette variables.
 */
const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function createUserMap(element, mapConfig) {
  const map = L.map(element, {
    center: mapConfig?.defaultCenter ?? [55.17, 23.88],
    zoom: mapConfig?.defaultZoom ?? 7,
    zoomControl: false,
    attributionControl: true,
    zoomAnimation: false,
    markerZoomAnimation: false,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  if (mapConfig?.tileUrl) {
    L.tileLayer(mapConfig.tileUrl, { maxZoom: mapConfig.maxZoom ?? 19, attribution: mapConfig.attribution, crossOrigin: false }).addTo(map);
  }
  const layers = L.layerGroup().addTo(map);
  let truck = null;

  function pin(kind, lat, lon, title) {
    const el = document.createElement('div');
    el.className = `map-marker map-marker--${kind}`;
    const s = document.createElement('span');
    s.textContent = kind === 'origin' ? 'A' : 'B';
    el.append(s);
    return L.marker([lat, lon], { icon: L.divIcon({ html: el, className: '', iconSize: [28, 28], iconAnchor: [14, 28] }), title, alt: title, keyboard: false });
  }

  return {
    leaflet: map,
    /** Draw route legs: [{ geometry, style: 'main' | 'approach' }]. */
    showRoute({ from, to, legs }) {
      layers.clearLayers();
      const all = [];
      for (const legDef of legs) {
        if (!legDef.geometry?.length) continue;
        all.push(...legDef.geometry);
        if (legDef.style === 'approach') {
          layers.addLayer(L.polyline(legDef.geometry, { color: css('--route-return', '#b8842a'), weight: 4, opacity: 0.9, dashArray: '6 8' }));
        } else {
          layers.addLayer(L.polyline(legDef.geometry, { color: css('--route-casing', '#ffffff'), weight: 9, opacity: 0.95 }));
          layers.addLayer(L.polyline(legDef.geometry, { color: css('--route-outbound', '#9dc954'), weight: 5, opacity: 1 }));
        }
      }
      if (from) layers.addLayer(pin('origin', from.lat, from.lon, from.label));
      if (to) layers.addLayer(pin('destination', to.lat, to.lon, to.label));
      if (all.length) this.fit(all);
    },
    fit(points, padding) {
      const bounds = L.latLngBounds(points);
      const small = window.matchMedia('(max-width: 899px)').matches;
      const pad = padding ?? (small ? { paddingTopLeft: [24, 110], paddingBottomRight: [24, Math.round(element.clientHeight * 0.45)] } : { paddingTopLeft: [470, 70], paddingBottomRight: [40, 40] });
      // No animation: screens can be left at any moment, and Leaflet throws if a map is removed mid-animation.
      map.fitBounds(bounds, { ...pad, animate: false });
    },
    setTruck(lat, lon) {
      if (!truck) {
        const el = document.createElement('div');
        el.className = 'hp-truck-marker';
        el.append(createIcon('truck', { size: 22 }));
        truck = L.marker([lat, lon], { icon: L.divIcon({ html: el, className: '', iconSize: [40, 40], iconAnchor: [20, 20] }), zIndexOffset: 1000, keyboard: false, title: 'Sunkvežimis' }).addTo(map);
      } else {
        truck.setLatLng([lat, lon]);
      }
    },
    truckLatLng: () => (truck ? truck.getLatLng() : null),
    invalidate: () => map.invalidateSize(),
    destroy: () => {
      try {
        map.stop();
        map.off();
        map.remove();
      } catch {
        /* already removed */
      }
    },
  };
}
