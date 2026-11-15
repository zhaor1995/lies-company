// Pixel positions illustrate each region's audience shares, not real locations.
// Fixed smooth noise keeps adjoining pixels together and never consumes game RNG.
function pixelNoise(x, y) {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  value = Math.imul(value ^ value >>> 13, 1274126177);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
}

function populationPixelOrder(x, y) {
  const gx = x / 5, gy = y / 5, ix = Math.floor(gx), iy = Math.floor(gy);
  const smooth = value => value * value * (3 - 2 * value);
  const tx = smooth(gx - ix), ty = smooth(gy - iy);
  const top = pixelNoise(ix, iy) * (1 - tx) + pixelNoise(ix + 1, iy) * tx;
  const bottom = pixelNoise(ix, iy + 1) * (1 - tx) + pixelNoise(ix + 1, iy + 1) * tx;
  return top * (1 - ty) + bottom * ty + pixelNoise(x + 183, y + 79) * .035;
}

export function orderPopulationPixels(tiles) {
  return tiles.map(tile => ({ ...tile, order: populationPixelOrder(tile.x, tile.y) }))
    .sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x)
    .map(({ order, ...tile }) => tile);
}

export function populationPixelCounts(total, population) {
  const finite = value => Number.isFinite(value) ? value : 0;
  const support = Math.max(0, Math.min(100, finite(population.blue)));
  const reached = Math.max(support, Math.min(100, support + Math.max(0, finite(population.exposed))));
  const blue = Math.round(total * support / 100);
  const visible = Math.round(total * reached / 100);
  return { blue, exposed: visible - blue, red: total - visible };
}
