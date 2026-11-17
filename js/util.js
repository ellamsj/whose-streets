// Small shared helpers. No dependencies.

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Read a design token from tokens.css (so canvases follow the swappable theme). */
export function token(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}
export function tokenNum(name) { return parseFloat(token(name)) || 0; }
export function ms(name) {
  const v = token(name);
  return v.endsWith("ms") ? parseFloat(v) : parseFloat(v) * 1000 || 0;
}

const nf = new Intl.NumberFormat("en-GB");
export const fmt = (n) => (n == null ? "no data" : nf.format(n));
export const pct = (n) => (n == null ? "no data" : `${n.toFixed(1)}%`);

export const GENDER_LABEL = {
  man: "Man", woman: "Woman", multi: "Several people", nb: "Non-binary or uncertain gender", unknown: "Gender unknown",
};
export const GENDER_TOKEN = { man: "--man", woman: "--woman", multi: "--multi", nb: "--nb", unknown: "--unknown" };

/**
 * Life years for display, e.g. "1867–1934". Wikidata dates for ancient and
 * legendary figures (saints, biblical people) are estimates, so years are only
 * shown for people born from 500 CE on, and never when birth equals death.
 */
export function lifeYears(born, died) {
  if (born != null && born < 500) return "";
  if (born != null && died != null) return born === died ? "" : `${born}–${died}`;
  if (born != null) return `born ${born}`;
  if (died != null && died >= 500) return `died ${died}`;
  return "";
}

export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Animate 0→1 over `dur` ms, calling onFrame(t). Returns a cancel function. */
export function tween(dur, onFrame, onDone) {
  if (!dur || reducedMotion()) { onFrame(1); onDone && onDone(); return () => {}; }
  let raf, start;
  const step = (now) => {
    start ??= now;
    const t = Math.min(1, (now - start) / dur);
    onFrame(easeInOut(t));
    if (t < 1) raf = requestAnimationFrame(step); else onDone && onDone();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** Size a canvas to its CSS box at device resolution; returns {ctx, w, h, dpr}. */
export function fitCanvas(canvas, cssHeight) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = rect.width, h = cssHeight ?? rect.height;
  if (cssHeight) canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

export function rgba(hex, a) {
  const m = hex.replace("#", "");
  const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "style") Object.assign(e.style, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c);
  return e;
}

/** Fill every [data-bind="path.to.value"] with values from an object. */
export function bindAll(values, root = document) {
  root.querySelectorAll("[data-bind]").forEach((node) => {
    const v = node.dataset.bind.split(".").reduce((o, k) => (o == null ? o : o[k]), values);
    if (v != null) node.textContent = v;
  });
}

/** Re-run a callback when the element resizes (debounced to the next frame). */
export function onResize(target, cb) {
  let raf;
  let lastW = -1, lastH = -1;
  const ro = new ResizeObserver((entries) => {
    const { width, height } = entries[0].contentRect;
    if (Math.abs(width - lastW) < 1 && Math.abs(height - lastH) < 1) return;
    lastW = width; lastH = height;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(cb);
  });
  ro.observe(target);
}

/** Watch for theme / motion preference changes. */
export function onPrefsChange(cb) {
  for (const q of ["(prefers-color-scheme: dark)", "(prefers-reduced-motion: reduce)"]) {
    window.matchMedia(q).addEventListener("change", cb);
  }
}
