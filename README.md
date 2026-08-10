# Интерактивная карта вымышленного мира

Картографическое приложение на React, TypeScript, Vite и MapLibre GL JS.

## Запуск

```bash
pnpm install
pnpm dev
```

Production-сборка:

```bash
pnpm build
pnpm preview
```

Повторная генерация прототипных векторов из исходного PNG (требуются Python,
OpenCV и NumPy):

```bash
pnpm extract:vectors
```

## Координаты мира

Публичная система координат соответствует исходному изображению 1925×1080:

- начало `(0, 0)` находится в левом верхнем углу;
- `X` растёт вправо от `0` до `1925`;
- `Y` растёт вниз от `0` до `1080`.

Служебное преобразование для камеры MapLibre изолировано в
`src/map/worldCoordinates.ts`. `src/map/geojsonCoordinates.ts` рекурсивно
преобразует `Point`, `LineString`, `Polygon`, `MultiPolygon` и остальные
стандартные GeoJSON-геометрии через этот единственный адаптер. Данные приложения
остаются в координатах вымышленного мира, а не latitude/longitude Земли.

## Vector base map prototype

Векторная подложка загружается из:

- `public/data/land.geojson` — единый `MultiPolygon` суши, включая малые
  острова;
- `public/data/countries.geojson` — 23 отдельных `Feature` типа `Polygon` или
  `MultiPolygon` с обязательными `id`, `name`, `type`, `rgb`, `polygonCount` и
  `holeCount`.

`countries-mask.png` является единственным источником политической геометрии.
Каждый фактический цвет заливки становится `country-001`, `country-002` и т. д.;
раздельные области одного цвета объединяются в `MultiPolygon`, внутренние
чёрные области становятся holes. Названия остаются `Unassigned`.

Маска экспортирована с RGBA-сглаживанием и технически содержит 1809 ненулевых
RGB вместо 23 сплошных заливок. Extractor определяет фактическую палитру по
связным непрерывным областям, а краевые пиксели пространственно присоединяет к
ближайшей точной заливке. Результат и полный RGB-отчёт находятся в
`public/data/countries-report.json`. `worldmap.png` больше не участвует в
определении стран и используется только для land/terrain.

На карте доступны режимы `Vector only`, `Vector + Terrain`, `Original only` и
`Vector + Original`. `Mask alignment overlay` скрывает обе обычные raster-подложки и
показывает полупрозрачные векторы непосредственно поверх `countries-mask.png`.
На далёком масштабе основой остаётся вектор, а в terrain-режиме прозрачность
raster-рельефа плавно растёт вместе с zoom. Сейчас terrain использует исходный PNG
как временный prototype asset, но находится в отдельном source/layer и впоследствии
может быть заменён специализированным terrain raster без изменения land/country
слоёв и reference-режимов.

Параметры офлайн-выделения находятся в
`tools/extraction/extraction.config.json`: threshold, morphology, минимальная
площадь, определение палитры и simplification tolerance. Используется один
`countries-mask.png`; детали приведены в
`tools/extraction/README.md`.

## Структура

- `src/components/` — React-компоненты карты и элементы управления;
- `src/map/` — камера, base style, режимы подложки и адаптеры координат;
- `src/layers/` — небольшие фабрики terrain/land/countries/cities и единый
  порядок базовых слоёв;
- `public/data/` — GeoJSON в публичной системе координат мира;
- `src/types/` — общие типы предметной области;
- `src/utils/` — независимые вспомогательные функции;
- `tools/extraction/` — воспроизводимый офлайн-инструмент OpenCV;
- `public/worldmap.png` — неизменённая reference-копия исходной карты;
- `public/countries-mask.png` — неизменённая web-копия политической маски;
- `public/debug/extraction-preview.png` — статический preview извлечения.

Текущая схема источников MapLibre (`image` + обычные GeoJSON sources) изолирована
в layer-фабриках. При переходе на vector tiles/PMTiles меняются загрузчики и
source definitions, а React-компоненты, режимы подложки, координаты и порядок
слоёв сохраняются.

## Map theme и zoom

Визуальные параметры централизованы в `src/map/mapTheme.ts`. Там находятся:

- ocean/land colors и subdued political palette;
- country/coast/region/river/road colors;
- typography для country, region, capital, major city, city, town, village,
  river, road и POI;
- размеры city symbols;
- interpolated expressions для terrain opacity, country fill opacity,
  coastline и political borders.

Semantic thresholds находятся в `src/map/zoomLevels.ts`:

| Level | Zoom | Назначение |
| --- | ---: | --- |
| WORLD | 0 | политическая карта и столицы |
| COUNTRY | 2.25 | крупные города |
| REGION | 4 | обычные города, слабый terrain |
| CITY | 6.5 | towns и physical context |
| LOCAL | 9 | villages и локальные datasets в будущем |
| STREET | 12 | дороги/улицы в будущем |
| DETAIL | 15 | buildings/small POI в будущем |
| MAX | 18 | текущий maximum zoom |

RGB из `countries-mask.png` не используется как production color. Runtime
assignment в `countryColorAssignment.ts` применяет восемь пастельных цветов.
Таблица получена детерминированной greedy-раскраской текущего adjacency graph:
40 соседних пар, ноль одинаковых palette slots у соседей. Исходный
`countries.geojson` при этом не изменяется.

Режимы `Original only` и `Vector + Original` используют отдельный reference
source. `Vector + Terrain` использует terrain source и плавный zoom-переход:
opacity равна 0 на WORLD/COUNTRY, затем растёт до 0.9 на MAX. Country fill в
этом режиме одновременно уменьшается с 0.94 до 0.12. Сейчас terrain URL временно
указывает на `worldmap.png`; чтобы перейти на cleaned high-resolution raster,
достаточно заменить `terrainPrototype` в `src/map/mapAssets.ts`. Политические
vectors, labels и controls менять не потребуется.

## Shared country topology

`countries-mask.png` является общим raster label field, а не набором независимых
контуров. Offline pipeline в `tools/extraction/topology.py` извлекает каждый
интерфейс двух labels один раз, привязывает его к pixel grid с допуском 0.05 px,
упрощает общий arc с tolerance 0.55 px и только затем собирает polygon faces.

Physical geography находится в `land.geojson` и строится только из независимой
`land-mask.png`. Coastline находится в `coastline.geojson` и использует ту же
binary land geometry. `countries.geojson` остаётся отдельным authoritative
политическим dataset. Для rendering создаются `countries-display.geojson` и
`country-borders-display.geojson`, clipped в направлении politics → land.
Неразмеченная суша остаётся нейтральным land fill. Отчёты записываются в
`land-report.json` и `countries-validation-report.json`.

Development URL `?debug=1` добавляет режимы `Land Vector` и
`Original + Land Vector`, а также переключатели fills, main borders, casing,
coastline, vertices и Raw/Clean geometry. Большой vertex dataset не загружается
в обычном production mode.

## Города

Тестовые города хранятся в `public/data/cities.geojson` в координатах мира.
Слой загружается и преобразуется в `src/layers/citiesLayer.ts`. Чтобы добавить
город вручную, добавьте `Point` в FeatureCollection, используя координаты
`[X, Y]` и свойства `id`, `name`, `type`, `rank`, `population`.

Пороговые уровни появления: capital — 0, major — 2.25, city — 3.5,
town — 4.75, village — 6. MapLibre автоматически разрешает коллизии подписей.

Для поиска координат откройте приложение с `?debug=1`, кликните по свободному
месту карты и используйте кнопку **Copy coordinates**.
#   o p e n s t r e e t r p m a p  
 #   o p e n s t r e e t r p m a p  
 #   o p e n s t r e e t r p m a p  
 #   o p e n s t r e e t r p m a p  
 #   o p e n s t r e e t r p m a p  
 #   o p e n s t r e e t r p m a p  
 #   o p e n s t r e e t r p m a p  
 