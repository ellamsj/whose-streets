// Orchestration: load local data, build the field, wire the controls.
import { loadCities, loadCityGeometry, DRAWN_CITIES } from "./data.js";
import { el, fmt, pct, tween } from "./util.js";
import { createField } from "./viz/field.js";
import { createRanking, createThumbs, createWomenIndex } from "./viz/side.js";

const $ = (id) => document.getElementById(id);

async function main() {
  const md = await loadCities();
  const T = md.totals;
  $("about-persons").textContent = fmt(T.streetsPersons);
  $("about-men").textContent = fmt(T.men);
  $("about-women").textContent = fmt(T.women);
  $("about-other").textContent = fmt(T.other);

  const geoms = await Promise.all(DRAWN_CITIES.map(loadCityGeometry));
  // display names from the 30-city list (e.g. Wrocław), so both sides agree
  for (const g of geoms) g.name = md.cities.find((c) => c.esn === g.id)?.name ?? g.name;
  const mappedNames = geoms.map((g) => g.name);

  const field = createField({ canvas: $("field"), tooltipEl: $("tooltip"), cities: geoms });
  const state = { view: "map", hl: "all", city: null, focus: null };

  const ranking = createRanking($("ranking"), md.cities, DRAWN_CITIES, (name) => select(name));
  const thumbs = createThumbs($("thumbs"), geoms, md.cities, (name) => select(name));
  const women = createWomenIndex($("women"), $("women-note"), field.streets, (qid) => focus(qid));

  function select(name) {
    state.city = name;
    state.focus = null;
    const g = geoms.find((x) => x.name === name);
    field.set({ city: g ? g.id : null, noMap: Boolean(name && !g), focus: null });
    ranking.select(name);
    thumbs.select(name, mappedNames);
    women.select(null);
    update();
  }

  function focus(qid) {
    state.focus = qid;
    state.city = null;
    if (qid && state.hl === "man") setRadio("hl", "all");
    field.set({ focus: qid, city: null, noMap: false, hl: state.hl });
    women.select(qid);
    ranking.select(null);
    thumbs.select(null, mappedNames);
    update();
  }

  function setRadio(name, value) {
    state[name] = value;
    document.querySelector(`input[name="${name}"][value="${value}"]`).checked = true;
  }

  for (const [id, key] of [["view-toggle", "view"], ["hl-toggle", "hl"]]) {
    $(id).addEventListener("change", (e) => {
      state[key] = e.target.value;
      field.set({ [key]: e.target.value });
      update();
    });
  }

  // ---- the hidden layer: index drawer ----
  const drawer = $("drawer"), btn = $("index-btn");
  function openDrawer(open) {
    document.body.classList.toggle("drawer-open", open);
    drawer.inert = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) (drawer.querySelector('[role="tab"][aria-selected="true"]')).focus({ preventScroll: true });
    else if (drawer.contains(document.activeElement)) btn.focus();
  }
  btn.addEventListener("click", () => openDrawer(btn.getAttribute("aria-expanded") !== "true"));
  $("drawer-close").addEventListener("click", () => openDrawer(false));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.inert) openDrawer(false); });

  const tabs = [...drawer.querySelectorAll('[role="tab"]')];
  function showTab(tab) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
    tab.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => showTab(t));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") showTab(tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]);
    });
  });

  // chip under the map while one woman is in focus
  const chip = $("focus-chip");
  chip.addEventListener("click", () => focus(null));

  function update() {
    // Key figure: Mapping Diversity share for the selection (all 30 cities, or one city)
    const c = state.city ? md.cities.find((x) => x.name === state.city) : null;
    const f = c ? { w: c.pctWomen, m: c.pctMen, o: c.pctOther } : { w: T.pctWomen, m: T.pctMen, o: T.pctOther };
    $("fig-num").textContent = pct(f.w);
    $("fig-label").textContent = c
      ? `of streets named after people in ${c.name} honour a woman.`
      : `of streets named after people honour a woman, across ${md.cities.length} European cities.`;
    drawBar(f);

    // Caption over the field: what the lines show right now
    const n = field.counts();
    const p = state.focus ? women.people.get(state.focus) : null;
    let text;
    if (p) text = `${p.name} · ${n.total} street${n.total > 1 ? "s" : ""} in ${n.cities} cit${n.cities > 1 ? "ies" : "y"}`;
    else if (c && !mappedNames.includes(c.name)) text = `No street map for ${c.name}`;
    else text = `${c ? c.name : `${geoms.length} cities`} · ${fmt(n.total)} streets · ${fmt(n.woman)} named after women`;
    $("stage-caption").textContent = text;
    chip.hidden = !p;
    chip.textContent = p ? `Showing ${p.name} — show everyone` : "";
  }
  function drawBar(f) {
    $("fig-bar").replaceChildren(
      el("span", { style: { flexGrow: f.m, background: "var(--man)" } }),
      el("span", { style: { flexGrow: f.o, background: "var(--unknown)" } }),
      el("span", { style: { flexGrow: f.w, background: "var(--woman)" } }));
  }

  update();
  // Opening: the figure waits at 0 and counts up as the women's streets light up.
  document.body.classList.add("is-intro");
  $("fig-num").textContent = pct(0);
  drawBar({ m: 1, o: 0, w: 0 });
  const end = () => document.body.classList.remove("is-intro");
  const skip = () => field.skipIntro();
  window.addEventListener("keydown", skip, { once: true });
  await field.intro({
    women(dur) {
      tween(dur, (t) => {
        $("fig-num").textContent = pct(T.pctWomen * t);
        drawBar({ m: T.pctMen, o: T.pctOther * t, w: T.pctWomen * t });
      });
    },
    done() { end(); update(); },
  });
  window.removeEventListener("keydown", skip);
}

main().catch((err) => {
  console.error(err);
  document.body.classList.remove("is-intro");
  document.querySelector(".stage__caption").textContent = "The data could not be loaded. Serve this folder with a local web server.";
});
