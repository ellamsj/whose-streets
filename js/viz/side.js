// Side pieces: the index drawer (women honoured, 30-city ranking) and the city views (bottom).
import { el, pct, lifeYears, token, tokenNum, rgba, fitCanvas, onPrefsChange } from "../util.js";

/** Ranking of all 30 Mapping Diversity cities. onSelect(cityName | null). */
export function createRanking(listEl, mdCities, mappedIds, onSelect) {
  const buttons = new Map();
  for (const c of mdCities) {
    const mapped = c.esn && mappedIds.includes(c.esn);
    const b = el("button", {
      type: "button", "aria-pressed": "false",
      "aria-label": `${c.name}, ${c.country}: ${pct(c.pctWomen)} of person-named streets honour women${mapped ? ". Street map available." : ""}`,
      onclick: () => onSelect(b.getAttribute("aria-pressed") === "true" ? null : c.name),
    },
      el("span", { class: "r-name" }, el("b", { class: mapped ? null : "off", text: "◆" }), c.name),
      el("span", { class: "r-track" }, el("span", { class: "r-bar", style: { width: `${(c.pctWomen / 50) * 100}%` } })),
      el("span", { class: "r-val", text: pct(c.pctWomen) }));
    buttons.set(c.name, b);
    listEl.append(el("li", {}, b));
  }
  return {
    select(name) {
      listEl.classList.toggle("has-selection", Boolean(name));
      for (const [n, b] of buttons) b.setAttribute("aria-pressed", String(n === name));
      if (name) buttons.get(name)?.scrollIntoView({ block: "nearest" });
    },
  };
}

/** Small multiples: "All" plus one thumbnail per drawn city. onSelect(cityName | null). */
export function createThumbs(listEl, geoms, mdCities, onSelect) {
  const items = [{ id: null, name: "All", pct: null, geoms }, ...geoms.map((g) => ({
    id: g.id, name: g.name, pct: mdCities.find((c) => c.esn === g.id)?.pctWomen, geoms: [g],
  }))];
  const buttons = [];
  const canvases = [];
  for (const it of items) {
    const cv = el("canvas", { "aria-hidden": "true" });
    const name = it.id ? mdCities.find((c) => c.esn === it.id)?.name ?? it.name : null;
    const b = el("button", {
      class: "thumb", type: "button", "aria-pressed": String(!it.id),
      "aria-label": it.id ? `Show ${it.name}` : "Show all cities",
      onclick: () => onSelect(name),
    }, cv, el("span", { class: "t-name", text: it.name }), el("span", { class: "t-val", text: it.pct != null ? `${pct(it.pct)} women` : `${geoms.length} cities` }));
    b.dataset.name = name ?? "";
    buttons.push(b);
    canvases.push([cv, it]);
    listEl.append(el("li", {}, b));
  }
  function drawAll() {
    const c = {
      man: token("--man"), woman: token("--woman"), other: token("--unknown"), blend: token("--blend") || "source-over",
      aMan: tokenNum("--alpha-man") * 2, aW: tokenNum("--alpha-woman"),
    };
    for (const [cv, it] of canvases) {
      const { ctx, w, h, dpr } = fitCanvas(cv);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = c.blend;
      const S = Math.min(w, h) * 0.98;
      ctx.setTransform(dpr * S, 0, 0, dpr * S, (dpr * w) / 2, (dpr * h) / 2);
      for (const g of it.geoms) {
        for (const [gender, col, a, lw] of [["man", c.man, c.aMan, 0.5], ["multi", c.other, 0.6, 0.6], ["nb", c.other, 0.6, 0.6], ["unknown", c.other, 0.4, 0.6], ["woman", c.woman, c.aW, 0.8]]) {
          const p = g.byGender[gender];
          if (!p) continue;
          ctx.strokeStyle = rgba(col, Math.min(1, a));
          ctx.lineWidth = lw / S;
          ctx.stroke(p);
        }
      }
    }
  }
  drawAll();
  onPrefsChange(drawAll);
  return {
    select(name, mappedNames) {
      listEl.parentElement.classList.toggle("has-selection", Boolean(name));
      for (const b of buttons) {
        const on = name ? b.dataset.name === name : !b.dataset.name;
        b.setAttribute("aria-pressed", String(on && (!name || mappedNames.includes(name))));
      }
    },
  };
}

/**
 * Every woman honoured by a drawn street, most streets first. Picking one lights
 * her streets up on the map. onFocus(qid | null, entry).
 */
export function createWomenIndex(listEl, noteEl, streets, onFocus) {
  const people = new Map();
  for (const s of streets) {
    if (s.grp !== "woman" || !s.qid) continue;
    const p = people.get(s.qid) ?? people.set(s.qid, { qid: s.qid, name: s.person ?? s.name, born: s.born, died: s.died, desc: s.desc, streets: [], cities: new Set() }).get(s.qid);
    p.streets.push(s); p.cities.add(s.cityName);
  }
  const list = [...people.values()].sort((a, b) => b.streets.length - a.streets.length || b.cities.size - a.cities.size || a.name.localeCompare(b.name));
  noteEl.textContent = `${list.length.toLocaleString("en-GB")} women have a street on this map. Pick one to find her streets.`;
  const buttons = new Map();
  for (const p of list) {
    const yrs = lifeYears(p.born, p.died);
    const b = el("button", {
      type: "button", "aria-pressed": "false",
      onclick: () => onFocus(b.getAttribute("aria-pressed") === "true" ? null : p.qid, p),
    },
      el("span", { class: "w-name" }, p.name, yrs ? el("span", { class: "w-yrs", text: ` ${yrs}` }) : null),
      el("span", { class: "w-n", text: String(p.streets.length), "aria-label": `${p.streets.length} street${p.streets.length > 1 ? "s" : ""}` }),
      p.desc ? el("span", { class: "w-desc", text: p.desc.charAt(0).toUpperCase() + p.desc.slice(1) }) : null,
      el("span", { class: "w-where", text: [...p.cities].join(" · ") }));
    buttons.set(p.qid, b);
    listEl.append(el("li", {}, b));
  }
  return {
    people,
    select(qid) {
      listEl.classList.toggle("has-selection", Boolean(qid));
      for (const [k, b] of buttons) b.setAttribute("aria-pressed", String(k === qid));
    },
  };
}
