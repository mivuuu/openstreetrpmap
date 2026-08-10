/**
 * Raster concepts intentionally remain separate even while both prototype
 * URLs point at the same file. Replace only terrainPrototype when a cleaned
 * high-resolution raster or raster-tile source becomes available.
 */
export const MAP_ASSETS = Object.freeze({
  originalReference: '/worldmap.png',
  terrainPrototype: '/worldmap.png',
  countriesMaskReference: '/countries-mask.png',
  landMaskReference: '/land-mask.png',
})
