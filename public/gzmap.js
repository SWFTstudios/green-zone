/* Map adapter: MapLibre GL vector maps behind a small Leaflet-shaped API used by the app. */
import * as maplibregl from "./vendor/maplibre/maplibre-gl.mjs";

// MapLibre's zoom levels show the same area as Leaflet's one level higher. The app speaks
// Leaflet-style zooms; the adapter converts at the edge.
const Z = 1;

const satellite = {
  version: 8,
  sources: {
    imagery: {
      type: "raster",
      tiles: ["https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 16,
      attribution: "Imagery: USGS The National Map",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#0b1d13" } },
    { id: "imagery", type: "raster", source: "imagery" },
  ],
};

const fallback = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#e5ebe7" } },
    { id: "osm", type: "raster", source: "osm" },
  ],
};

export const BASE_STYLES = {
  streets: { label: "Map", style: "https://tiles.openfreemap.org/styles/liberty" },
  light: { label: "Light", style: "https://tiles.openfreemap.org/styles/positron" },
  satellite: { label: "Satellite", style: satellite },
};

const toLngLat = (ll) => (Array.isArray(ll) ? [ll[1], ll[0]] : [ll.lng, ll.lat]);
const ev = (e) => ({ latlng: e.lngLat ? { lat: e.lngLat.lat, lng: e.lngLat.lng } : null, original: e });

/** Approximate circle polygon (meters) for the GPS accuracy ring. */
function circle(lat, lng, meters, steps = 48) {
  const coords = [];
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

export function createMap(container, { base = "streets", center = [39.5, -98.35], zoom = 4 } = {}) {
  let baseKey = BASE_STYLES[base] ? base : "streets";
  let styleReady = false;
  let usingFallback = false;

  const listeners = { style: [] };
  const map = new maplibregl.Map({
    container,
    style: BASE_STYLES[baseKey].style,
    center: toLngLat(center),
    zoom: zoom - Z,
    maxPitch: 70,
    attributionControl: { compact: true },
  });
  // Phones zoom with pinch and double-tap, so they only get the compass.
  const narrow = matchMedia("(max-width: 700px)").matches;
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showZoom: !narrow }), "top-right");
  if (!narrow) map.addControl(new maplibregl.ScaleControl({ unit: "imperial" }), "bottom-left");
  // MapLibre opens the compact attribution until the first drag; on phones it covers the legend, so start it closed.
  const collapseAttribution = () => {
    if (narrow) map.getContainer().querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  };
  map.on("load", collapseAttribution);
  map.on("resize", collapseAttribution);

  /* ---------- managed sources and layers (survive base-style changes) ---------- */

  const managed = [];
  const zOf = new Map();

  function beforeId(z) {
    const layers = map.getStyle()?.layers || [];
    let best = null;
    for (const l of layers) {
      const lz = zOf.get(l.id);
      if (lz !== undefined && lz > z && (best === null || lz < zOf.get(best))) best = l.id;
    }
    return best || layers.find((l) => l.type === "symbol")?.id;
  }

  function installAll() {
    if (!styleReady) return;
    for (const m of managed) m.install();
    add3dLayer();
  }

  function useFallback() {
    if (usingFallback) return;
    usingFallback = true;
    styleReady = false;
    map.setStyle(fallback, { diff: false });
  }

  map.on("style.load", () => {
    styleReady = true;
    installAll();
    listeners.style.forEach((fn) => fn(baseKey));
  });
  map.on("error", (e) => {
    // A base style that can't be fetched (offline, blocked host) falls back to plain OSM tiles.
    if (!styleReady && !usingFallback && /style|Failed to fetch|NetworkError|load/i.test(String(e?.error?.message || e?.error))) useFallback();
  });
  setTimeout(() => !styleReady && useFallback(), 10000);

  function source(id, spec, layers, { z = 20 } = {}) {
    let visible = true;
    let data = spec.data;
    layers.forEach((l, i) => zOf.set(l.id, z + i / 100));
    const entry = {
      install() {
        if (!styleReady) return;
        if (!map.getSource(id)) map.addSource(id, spec.type === "geojson" ? { ...spec, data } : spec);
        for (const l of layers) {
          if (map.getLayer(l.id)) continue;
          map.addLayer(
            { ...l, source: id, layout: { ...(l.layout || {}), visibility: visible ? "visible" : "none" } },
            beforeId(zOf.get(l.id)),
          );
        }
      },
    };
    managed.push(entry);
    entry.install();
    return {
      setData(next) {
        data = next;
        if (styleReady) map.getSource(id)?.setData(next);
      },
      setVisible(on) {
        visible = on;
        if (!styleReady) return;
        for (const l of layers) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, "visibility", on ? "visible" : "none");
      },
      setPaint(layerId, prop, value) {
        const l = layers.find((x) => x.id === layerId);
        if (l) l.paint = { ...(l.paint || {}), [prop]: value };
        if (styleReady && map.getLayer(layerId)) map.setPaintProperty(layerId, prop, value);
      },
      setFeatureState(featureId, state) {
        if (styleReady && map.getSource(id)) map.setFeatureState({ source: id, id: featureId }, state);
      },
      layerIds: layers.map((l) => l.id),
    };
  }

  /* ---------- 3D buildings ---------- */

  let threeD = false;
  function add3dLayer() {
    const style = map.getStyle();
    if (!style || style.layers.some((l) => l.type === "fill-extrusion")) return;
    if (!style.sources?.openmaptiles) return;
    map.addLayer(
      {
        id: "gz-3d-buildings",
        type: "fill-extrusion",
        source: "openmaptiles",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#d9d4cc",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      },
      style.layers.find((l) => l.type === "symbol")?.id,
    );
  }

  /* ---------- line + pin groups (trips) ---------- */

  function group(name, z) {
    const lines = [];
    const pins = [];
    let shown = false;
    let pending = false;
    const src = source(
      `grp-${name}`,
      { type: "geojson", data: { type: "FeatureCollection", features: [] } },
      [
        {
          id: `grp-${name}-casing`,
          type: "line",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": 11, "line-opacity": 0.75 },
        },
        {
          id: `grp-${name}-line`,
          type: "line",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": ["get", "color"], "line-width": 7, "line-opacity": 0.92 },
        },
      ],
      { z },
    );
    src.setVisible(false);

    const refresh = () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        src.setData({
          type: "FeatureCollection",
          features: lines
            .filter((l) => l.path.length >= 2)
            .map((l) => ({
              type: "Feature",
              properties: { color: l.color, i: lines.indexOf(l) },
              geometry: { type: "LineString", coordinates: l.path.map(([lat, lng]) => [lng, lat]) },
            })),
        });
      });
    };

    map.on("click", `grp-${name}-line`, (e) => {
      const line = lines[e.features?.[0]?.properties?.i];
      if (line?.html) new maplibregl.Popup({ maxWidth: "260px" }).setLngLat(e.lngLat).setHTML(line.html).addTo(map);
    });
    map.on("mouseenter", `grp-${name}-line`, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", `grp-${name}-line`, () => (map.getCanvas().style.cursor = ""));

    const bounds = (pts) => {
      if (!pts.length) return null;
      const b = { s: Infinity, w: Infinity, n: -Infinity, e: -Infinity };
      for (const [lat, lng] of pts) {
        b.s = Math.min(b.s, lat);
        b.n = Math.max(b.n, lat);
        b.w = Math.min(b.w, lng);
        b.e = Math.max(b.e, lng);
      }
      return b;
    };

    return {
      line(path, color) {
        const l = {
          path: [...path],
          color,
          html: null,
          addLatLng(pt) {
            this.path.push(pt);
            refresh();
            return this;
          },
          setLatLngs(p) {
            this.path = [...p];
            refresh();
            return this;
          },
          remove() {
            const i = lines.indexOf(this);
            if (i >= 0) lines.splice(i, 1);
            refresh();
          },
          popup(html) {
            this.html = html;
            return this;
          },
          bounds() {
            return bounds(this.path);
          },
        };
        lines.push(l);
        refresh();
        return l;
      },
      pin({ lat, lng, note }, color) {
        const el = document.createElement("div");
        el.className = "pin-icon";
        el.style.background = color || "#475569";
        el.innerHTML = "<span>✎</span>";
        const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([lng, lat])
          .setPopup(new maplibregl.Popup({ offset: 26, maxWidth: "260px" }).setText(note || "(no text)"));
        const p = {
          marker,
          remove() {
            marker.remove();
            const i = pins.indexOf(this);
            if (i >= 0) pins.splice(i, 1);
          },
          bounds: () => bounds([[lat, lng]]),
        };
        pins.push(p);
        if (shown) marker.addTo(map);
        return p;
      },
      clear() {
        lines.length = 0;
        for (const p of pins) p.marker.remove();
        pins.length = 0;
        refresh();
      },
      show(on) {
        shown = on;
        src.setVisible(on);
        for (const p of pins) on ? p.marker.addTo(map) : p.marker.remove();
      },
      items() {
        return [...lines, ...pins];
      },
    };
  }

  /* ---------- my location ---------- */

  let meMarker = null;
  const meRing = source(
    "me-accuracy",
    { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    [
      { id: "me-accuracy-fill", type: "fill", paint: { "fill-color": "#2563eb", "fill-opacity": 0.1 } },
      { id: "me-accuracy-line", type: "line", paint: { "line-color": "#2563eb", "line-width": 1, "line-opacity": 0.5 } },
    ],
    { z: 60 },
  );

  const api = {
    raw: map,
    maplibregl,
    source,
    group,
    setView(ll, zoom) {
      map.jumpTo({ center: toLngLat(ll), zoom: (zoom ?? api.getZoom()) - Z });
      return api;
    },
    flyTo(ll, zoom) {
      map.flyTo({ center: toLngLat(ll), zoom: (zoom ?? api.getZoom()) - Z, essential: true });
      return api;
    },
    panTo(ll) {
      map.easeTo({ center: toLngLat(ll), duration: 600 });
      return api;
    },
    setZoom(zoom) {
      map.easeTo({ zoom: zoom - Z });
      return api;
    },
    getZoom: () => map.getZoom() + Z,
    getCenter: () => {
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    },
    getBounds: () => map.getBounds(),
    /** bounds: {w,s,e,n} or [[s,w],[n,e]]; padding in px {top,left,bottom,right}. */
    /** minZoom: if the box only fits below this zoom, center on it at minZoom instead. */
    fitBounds(b, { padding = 40, maxZoom = 17, minZoom = 0, animate = true } = {}) {
      const box = Array.isArray(b) ? { s: b[0][0], w: b[0][1], n: b[1][0], e: b[1][1] } : b;
      if (!box || !Number.isFinite(box.w)) return api;
      const pad = typeof padding === "number" ? { top: padding, left: padding, bottom: padding, right: padding } : { ...padding };
      const w = map.getContainer().clientWidth;
      const h = map.getContainer().clientHeight;
      // Keep padding smaller than the map, or MapLibre refuses to fit.
      if (pad.left + pad.right >= w - 40) pad.left = pad.right = 20;
      if (pad.top + pad.bottom >= h - 40) pad.top = pad.bottom = 20;
      const bounds = [
        [box.w, box.s],
        [box.e, box.n],
      ];
      const opts = { padding: pad, maxZoom: maxZoom - Z, animate, duration: animate ? 700 : 0 };
      const cam = minZoom ? map.cameraForBounds(bounds, opts) : null;
      if (cam && cam.zoom < minZoom - Z) map.easeTo({ ...opts, center: cam.center, zoom: minZoom - Z });
      else map.fitBounds(bounds, opts);
      return api;
    },
    resize: () => map.resize(),
    on(type, fn) {
      if (type === "style") listeners.style.push(fn);
      else map.on(type, (e) => fn(ev(e)));
      return api;
    },
    popup(ll, html) {
      new maplibregl.Popup({ maxWidth: "260px" }).setLngLat(toLngLat(ll)).setHTML(html).addTo(map);
    },
    setMe(lat, lng, acc) {
      if (!meMarker) {
        const el = document.createElement("div");
        el.className = "me-dot";
        meMarker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      } else meMarker.setLngLat([lng, lat]);
      meRing.setData({ type: "FeatureCollection", features: [circle(lat, lng, acc)] });
    },
    get base() {
      return baseKey;
    },
    setBase(key) {
      if (!BASE_STYLES[key] || (key === baseKey && !usingFallback)) return;
      baseKey = key;
      usingFallback = false;
      styleReady = false;
      map.setStyle(BASE_STYLES[key].style, { diff: false });
    },
    get threeD() {
      return threeD;
    },
    set3D(on) {
      threeD = on;
      map.easeTo({ pitch: on ? 60 : 0, bearing: on ? map.getBearing() || -17 : 0, duration: 800 });
    },
  };
  return api;
}
