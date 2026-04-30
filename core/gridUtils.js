// core/gridUtils.js
// -----------------------------------------------------------------------------
// Grid statistics and utility functions
// Provides:
// - getGridBounds: Calculate min/max bounds of non-zero pixels
// - getColorCounts: Count occurrences of each DMC code
// - getUsedCodes: Get set of used DMC codes
// -----------------------------------------------------------------------------

/**
 * Calculate the bounding box of non-zero (non-cloth) pixels in a DMC grid.
 * @param {Array<Array<string|number>>} dmcGrid - The DMC grid (2D array)
 * @returns {Object|null} {minX, maxX, minY, maxY, width, height, hasStitches}
 */
export function getGridBounds(dmcGrid) {
    if (!dmcGrid || dmcGrid.length === 0) {
        console.log('[getGridBounds] No grid provided');
        return null;
    }
    
    const height = dmcGrid.length;
    const width = dmcGrid[0]?.length || 0;
    
    let minX = width, maxX = -1, minY = height, maxY = -1;
    let hasStitches = false;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (String(dmcGrid[y][x]) !== "0") {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                hasStitches = true;
            }
        }
    }
    
    if (!hasStitches) {
        console.log('[getGridBounds] No stitches found in grid');
        return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0, hasStitches: false };
    }
    
    const result = {
        minX, maxX, minY, maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        hasStitches: true
    };
    
    console.log('[getGridBounds]', result);
    return result;
}

/**
 * Count occurrences of each DMC code in a grid.
 * @param {Array<Array<string|number>>} dmcGrid - The DMC grid
 * @returns {Map<string, number>} Map of DMC code to count
 */
export function getColorCounts(dmcGrid) {
    const counts = new Map();
    
    if (!dmcGrid || dmcGrid.length === 0) return counts;
    
    const height = dmcGrid.length;
    const width = dmcGrid[0]?.length || 0;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const code = String(dmcGrid[y][x]);
            if (code !== "0") {
                counts.set(code, (counts.get(code) || 0) + 1);
            }
        }
    }
    
    return counts;
}

/**
 * Get a Set of all DMC codes used in a grid.
 * @param {Array<Array<string|number>>} dmcGrid - The DMC grid
 * @returns {Set<string>} Set of used DMC codes
 */
export function getUsedCodes(dmcGrid) {
    const codes = new Set();
    
    if (!dmcGrid || dmcGrid.length === 0) return codes;
    
    const height = dmcGrid.length;
    const width = dmcGrid[0]?.length || 0;
    
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const code = String(dmcGrid[y][x]);
            if (code !== "0") {
                codes.add(code);
            }
        }
    }
    
    return codes;
}

/**
 * Calculate pattern size in cm based on stitch dimensions and fabric count.
 * @param {number} stitchW - Width in stitches
 * @param {number} stitchH - Height in stitches
 * @param {number} fabricCount - Fabric count (stitches per inch)
 * @returns {Object} {width, height} in cm
 */
export function calculateCmSize(stitchW, stitchH, fabricCount = 14) {
    return {
        width: parseFloat((stitchW / fabricCount * 2.54).toFixed(1)),
        height: parseFloat((stitchH / fabricCount * 2.54).toFixed(1))
    };
}

// Debug utility: Verify grid utilities are working
export function debugGridUtils(dmcGrid) {
    console.log('[gridUtils] Debugging grid utilities...');
    const bounds = getGridBounds(dmcGrid);
    const counts = getColorCounts(dmcGrid);
    const codes = getUsedCodes(dmcGrid);
    
    console.log('[gridUtils] Bounds:', bounds);
    console.log('[gridUtils] Unique colors:', codes.size);
    console.log('[gridUtils] Color counts:', Object.fromEntries(counts));
    
    return { bounds, counts, codes };
}
