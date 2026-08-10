# Layers

`baseMapLayers.ts` задаёт единый порядок подложки:

1. ocean/background;
2. land fill;
3. original reference (только comparison modes);
4. terrain prototype;
5. country fills;
6. subtle region fills and internal borders;
7. country-border casing and deduplicated international border;
8. coastline from the authoritative land-mask;
9. collision-managed region labels;
10. authoritative countries-mask reference (debug only);
11. country/region extraction debug overlays;
12. city points and labels.

Country fills and borders no longer share a polygon-outline layer. Fills use
`countries.geojson`; casing and main political lines use the shared-edge
`country-borders-display.geojson`; coastline uses the physically independent
`coastline.geojson`. This prevents a
shared border from being drawn twice and prevents coastline/political doubling.

`regionsLayer.ts` receives only world-coordinate GeoJSON. Internal borders fade
in from zoom 2.6 and labels from zoom 3.4; international borders remain above
regional linework. The local 2048×2048 authoring coordinates never reach
MapLibre.

`land.geojson` is never derived from countries. Runtime political fills are
clipped to land in a derived display dataset, so neutral/unassigned land remains
visible while authoritative `countries.geojson` stays unchanged.

`originalReferenceLayer.ts` и `terrainLayer.ts` являются разными понятиями и
разными MapLibre sources, даже пока оба используют `worldmap.png`.
`mapAssets.ts` содержит независимые URL, поэтому будущая замена terrain не
затронет reference mode. `baseMapMode.ts` управляет видимостью и opacity.

`citiesLayer.ts` загружает, проверяет и преобразует GeoJSON городов, затем
создаёт один MapLibre source и zoom-зависимые circle/symbol layers поверх
базовой карты.

Все публичные GeoJSON хранят координаты мира. Перед передачей в MapLibre они
проходят через `map/geojsonCoordinates.ts`.
