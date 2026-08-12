# Map data

All files use fictional world coordinates: `(0, 0)` is the top-left corner,
X grows right, and Y grows down.

- `land.geojson` contains physical geography extracted only from `land-mask.png`.
- `countries.geojson` contains the current unnamed political polygons generated
  from `countries-mask-filled.png`.
- `countries-original.geojson` and `countries-original-display.geojson` preserve
  the pre-fill political vectors for browser comparison.
- `country-borders.geojson` stores each authoritative shared political boundary once.
- `countries-display.geojson` and `country-borders-display.geojson` are derived,
  land-clipped render datasets; the authoritative political files stay unchanged.
- `coastline.geojson` stores land/water interfaces from `land-mask.png` only.
- `land-report.json` records thresholding, connected components, validity,
  unassigned land and display clipping statistics.
- `unassigned-land.geojson` is the development overlay for accidental
  `land=true, country=null, unclaimed=false` gaps.
- `unclaimed.geojson` contains only explicit reserved `RGB(128,128,128)` neutral
  territory from the political mask and is never treated as a country.
- `countries-raw.geojson` and `country-vertices.geojson` are development-only
  Raw/Clean and vertex inspection data.
- `countries-validation-report.json` records validity, overlaps, shared edges,
  component preservation, coordinate scaling and cleanup settings.
- `countries-report.json` maps each generated ID to RGB, polygon count, and
  hole count.
- `countries-mask-fill-report.json` records propagation distances, seedless land,
  unresolved regions, Ilyra regression data, and pixel-level validation.
- `cities.geojson` contains the existing test city overlay.
- `regions.geojson` contains world-coordinate region polygons for configured
  country-local masks; every feature has `id`, `name`, `type=region`, and
  `countryId`.
- `region-borders.geojson` stores deduplicated internal boundaries;
  `region-label-points.geojson` stores representative label points.

Country names are maintained in `tools/extraction/country-names.json` and
applied with `pnpm generate:country-labels`. The command changes country
properties only and writes `country-label-points.geojson`; it never changes
country geometry. Political entities may group multiple country features:
`country-001` and `country-012` share `stateGroupId: "prosperia"`, while only
`country-012` produces the single production label `Просперия`. Debug country
IDs remain an independent optional layer.
Production anchors are computed directly from the selected polygon component
with Shapely `polylabel` at `0.05` world-unit tolerance. Manual production
corrections live separately in `tools/extraction/country-label-overrides.json`;
they are not shared with debug-ID placement.
- `regions-validation-report.json` records silhouette alignment, clipping,
  overlap, coverage, border and label validation.
- `regions/country-019/` is the first config-driven local authoring package.

Run `pnpm extract:vectors` to regenerate land and country candidates. Do not
edit generated geometry without also deciding whether it belongs in the source
mask or extraction settings.
