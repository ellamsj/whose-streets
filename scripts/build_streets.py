"""Build compact street files from EqualStreetNames city data.

Usage: python3 -I scripts/build_streets.py <download_dir> <out_dir>

<download_dir>/<city>/{ways,relations}.geojson + metadata.json come from
https://github.com/EqualStreetNames/equalstreetnames-<city>/tree/master/data

Output: <out_dir>/<city>.json, coordinates in metres from the city centre,
rounded to GRID metres, simplified with Douglas-Peucker.

EqualStreetNames gender codes -> site categories
  M  man                      F  woman
  MX transgender man -> man   FX transgender woman -> woman
  X / NB  intersex / non-binary -> "nb"
  +  several people           -> "multi"
  ?  person, gender unknown   -> "unknown"
  -  / empty: not named after a person -> background only
"""
import json, math, os, re, sys, unicodedata

GRID = 8          # metres per coordinate unit
TOL_PERSON = 6    # simplification tolerance (m) for person-named streets
TOL_BASE = 25
MIN_BASE_LEN = 60  # metres; drop tiny background fragments     # for background streets

CITIES = {
    # key: (display name, country, Mapping Diversity city name)
    "athens": ("Athens", "Greece", "Athens"),
    "berlin": ("Berlin", "Germany", "Berlin"),
    "brussels": ("Brussels", "Belgium", "Brussels"),
    "bucharest": ("Bucharest", "Romania", "Bucharest"),
    "budapest": ("Budapest", "Hungary", "Budapest"),
    "copenhagen": ("Copenhagen", "Denmark", "Copenhagen"),
    "lisbon": ("Lisbon", "Portugal", "Lisbon"),
    "madrid": ("Madrid", "Spain", "Madrid"),
    "paris": ("Paris", "France", "Paris"),
    "vienna": ("Vienna", "Austria", "Vienna"),
    "warsaw": ("Warsaw", "Poland", "Warsaw"),
    "wroclaw": ("Wrocław", "Poland", "Wrocław"),
}

GMAP = {"M": "man", "MX": "man", "F": "woman", "FX": "woman",
        "X": "nb", "NB": "nb", "+": "multi", "?": "unknown"}


def pick(d, langs=("en", "fr", "de", "nl", "es", "it", "pl")):
    if not d:
        return None
    if isinstance(d, dict):
        for l in langs:
            if l in d and d[l].get("value"):
                return d[l]["value"]
        for v in d.values():
            if isinstance(v, dict) and v.get("value"):
                return v["value"]
    return None


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-9
        best, bi = -1, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    return [p for p, k in zip(pts, keep) if k]


def lines_of(geom):
    if not geom:
        return []
    t = geom["type"]
    if t == "LineString":
        return [geom["coordinates"]]
    if t == "MultiLineString":
        return geom["coordinates"]
    if t == "Polygon":
        return geom["coordinates"]
    if t == "MultiPolygon":
        return [r for p in geom["coordinates"] for r in p]
    return []


# ---- does the street name mention its namesake? ----
# Used only to flag links worth double-checking: translated names ("Felipe II"
# for Philip II of Spain) fail this test too, so a flag is not proof of an error.
STOP = {"saint", "sainte", "san", "santa", "sankt", "st", "von", "van", "der", "de", "du", "la", "le",
        "the", "of", "and", "des", "del", "di", "da", "dos", "das", "ii", "iii", "iv", "pope", "king",
        "queen", "prince", "princess", "archduchess", "archduke", "duke", "sir"}


def _norm(t):
    t = unicodedata.normalize("NFKD", t.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return t.replace("ł", "l").replace("ø", "o").replace("æ", "ae").replace("ß", "ss")


def mentions(street, details):
    labels = [v.get("value", "") for v in (details.get("labels") or {}).values() if isinstance(v, dict)]
    labels += [n if isinstance(n, str) else n.get("value", "") for n in (details.get("nicknames") or [])]
    s = _norm(street)
    for lab in labels:
        for t in re.split(r"[^\w]+", _norm(lab)):
            if len(t) < 3 or t in STOP:
                continue
            k = t[:max(4, min(len(t) - 1, 6))] if len(t) > 4 else t
            if k in s:
                return True
    return False


def person_info(details):
    if isinstance(details, list):
        names = [pick(x.get("labels")) for x in details if isinstance(x, dict)]
        names = [n for n in names if n]
        return {"p": " & ".join(names) or None, "d": None, "q": None}
    if isinstance(details, dict):
        out = {"p": pick(details.get("labels")), "d": pick(details.get("descriptions")), "q": details.get("wikidata")}
        if details.get("birth"):
            out["b"] = details["birth"]
        if details.get("death"):
            out["x"] = details["death"]
        out["details"] = details
        return out
    return {"p": None, "d": None}


def build(src, key):
    feats = []
    for fn in ("ways.geojson", "relations.geojson"):
        p = os.path.join(src, key, fn)
        if os.path.exists(p) and os.path.getsize(p) > 50:
            feats += json.load(open(p, encoding="utf8")).get("features", [])
    meta = json.load(open(os.path.join(src, key, "metadata.json"), encoding="utf8"))

    # projection centre = mean of all coordinates (cheap and good enough)
    sx = sy = n = 0
    for f in feats:
        for ln in lines_of(f["geometry"]):
            for x, y in ln:
                sx += x; sy += y; n += 1
    lon0, lat0 = sx / n, sy / n
    kx = 111320 * math.cos(math.radians(lat0)); ky = 110540

    def proj(ln, tol):
        pts = [((x - lon0) * kx, (lat0 - y) * ky) for x, y in ln]  # y down
        pts = dp(pts, tol)
        flat = []
        for x, y in pts:
            flat += [round(x / GRID), round(y / GRID)]
        return flat

    streets = {}
    base = []
    for f in feats:
        pr = f["properties"]
        g = GMAP.get(pr.get("gender") or "")
        if g is None:
            for ln in lines_of(f["geometry"]):
                fl = proj(ln, TOL_BASE)
                if len(fl) >= 4:
                    L = sum(math.hypot(fl[i+2]-fl[i], fl[i+3]-fl[i+1]) for i in range(0, len(fl)-2, 2)) * GRID
                    if L >= MIN_BASE_LEN:
                        base.append(fl)
            continue
        name = pr.get("name") or "(unnamed)"
        info = person_info(pr.get("details"))
        # one entry per street name AND person: two "Rue X" for different people stay apart
        k = (name, g, info.get("q") or info.get("p"))
        if k not in streets:
            s = {"n": name, "g": g}
            s.update({kk: vv for kk, vv in info.items() if vv and kk != "details"})
            if info.get("details") and not mentions(name, info["details"]):
                s["u"] = 1  # street name doesn't spell out the person's name
            s["l"] = []
            streets[k] = s
        for ln in lines_of(f["geometry"]):
            fl = proj(ln, TOL_PERSON)
            if len(fl) >= 4:
                streets[k]["l"].append(fl)

    sl = [s for s in streets.values() if s["l"]]
    # draw order: men first, then others, women last so they sit on top
    order = {"man": 0, "unknown": 1, "multi": 2, "nb": 3, "woman": 4}
    sl.sort(key=lambda s: order[s["g"]])
    allc = [c for s in sl for l in s["l"] for c in l] + [c for l in base for c in l]
    xs, ys = allc[0::2], allc[1::2]

    counts = {c: 0 for c in order}
    for s in sl:
        counts[s["g"]] += 1
    name, country, mdname = CITIES[key]
    return {
        "id": key, "name": name, "country": country, "mdName": mdname,
        "grid": GRID, "extent": [min(xs), min(ys), max(xs), max(ys)],
        "updated": meta.get("update"),
        "source": f"https://github.com/EqualStreetNames/equalstreetnames-{key}",
        "eqsnStats": meta.get("genders"),
        "drawnCounts": counts,
        "streets": sl,
    }, base


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    index = []
    for key in CITIES:
        d, base = build(src, key)
        json.dump({"id": key, "grid": GRID, "base": base}, open(os.path.join(out, key + "-base.json"), "w", encoding="utf8"), separators=(",", ":"))
        p = os.path.join(out, key + ".json")
        json.dump(d, open(p, "w", encoding="utf8"), ensure_ascii=False, separators=(",", ":"))
        index.append({k: d[k] for k in ("id", "name", "country", "mdName", "updated", "source", "eqsnStats", "drawnCounts")})
        print(key, len(d["streets"]), len(base), round(os.path.getsize(p) / 1e6, 2), "MB", d["drawnCounts"])
    json.dump(index, open(os.path.join(out, "index.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
