/**
 * Raster concepts intentionally remain separate even while both prototype
 * URLs point at the same file. Replace only terrainPrototype when a cleaned
 * high-resolution raster or raster-tile source becomes available.
 */
export const MAP_ASSETS = Object.freeze({
  originalReference: `${import.meta.env.BASE_URL}worldmap.png`,
  terrainPrototype: `${import.meta.env.BASE_URL}worldmap.png`,
  countriesMaskReference: `${import.meta.env.BASE_URL}countries-mask.png`,
  landMaskReference: `${import.meta.env.BASE_URL}land-mask.png`,
})
