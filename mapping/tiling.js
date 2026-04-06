//mapping/tiling.js
// -----------------------------------------------------------------------------
// JS conversion of tiling.py
// Provides:
// - tilePattern
// -----------------------------------------------------------------------------

export function tilePattern(dmcGrid, tileW = 50, tileH = 70) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const tiles = [];

    for (let y = 0; y < h; y += tileH) {
        for (let x = 0; x < w; x += tileW) {
            // Slice the 2D grid
            const gridSlice = [];
            for (let yy = y; yy < Math.min(y + tileH, h); yy++) {
                gridSlice.push(
                    dmcGrid[yy].slice(x, Math.min(x + tileW, w))
                );
            }

            tiles.push({
                grid: gridSlice,
                offset_x: x,
                offset_y: y
            });
        }
    }

    return tiles;
}
