import { el, lifeYears } from "../util.js";

const GENDER = { man: "Man", woman: "Woman", multi: "Several people", nb: "Non-binary", unknown: "Gender not recorded" };

/**
 * Street card, in three clear tiers:
 *   1. the street, exactly as it is signposted (OpenStreetMap name, local language)
 *   2. who it is named after, with life years
 *   3. who they were (Wikidata description)
 * Hover shows it; click pins it, adding a Wikidata link and a close button.
 */
export function streetTooltip(node, { onClose } = {}) {
  return {
    show(street, others, x, y, bounds, pinned) {
      const unclear = street.nameDiffers;
      const years = unclear ? "" : lifeYears(street.born, street.died);
      const desc = !unclear && street.desc ? cap(stripYears(street.desc)) : null;
      const elsewhere = [...new Set(others.map((o) => o.cityName))];
      node.classList.toggle("is-pinned", Boolean(pinned));
      node.replaceChildren(...[
        el("p", { class: "tt-k" }, el("span", { class: `key key--${street.grp}` }), `Street · ${street.cityName}`),
        el("p", { class: "tt-street", lang: "", text: street.name }),
        el("p", { class: "tt-k" }, "Named after"),
        el("p", { class: "tt-person" },
          street.person,
          years ? el("span", { class: "tt-years", text: years }) : null),
        desc ? el("p", { class: "tt-desc", text: desc }) : null,
        unclear ? el("p", { class: "tt-note", text: "Unclear", title: "The street name doesn’t spell out this person’s name, so the link may be wrong." }) : null,
        el("p", { class: "tt-meta", text: GENDER[street.gender] ?? "" }),
        others.length
          ? el("p", { class: "tt-also", text: `+ ${others.length} more street${others.length > 1 ? "s" : ""} for ${street.gender === "woman" ? "her" : street.gender === "man" ? "him" : "them"} · ${elsewhere.join(", ")}` }) : null,
        pinned ? el("p", { class: "tt-actions" },
          street.qid ? el("a", { href: `https://www.wikidata.org/wiki/${street.qid}`, target: "_blank", rel: "noopener noreferrer", text: "Wikidata ↗" }) : null,
          el("button", { type: "button", class: "tt-close", text: "Close", onclick: () => onClose?.() })) : null,
      ].filter(Boolean));
      node.hidden = false;
      const r = node.getBoundingClientRect();
      const pad = 16;
      let left = x + pad, top = y + pad;
      if (left + r.width > bounds.width - 8) left = x - r.width - pad;
      if (top + r.height > bounds.height - 8) top = y - r.height - pad;
      node.style.left = `${Math.max(4, left)}px`;
      node.style.top = `${Math.max(4, top)}px`;
      if (pinned) node.querySelector(".tt-close")?.focus({ preventScroll: true });
    },
    hide() { node.hidden = true; node.classList.remove("is-pinned"); },
  };
}

// Wikidata descriptions often end in "(1867-1934)"; the years are shown separately.
const stripYears = (d) => d.replace(/\s*[(,]\s*(c\.\s*)?-?\d{1,4}\s*[-–]\s*-?\d{0,4}\s*\)?\s*$/u, "").trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
