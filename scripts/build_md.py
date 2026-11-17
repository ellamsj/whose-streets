"""Build site JSON from the Mapping Diversity (EDJNet / OBC Transeuropa, Feb 2023) datasets.

Usage: python3 -I scripts/build_md.py data/raw data

Inputs (CSV exports of the public Google Sheets linked from
https://www.europeandatajournalism.eu/?p=226746 , "Browse our datasets"):
  data/raw/md_gender_gap.csv       "Comparative aggregate data" -> tab "gender gap"
  data/raw/md_fields.csv           same file -> tab "fields of activity"
  data/raw/md_women.csv            "List of all the women giving their name to one or more streets"
Only the 30 cities named in the dataset's scope note are kept (the sheet also
contains rows for extra cities such as München and Oslo, which are excluded).
"""
import csv, json, os, re, sys

THIRTY = {
    # sheet name -> (English name, id of matching EqualStreetNames file or None)
    "Stockholm": ("Stockholm", None), "Madrid": ("Madrid", "madrid"),
    "Sevilla": ("Seville", None), "Barcelona": ("Barcelona", None),
    "København": ("Copenhagen", "copenhagen"), "Berlin": ("Berlin", "berlin"),
    "Lisbon": ("Lisbon", "lisbon"), "Wien": ("Vienna", "vienna"),
    "Warszawa": ("Warsaw", "warsaw"), "Paris": ("Paris", "paris"),
    "Lyon": ("Lyon", None), "Łódź": ("Łódź", None), "Genova": ("Genoa", None),
    "Palermo": ("Palermo", None), "Brussel/Bruxelles": ("Brussels", "brussels"),
    "Wrocław": ("Wrocław", "wroclaw"), "Chisinau": ("Chișinău", None),
    "Roma": ("Rome", None), "Budapest": ("Budapest", "budapest"),
    "Kraków": ("Kraków", None), "Kyiv": ("Kyiv", None), "Gdańsk": ("Gdańsk", None),
    "Katowice": ("Katowice", None), "Zagreb": ("Zagreb", None),
    "Bucureşti": ("Bucharest", "bucharest"), "Torino": ("Turin", None),
    "Milano": ("Milan", None), "Athina": ("Athens", "athens"),
    "Praha": ("Prague", None), "Debrecen": ("Debrecen", None),
}


def num(s):
    s = (s or "").strip().replace(",", "")
    if s in ("", "NA"):
        return None
    return float(s[:-1]) if s.endswith("%") else int(s)


def main(raw, out):
    rows = list(csv.reader(open(os.path.join(raw, "md_gender_gap.csv"), encoding="utf8")))
    h = rows[0]
    col = {name: i for i, name in enumerate(h)}
    cities = []
    for r in rows[1:]:
        if r[0] not in THIRTY:
            continue
        en, esn = THIRTY[r[0]]
        cities.append({
            "name": en, "sheetName": r[0], "country": r[3], "countryCode": r[2],
            "esn": esn,
            "streetsTotal": num(r[col["total n. of streets"]]),
            "streetsPersons": num(r[col["n. of streets dedicated to individuals"]]),
            "men": num(r[col["n. of streets dedicated to one or more men"]]),
            "women": num(r[col["n. of streets dedicated to one or more women"]]),
            "other": num(r[col["n. of streets dedicated to individuals with mixed, non binary or uncertain gender"]]) or 0,
            "pctMen": num(r[col["share of streets dedicated to one or more men"]]),
            "pctWomen": num(r[col["share of streets dedicated to one or more women"]]),
            "pctOther": num(r[col["share of streets dedicated to individuals with mixed, non binary or uncertain gender"]]),
        })
    assert len(cities) == 30, len(cities)
    cities.sort(key=lambda c: -c["pctWomen"])
    tot = {k: sum(c[k] for c in cities) for k in ("streetsTotal", "streetsPersons", "men", "women", "other")}
    tot["pctWomen"] = round(100 * tot["women"] / tot["streetsPersons"], 1)
    tot["pctMen"] = round(100 * tot["men"] / tot["streetsPersons"], 1)
    tot["pctOther"] = round(100 * tot["other"] / tot["streetsPersons"], 1)
    tot["gap"] = tot["men"] - tot["women"]
    countries = sorted({c["country"] for c in cities})
    tot["countries"] = len(countries)

    # fields of activity: TOTAL row, men vs women (unique individuals with occupation data)
    fr = list(csv.reader(open(os.path.join(raw, "md_fields.csv"), encoding="utf8")))
    fh, ft = fr[0], fr[1]
    fields = []
    for key, label in [("culture, science, arts", "Culture, science & arts"),
                       ("politics and government", "Politics & government"),
                       ("military", "Military"), ("religion", "Religion"),
                       ("other fields", "Other")]:
        def get(prefix):
            return num(ft[fh.index(prefix + key)])
        fields.append({"field": label,
                       "men": get("N. of unique men active in "),
                       "women": get("N. of unique women active in "),
                       "pctMen": get("Share of men active in "),
                       "pctWomen": get("Share of women active in ")})

    # women list
    wr = list(csv.DictReader(open(os.path.join(raw, "md_women.csv"), encoding="utf8")))
    N = "n. of streets dedicated to the individual"
    for w in wr:
        w[N] = int(w[N])
    wr.sort(key=lambda w: (-w[N], w["name"]))
    top = [{"name": w["name"], "wikidata": w["Wikidata ID of the individual"],
            "streets": w[N],
            "cities": int(w["n. of cities celebrating the individual with one or more streets"]),
            "description": w["description (from Wikidata)"] or None,
            "occupation": w["occupation (from Wikidata)"] or None}
           for w in wr[:12]]
    unknown = sorted({w["name"].strip() for w in wr
                      if w["name"].strip()
                      and not w["description (from Wikidata)"].strip()
                      and not w["occupation (from Wikidata)"].strip()})
    unknown_cities = {}
    for w in wr:
        if w["name"].strip() in unknown:
            unknown_cities[w["name"].strip()] = w["list of cities celebrating the individual with one or more streets"].split("|")[0]
    # unique women whose Wikidata occupations include any of these exact labels
    groups = {"singers": {"singer", "opera singer"}, "composer": {"composer"},
              "actors": {"actor", "stage actor", "film actor", "television actor"},
              "director": {"film director"}}
    occ = {k: 0 for k in groups}
    for w in wr:
        os_ = {o.strip() for o in (w["occupation (from Wikidata)"] or "").split(";")}
        for k, labels in groups.items():
            if os_ & labels:
                occ[k] += 1

    women = {
        "uniqueWomenOnWikidata": len(wr),
        "top": top,
        "noDescriptionNoOccupation": len(unknown),
        "unknownSample": [{"name": n, "city": unknown_cities[n]} for n in unknown],
        "occupationCounts": occ,
        "fields": fields,
        "fieldsBase": {"men": num(ft[fh.index("n. of unique men coming with occupation data on Wikidata")]),
                       "women": num(ft[fh.index("n. of unique women coming with occupation data on Wikidata")])},
    }

    json.dump({"source": "mapping-diversity", "extracted": "2023-02", "totals": tot, "cities": cities},
              open(os.path.join(out, "cities.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
    json.dump(women, open(os.path.join(out, "women.json"), "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print(json.dumps(tot), "\n", [(t["name"], t["streets"]) for t in top[:10]], "\n", occ, len(unknown))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
