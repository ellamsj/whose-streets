// Data layer: loads local JSON only (nothing is fetched from the internet at runtime)
// and turns the compact street files into drawable, normalised geometry.

const cache = new Map();
export function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(path, fetch(path).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${path}`);
      return r.json();
    }));
  }
  return cache.get(path);
}

export const loadCities = () => loadJSON("data/cities.json");
export const loadWomen = () => loadJSON("data/women.json");
export const loadStreetIndex = () => loadJSON("data/streets/index.json");

/** Cities whose EqualStreetNames data has enough gender coverage to draw. */
export const DRAWN_CITIES = ["paris", "berlin", "brussels", "warsaw", "vienna", "lisbon", "copenhagen", "madrid", "budapest", "wroclaw"];

const geomCache = new Map();

/**
 * Load one city and normalise it: coordinates are centred on the median street
 * point and scaled so the 2nd–98th percentile extent fits a unit square
 * ([-0.5, 0.5]). Every city therefore overlays at the same size.
 */
export function loadCityGeometry(id) {
  if (geomCache.has(id)) return geomCache.get(id);
  const p = loadJSON(`data/streets/${id}.json`).then((city) => {
    const xs = [], ys = [];
    for (const s of city.streets) for (const l of s.l) for (let i = 0; i < l.length; i += 2) { xs.push(l[i]); ys.push(l[i + 1]); }
    const q = (arr, f) => { const a = Float64Array.from(arr).sort(); return a[Math.floor(f * (a.length - 1))]; };
    const x0 = q(xs, 0.02), x1 = q(xs, 0.98), y0 = q(ys, 0.02), y1 = q(ys, 0.98);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const size = Math.max(x1 - x0, y1 - y0) || 1;
    const norm = (v, c) => (v - c) / size;

    const streets = city.streets.map((s, idx) => {
      const lines = s.l.map((l) => {
        const out = new Float32Array(l.length);
        for (let i = 0; i < l.length; i += 2) { out[i] = norm(l[i], cx); out[i + 1] = norm(l[i + 1], cy); }
        return out;
      });
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const l of lines) for (let i = 0; i < l.length; i += 2) {
        if (l[i] < bx0) bx0 = l[i]; if (l[i] > bx1) bx1 = l[i];
        if (l[i + 1] < by0) by0 = l[i + 1]; if (l[i + 1] > by1) by1 = l[i + 1];
      }
      const path = new Path2D();
      for (const l of lines) { path.moveTo(l[0], l[1]); for (let i = 2; i < l.length; i += 2) path.lineTo(l[i], l[i + 1]); }
      return { idx, name: s.n, gender: s.g, person: s.p || null, desc: s.d || null, qid: s.q || null, nameDiffers: Boolean(s.u), born: s.b ?? null, died: s.x ?? null,
               lines, path, bbox: [bx0, by0, bx1, by1] };
    });

    // One combined path per gender, for fast overlay drawing.
    const byGender = {};
    for (const s of streets) (byGender[s.gender] ??= new Path2D()).addPath(s.path);

    return { ...city, streets, byGender, norm: { cx, cy, size } };
  });
  geomCache.set(id, p);
  return p;
}

/** Background (non-person) streets for a city, normalised with the same transform. */
export async function loadCityBase(id) {
  const [g, base] = await Promise.all([loadCityGeometry(id), loadJSON(`data/streets/${id}-base.json`)]);
  const { cx, cy, size } = g.norm;
  const path = new Path2D();
  for (const l of base.base) {
    path.moveTo((l[0] - cx) / size, (l[1] - cy) / size);
    for (let i = 2; i < l.length; i += 2) path.lineTo((l[i] - cx) / size, (l[i + 1] - cy) / size);
  }
  return path;
}

/** Spatial hash of street segments for hover / tap hit-testing in normalised space. */
export function buildHitIndex(streets, cell = 0.01) {
  const grid = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const s of streets) {
    for (const l of s.lines) {
      for (let i = 0; i < l.length - 2; i += 2) {
        const ax = l[i], ay = l[i + 1], bx = l[i + 2], by = l[i + 3];
        const i0 = Math.floor(Math.min(ax, bx) / cell), i1 = Math.floor(Math.max(ax, bx) / cell);
        const j0 = Math.floor(Math.min(ay, by) / cell), j1 = Math.floor(Math.max(ay, by) / cell);
        for (let gi = i0; gi <= i1; gi++) for (let gj = j0; gj <= j1; gj++) {
          const k = key(gi, gj);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([s.idx, ax, ay, bx, by]);
        }
      }
    }
  }
  return {
    /** Nearest street within maxDist that passes accept(idx): returns [idx, d2] or [null, Infinity]. */
    nearestD(x, y, maxDist, accept = () => true) {
      const r = Math.ceil(maxDist / cell);
      const ci = Math.floor(x / cell), cj = Math.floor(y / cell);
      let best = null, bestD = maxDist * maxDist;
      for (let gi = ci - r; gi <= ci + r; gi++) for (let gj = cj - r; gj <= cj + r; gj++) {
        const segs = grid.get(key(gi, gj));
        if (!segs) continue;
        for (const [idx, ax, ay, bx, by] of segs) {
          const dx = bx - ax, dy = by - ay;
          const len2 = dx * dx + dy * dy || 1e-12;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
          const px = ax + t * dx - x, py = ay + t * dy - y;
          const d = px * px + py * py;
          if (d < bestD && accept(idx)) { bestD = d; best = idx; }
        }
      }
      return best == null ? [null, Infinity] : [best, bestD];
    },
  };
}
