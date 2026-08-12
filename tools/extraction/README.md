# Raster extraction tool

Offline development tools for two independent geographies. `land-mask.png` is
the only physical source for land and coastline. `countries-mask.png` is the
only political source for countries and international boundaries. Neither mask
is allowed to define the other dataset.

Run from the repository root:

```powershell
python tools/extraction/extract_map.py
python tools/extraction/extract_land.py
```

Before regenerating political vectors, missing ownership can be filled from the
two independent masks:

```powershell
python tools/extraction/fill_countries_mask.py --mode analyze
python tools/extraction/fill_countries_mask.py --mode safe
python tools/extraction/fill_countries_mask.py --mode full
```

The political mask has three explicit states: black `RGB(0,0,0)` for ocean or
an unknown land gap, reserved `RGB(128,128,128)` for intentional unclaimed
land, and every country palette color for claimed land. Physical `land-mask.png`
distinguishes black ocean from a black unknown gap. Reserved gray is never
included in the country palette.

The fill is an 8-neighbour multi-source propagation constrained to binary land
minus explicit unclaimed pixels; water and unclaimed land are both barriers and
RGB similarity is never used. `safe` is the default and applies
`countryFill.maxFillDistancePx` from the config. `full` fills every reachable
unknown gap, while propagation components without a country seed stay
unresolved. Country and unclaimed pixels are immutable. The source mask is not
modified. Outputs are `countries-mask-filled.png`, magenta
`filled-pixels-debug.png`, red `unresolved-debug.png`, the JSON QA report, and
`country-coverage-debug.png` where black=ocean, green=country, gray=unclaimed,
red=unknown gap, blue=country outside land, and purple=unclaimed outside land.

The pipeline is `label raster → exact pixel interfaces → shared arcs → snapping
→ shared simplification → polygonize → validation`. A shared political edge is
constructed and simplified once, then reused by both adjacent country fills.
Thresholds and the small `snapTolerancePx`/`simplificationTolerance` values are
kept in `extraction.config.json`. Countries remain unnamed and receive
deterministic IDs ordered by RGB.

Generated datasets:

- `countries.geojson`: topology-clean production fills;
- `country-borders.geojson`: deduplicated international boundaries;
- `coastline.geojson`: binary land/water interfaces from `land-mask.png`;
- `land.geojson`: physical geography from `land-mask.png`;
- `countries-display.geojson`: countries clipped to land for rendering only;
- `country-borders-display.geojson`: political lines clipped to land for rendering only;
- `countries-raw.geojson`: independent-contour debug comparison;
- `country-vertices.geojson`: development-only vertices, visible from zoom 9;
- `countries-validation-report.json`: validity, overlap, component and seam QA.

## Authoritative political mask

`countries-mask.png` must have exactly the same pixel dimensions as
`worldmap.png` (1925×1080):

- use RGB or RGBA PNG;
- paint every country with one unique, flat RGB color;
- use that same color for every island belonging to that country;
- use transparent pixels or RGB `(0, 0, 0)` for ocean/unassigned pixels;
- disable antialiasing, gradients, texture, labels, borders, and color profiles
  that alter pixel values;
- do not create one image per country.

The current RGBA file contains antialiased edge colors in addition to its 23
coherent fill colors. A palette color must contain a connected exact-color area
of at least `paletteMinimumConnectedArea` pixels. Other visible edge pixels are
assigned spatially to the nearest exact fill; no resulting island component is
removed. A degenerate one-pixel-wide component receives a minimal pixel-envelope
polygon so it is not silently lost. Black and fully transparent pixels always
remain unassigned.

Run the default mask or an explicitly supplied replacement:

```powershell
python tools/extraction/extract_map.py
python tools/extraction/extract_map.py --countries-mask path/to/countries-mask.png
```

Disconnected areas with the same palette color become one GeoJSON
`MultiPolygon`. Contour hierarchy is preserved, so enclosed black/unassigned
areas become polygon holes.

The mask is never resized. Pixel-cell coordinates are converted mathematically
to world coordinates; with the current 1925×1080 source this transform is an
identity scale. Segmentation never uses bilinear or bicubic interpolation.

## Authoritative land mask

`land-mask.png` must be 1925×1080. RGB `(0,0,0)` is water and RGB
`(255,255,255)` is land. The image is read as grayscale and thresholded at 128;
intermediate antialias shades never become additional categories. No connected
land component is removed. `pnpm extract:land` updates land/coastline and the
derived display clips without modifying authoritative `countries.geojson`.

## Country-local regional datasets

Regional data is addressed as `country -> territory/component -> regions`, so a
MultiPolygon country may have independent datasets for its mainland and each
overseas territory. The country-008 dataset lives under
`public/data/regions/country-008/mainland-southwest/`. Its config selects the
principal southwest component by an interior world-coordinate anchor and an
expected bbox, then lists any explicitly associated island components by their
own anchors. Component area and GeoJSON array order are never used as semantic
identifiers. Only the principal component bbox determines the common affine
local-to-world transform; associated islands and overseas components cannot
change its scale or offset.

The extractor validates containment, contour IoU, overseas/wrong-country
intersection, label placement and preservation of one common affine transform
before publishing global GeoJSON. With `debug.enabled`, it also writes source
and world-alignment overlays to `public/debug/`.

Regenerate this dataset with:

```powershell
pnpm place:regions:country-008-mainland-southwest
```

This placement command reads the frozen `regions-local.geojson`, local shared
borders and local label points. It does not re-read or trace the PNG. One
uniform scale plus translation is selected by maximum contour IoU with the
configured target component; `scaleX` and `scaleY` are always identical.

## Country-local region masks

Regions are authored per country under `public/data/regions/<country-id>/`.
Each folder contains `regions-source.png`, categorical `regions-mask.png`, and
`regions-config.json` with an explicit `parentCountryId` and validated local to
world alignment. Runtime code never sees local pixels.

The country-019 prototype is regenerated with:

```powershell
pnpm prepare:regions
pnpm extract:regions
```

The preparation step detects the drawn dark boundary network, not relief
colors. It creates 30 mainland faces and deliberately leaves disconnected
islands black/unassigned rather than inventing region ownership. The extraction
step checks the reference silhouette against the configured parent component,
refuses low-IoU/aggressive alignment, transforms categorical polygons into world
coordinates, clips them to the authoritative parent country, and writes region
fills, shared internal borders, label points, raw debug geometry and validation.
Adding another country requires another folder/config, not changes to the
extraction algorithm.
