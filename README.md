# Whose Names Line Our Streets

A single-screen, static data visualisation of the gender gap in European street names.

## Run it

The page loads local JSON, so serve the folder instead of opening the file directly:

```bash
python3 -m http.server 8743
```

Then open http://localhost:8743.

## Publish with GitHub Pages

The site is plain HTML, CSS and JavaScript with no build step, so GitHub Pages can serve it as is:

1. Push this folder to a GitHub repository (the files at the top level, so `index.html` is in the root).
2. In the repository, open **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute the site is live at `https://<your-username>.github.io/<repository-name>/`.

## Structure

| Path | What it is |
|---|---|
| `index.html` | One screen: title, key figure and controls (left), the field (centre), city views (bottom), and a hidden "Index" drawer with every woman honoured and the 30-city chart. |
| `css/tokens.css` | **The design layer.** Colours, fonts, line opacities, motion timings. The canvases read these at runtime, so swapping this file restyles everything. |
| `css/main.css` | Layout and components. |
| `js/data.js` | Loads local JSON; normalises street geometry; hover hit-testing. |
| `js/viz/field.js` | The main canvas: Map view (cities overlaid) and Stacked view (one glyph per street, sorted by gender), the opening grow-and-colour sequence, pointer drift, hover / pinned street cards, and focus on one person. |
| `js/viz/tooltip.js` | The street card: street name as signposted, who it is named after, who they were. |
| `js/viz/side.js` | The women index, the 30-city ranking and the city thumbnails. |
| `data/cities.json` | Built from Mapping Diversity CSVs in `data/raw/`. (`data/women.json` is also built but not used by the current layout.) |
| `data/streets/*.json` | Built from EqualStreetNames. `<city>.json` holds person-named streets; `<city>-base.json` holds background streets (not used by the current layout). |
| `scripts/` | Rebuild scripts for the data above. |

## Rebuilding the data

```bash
python3 -I scripts/build_md.py data/raw data
```

`scripts/build_streets.py` expects a folder with `ways.geojson`, `relations.geojson` and `metadata.json` for each city, downloaded from `github.com/EqualStreetNames/equalstreetnames-<city>/tree/master/data`:

```bash
python3 -I scripts/build_streets.py <download-folder> data/streets
```

## Data notes

- Mapping Diversity's 30-city totals are 47,824 men, 4,779 women and 285 mixed, non-binary or uncertain streets. The brief's 47,842 looks like a transposition.
- In the 30-city women list, Marie Curie has 23 streets (the brief said 24). Virgin Mary (365) and Saint Anne (35) match.
- EqualStreetNames has almost no gender data for Athens or Bucharest, so they are not drawn. Vienna, Lisbon, Budapest and Madrid are only partly mapped, so line counts in the field differ from the 30-city percentages.
- Street names are the OpenStreetMap `name` tag, unchanged. Each street keeps its namesake's Wikidata ID; streets sharing a name but honouring different people stay separate.
- 671 of 13,653 drawn streets don't spell out their namesake's name (often a translation, e.g. "Felipe II" for Philip II of Spain; sometimes a wrong link in the source, e.g. Paris's "Square Boutroux" linked to Clara Zetkin). Their cards say so.
- Life years are hidden for people born before 500 CE, where Wikidata dates are estimates.
- Streets named after several people, non-binary people or people whose gender isn't recorded are drawn in grey and not in the legend; their cards name the category.
- Gender categories use a palette checked for colour-blind separation and contrast in light and dark mode.

## Credits and data licences

- Street geometry: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database Licence (ODbL), via [EqualStreetNames](https://equalstreetnames.org/) (Open Knowledge Belgium).
- People, genders and descriptions: [Wikidata](https://www.wikidata.org/) (CC0).
- 30-city figures: [Mapping Diversity](https://www.europeandatajournalism.eu/?p=226746), European Data Journalism Network (data extracted February 2023).

Check each source's terms before reusing the data elsewhere.
