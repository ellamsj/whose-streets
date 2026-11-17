// The field: every person-named street from the drawn cities on one canvas.
//   map   — each city scaled to the same square and laid on top of the others
//   stack — every street lifted off the map and lined up, men → other → women
// Motion: streets grow outward from the centre on load, then colour washes in
// (men first, women last).
// (The opening is skipped with reduced motion.)
import { buildHitIndex } from "../data.js";
import { token, tokenNum, ms, fitCanvas, tween, onResize, onPrefsChange, reducedMotion, easeInOut } from "../util.js";
import { streetTooltip } from "./tooltip.js";

const ORDER = { man: 0, other: 1, woman: 2 };
const group = (g) => (g === "man" || g === "woman" ? g : "other");
const HL = {
  all: { man: 1, woman: 1, other: 1 },
  woman: { man: 0.12, woman: 1.15, other: 0.12 },
  man: { man: 1.9, woman: 0.1, other: 0.12 },
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function createField({ canvas, tooltipEl, cities, onPin }) {
  // ---- flatten all streets, men first so women are drawn on top ----
  const streets = [];
  for (const c of cities) for (const s of c.streets) streets.push({ ...s, city: c.id, cityName: c.name, grp: group(s.gender) });
  streets.sort((a, b) => ORDER[a.grp] - ORDER[b.grp]);
  streets.forEach((s, i) => (s.i = i));
  const N = streets.length;
  const hits = new Map(cities.map((c) => [c.id, buildHitIndex(streets.filter((s) => s.city === c.id).map((s) => ({ ...s, idx: s.i })))]));
  const byPerson = new Map();
  for (const s of streets) if (s.qid) (byPerson.get(s.qid) ?? byPerson.set(s.qid, []).get(s.qid)).push(s.i);

  // intro: distance of each street from the centre decides when it appears
  const radius = new Float32Array(N);
  for (const s of streets) {
    const [x0, y0, x1, y1] = s.bbox;
    radius[s.i] = Math.min(1, Math.hypot((x0 + x1) / 2, (y0 + y1) / 2) / 0.62 + Math.random() * 0.06);
  }

  // per-street render state: scale, tx, ty, colour alpha, ghost alpha
  const cur = new Float32Array(N * 5), from = new Float32Array(N * 5), to = new Float32Array(N * 5);
  const state = { view: "map", city: null, hl: "all", noMap: false, focus: null };
  let size, colors, grid = null, animating = false, cancel = () => {}, hover = null, pinned = null;
  let intro = null; // { t0, dur } while the opening sequence runs
  let pending = true; // nothing is drawn until the opening sequence starts
  const tip = streetTooltip(tooltipEl, { onClose: () => unpin() });
  const figure = canvas.parentElement;

  function readColors() {
    colors = {
      man: token("--man"), woman: token("--woman"), other: token("--unknown"), neutral: token("--neutral-line"),
      ink: token("--ink"), paper: token("--paper"), blend: token("--blend") || "source-over",
      aMan: tokenNum("--alpha-man") * 2.4, aW: tokenNum("--alpha-woman") * 0.9, aO: tokenNum("--alpha-other"),
    };
  }
  const baseAlpha = (g) => (g === "man" ? colors.aMan : g === "woman" ? colors.aW : colors.aO);
  const visible = (s) => !state.noMap && (!state.city || s.city === state.city);
  const hoverable = (s) => visible(s) && (state.hl === "all" || s.grp === state.hl) && (!state.focus || s.qid === state.focus);

  // ---- targets ----
  function stackLayout() {
    const { w, h } = size;
    const shown = streets.filter((s) => visible(s) && s.grp !== "other");
    const groups = [];
    for (const s of shown) {
      if (!groups.length || groups.at(-1).g !== s.grp) groups.push({ g: s.grp, items: [] });
      groups.at(-1).items.push(s);
    }
    const pad = Math.min(w, h) * 0.04, W = w - 2 * pad, H = h - 2 * pad;
    const gapRows = 1;
    let cols = Math.max(4, Math.floor(Math.sqrt(shown.length * W / H)));
    const rowsFor = (c) => groups.reduce((r, g) => r + Math.ceil(g.items.length / c), 0) + (groups.length - 1) * gapRows;
    while (rowsFor(cols) * (W / cols) > H) cols++;
    const cell = W / cols;
    const ox = pad + (W - cols * cell) / 2;
    const oy = pad + (H - rowsFor(cols) * cell) / 2;
    const pos = new Map(), lookup = new Map();
    let row = 0;
    for (const g of groups) {
      g.items.forEach((s, k) => {
        const c = k % cols, r = row + Math.floor(k / cols);
        pos.set(s.i, { x: ox + (c + 0.5) * cell, y: oy + (r + 0.5) * cell });
        lookup.set(r * cols + c, s.i);
      });
      row += Math.ceil(g.items.length / cols) + gapRows;
    }
    return { cell, cols, pos, lookup, ox, oy };
  }

  const mapScale = () => Math.max(size.w, size.h) * 1.02; // fill the stage; the short side crops

  function computeTargets() {
    const { w, h } = size;
    const S = mapScale(), cx = w / 2, cy = h / 2;
    grid = state.view === "stack" ? stackLayout() : null;
    const hl = HL[state.hl];
    for (const s of streets) {
      const o = s.i * 5;
      const on = visible(s) && !(state.view === "stack" && s.grp === "other");
      let mult = hl[s.grp];
      if (state.focus) mult = s.qid === state.focus ? 2.4 : 0.1;
      let k = S, tx = cx, ty = cy, a, ghost;
      if (state.view === "map") {
        a = on ? Math.min(1, baseAlpha(s.grp) * mult) : 0;
        ghost = on ? 0 : 0.06;
      } else {
        a = on ? Math.min(1, 0.85 * mult) : 0;
        ghost = 0;
        if (on) {
          const [x0, y0, x1, y1] = s.bbox, p = grid.pos.get(s.i);
          k = (grid.cell * 0.8) / Math.max(x1 - x0, y1 - y0, 1e-4);
          tx = p.x - ((x0 + x1) / 2) * k; ty = p.y - ((y0 + y1) / 2) * k;
        } else { // fade out in place
          k = cur[o] || S; tx = cur[o + 1] || cx; ty = cur[o + 2] || cy;
        }
      }
      to[o] = k; to[o + 1] = tx; to[o + 2] = ty; to[o + 3] = a; to[o + 4] = ghost;
    }
  }

  // ---- drawing ----
  // While nothing moves, the finished scene is cached so hovering only redraws one street.
  const cache = document.createElement("canvas");
  let cacheValid = false;

  const offset = () => [0, 0];

  /** Colour of a group at intro time t (ms): neutral first, then its own colour. */
  function introMix(t) {
    // [start, end] of each group's colour wash, in ms
    const wash = { man: [3000, 4400], other: [3000, 4400], woman: [4300, 5800] };
    const out = {};
    for (const g of ["man", "other", "woman"]) out[g] = easeInOut(clamp01((t - wash[g][0]) / (wash[g][1] - wash[g][0])));
    return out;
  }

  function draw() {
    const { ctx, w, h, dpr } = size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    if (pending) return;
    if (!animating && !intro && cacheValid) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(cache, 0, 0);
      drawHover(ctx, dpr);
      return;
    }
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.globalCompositeOperation = colors.blend;
    const it = intro ? performance.now() - intro.t0 : null;
    const mix = it != null ? introMix(it) : null;
    const mixStyle = mix && Object.fromEntries(Object.entries(mix).map(([g, m]) => [g, lerpHex(colors.neutral, colors[g], m)]));
    const neutralA = 0.2;
    let lastStyle = null;
    for (const s of streets) {
      const o = s.i * 5;
      let a = cur[o + 3];
      const g = cur[o + 4];
      let style = colors[s.grp];
      if (it != null) { // grow outward over ~3 s, then wash the colour in
        const reveal = easeInOut(clamp01((it - radius[s.i] * 2600) / 700));
        const m = mix[s.grp];
        a = reveal * (neutralA + (a - neutralA) * m);
        style = mixStyle[s.grp];
      }
      if (a < 0.003 && g < 0.003) continue;
      const k = cur[o];
      const [px, py] = offset(s);
      ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (cur[o + 1] + px), dpr * (cur[o + 2] + py));
      if (g >= 0.003) {
        if (lastStyle !== colors.neutral) { ctx.strokeStyle = lastStyle = colors.neutral; }
        ctx.globalAlpha = g; ctx.lineWidth = 0.6 / k; ctx.stroke(s.path);
      }
      if (a >= 0.003) {
        if (lastStyle !== style) { ctx.strokeStyle = lastStyle = style; }
        ctx.globalAlpha = Math.min(1, a);
        const focused = state.focus && s.qid === state.focus;
        ctx.lineWidth = (focused ? 2.2 : state.view === "stack" ? 1.3 : s.grp === "woman" ? 0.95 : 0.75) / k;
        ctx.stroke(s.path);
      }
    }
    ctx.globalAlpha = 1;
    if (!animating && !intro) {
      cache.width = canvas.width; cache.height = canvas.height;
      cache.getContext("2d").drawImage(canvas, 0, 0);
      cacheValid = true;
    }
    drawHover(ctx, dpr);
  }

  function strokeStreet(ctx, dpr, i, width, halo) {
    const s = streets[i], o = i * 5, k = cur[o];
    if (cur[o + 3] < 0.003) return;
    const [px, py] = offset(s);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * (cur[o + 1] + px), dpr * (cur[o + 2] + py));
    if (halo) { ctx.strokeStyle = colors.paper; ctx.lineWidth = (width + 3) / k; ctx.stroke(s.path); }
    ctx.strokeStyle = colors[s.grp]; ctx.lineWidth = width / k; ctx.stroke(s.path);
  }
  function drawHover(ctx, dpr) {
    const i = pinned ?? hover;
    if (i == null) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    // the same person's other streets light up too (in every city shown)
    const q = streets[i].qid;
    if (q) for (const j of byPerson.get(q)) if (j !== i && visible(streets[j])) strokeStreet(ctx, dpr, j, 1.4, true);
    strokeStreet(ctx, dpr, i, 2.4, true);
  }

  function animate(dur) {
    cancel();
    cacheValid = false;
    from.set(cur);
    computeTargets();
    animating = true;
    const n = N;
    cancel = tween(dur, (t) => {
      for (let i = 0; i < n; i++) {
        // gentle wave: later streets start a little later
        const d = Math.min(1, Math.max(0, t * 1.3 - (i / n) * 0.3));
        const o = i * 5;
        for (let j = 0; j < 5; j++) cur[o + j] = from[o + j] + (to[o + j] - from[o + j]) * d;
      }
      draw();
    }, () => { animating = false; draw(); });
  }

  function layout() {
    size = fitCanvas(canvas);
    cacheValid = false;
    computeTargets();
    cur.set(to);
    draw();
  }

  // ---- hover / tap ----
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    if (animating || intro) return { idx: null, x, y };
    const ok = (i) => hoverable(streets[i]);
    if (state.view === "map") {
      const S = mapScale();
      let best = null, bd = Infinity;
      for (const c of cities) {
        if (!visible({ city: c.id })) continue;
        const [px, py] = offset({ city: c.id });
        const nx = (x - size.w / 2 - px) / S, ny = (y - size.h / 2 - py) / S;
        const [idx, d] = hits.get(c.id).nearestD(nx, ny, 7 / S, ok);
        if (idx != null && d < bd) { bd = d; best = idx; }
      }
      return { idx: best, x, y };
    }
    const c = Math.floor((x - grid.ox) / grid.cell), rr = Math.floor((y - grid.oy) / grid.cell);
    if (c < 0 || c >= grid.cols || rr < 0) return { idx: null, x, y };
    const idx = grid.lookup.get(rr * grid.cols + c) ?? null;
    return { idx: idx != null && ok(idx) ? idx : null, x, y };
  }
  function others(i) {
    const s = streets[i];
    if (!s.qid) return [];
    return byPerson.get(s.qid).filter((j) => j !== i).map((j) => streets[j]);
  }
  function showTip(i, x, y, pin) {
    const fr = figure.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    tip.show(streets[i], others(i), x + cr.left - fr.left, y + cr.top - fr.top, fr, pin);
  }
  function hoverAt(cx, cy) {
    if (pinned != null) return;
    const p = pick(cx, cy);
    if (p.idx == null) return clearHover();
    if (p.idx !== hover) { hover = p.idx; draw(); }
    showTip(p.idx, p.x, p.y, false);
  }
  function clearHover() { if (hover != null) { hover = null; if (!animating) draw(); } if (pinned == null) tip.hide(); }
  function unpin() { if (pinned == null) return; pinned = null; tip.hide(); draw(); onPin?.(null); }

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    hoverAt(e.clientX, e.clientY);
  });
  canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") clearHover(); });
  canvas.addEventListener("click", (e) => {
    if (intro) return skipIntro();
    const p = pick(e.clientX, e.clientY);
    if (p.idx == null) return unpin();
    pinned = p.idx; hover = null;
    draw();
    showTip(p.idx, p.x, p.y, true);
    onPin?.(streets[p.idx]);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") unpin(); });

  // ---- intro ----
  let introDone = () => {};
  function skipIntro() {
    if (!intro) return;
    intro = null;
    cacheValid = false;
    draw();
    introDone();
  }
  function runIntro(hooks = {}) {
    return new Promise((resolve) => {
      introDone = () => { hooks.done?.(); resolve(); };
      pending = false;
      if (reducedMotion()) { hooks.women?.(0); introDone(); draw(); return; }
      const DUR = 6000;
      intro = { t0: performance.now() };
      let womenFired = false;
      const step = () => {
        if (!intro) return;
        const t = performance.now() - intro.t0;
        if (!womenFired && t > 4300) { womenFired = true; hooks.women?.(1500); }
        if (t >= DUR) return skipIntro();
        draw();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  readColors();
  layout();
  onResize(canvas, layout);
  onPrefsChange(() => { readColors(); cacheValid = false; computeTargets(); cur.set(to); draw(); });

  return {
    streets,
    set(next) {
      const viewChanged = next.view && next.view !== state.view;
      Object.assign(state, next);
      unpin(); clearHover();
      if (intro) skipIntro();
      animate(viewChanged ? ms("--t-move") * 1.6 : ms("--t-fade") * 1.2);
    },
    intro: runIntro,
    skipIntro,
    counts() {
      const shown = streets.filter((s) => visible(s) && (!state.focus || s.qid === state.focus));
      const n = { man: 0, woman: 0, other: 0 };
      for (const s of shown) n[s.grp]++;
      return { total: shown.length, cities: new Set(shown.map((s) => s.city)).size, ...n };
    },
  };
}

function lerpHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p, s) => (p >> s) & 255;
  const c = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
