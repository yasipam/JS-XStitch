import { buildSymbolMap } from "../mapping/symbols.js";
import { tilePattern } from "../mapping/tiling.js";
import { DMC_RGB } from "../mapping/constants.js";
import { buildStampedGrid } from "../mapping/stamped.js";

/**
 * Compiles project state into a clean object for the PDF generator.
 * Fix: Explicitly generates and passes the stamped grid for visual rendering
 * while maintaining original DMC identity for the legend.
 */
export function buildExportData(state, mappingConfig, options = {}) {
    if (!state.mappedDmcGrid) {
        throw new Error("No mapped grid available. Run mapping first.");
    }

    const dmcGrid = state.mappedDmcGrid;
    // Use override if provided (PDF stamped mode), otherwise use synced state
    const originalRgbGrid = options.overrideRgbGrid || state.mappedRgbGrid;
    const isStamped = mappingConfig.stampedMode; // [cite: 4]

    const height = dmcGrid.length;
    const width = dmcGrid[0].length;

    // 2. GENERATE THE VISUAL GRID AND LOOKUP MAP FOR EXPORT
    let exportVisualGrid = originalRgbGrid;
    let stampedLookup = {};

    if (isStamped) {
        // Re-generate the high-contrast grid to ensure PDF pattern pages match UI [cite: 8]
        // Note: We use the .grid property because buildStampedGrid returns {grid, lookup}
        const stampedResult = buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHue });
        exportVisualGrid = stampedResult.grid;
        stampedLookup = stampedResult.lookup; // This is the direct code -> neon map
    }

    // 3. CALCULATE STITCHED AREA
    let minX = width, maxX = 0, minY = height, maxY = 0;
    let totalStitches = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (String(dmcGrid[y][x]) !== "0") {
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                totalStitches++;
            }
        }
    }

    // 4. BUILD PALETTE (Locked to Original DMC Data + Baked Stamped Colors)
    const usedCodes = new Set(dmcGrid.flat().map(String));
    const palette = DMC_RGB.filter(d => usedCodes.has(String(d[0]))).map(d => {
        const code = String(d[0]);
        // Count occurrences of this specific code in the grid
        const count = dmcGrid.flat().filter(c => String(c) === code).length;

        return {
            code: code,
            name: d[1] || "Unknown", // Guarantee a string for .substring()
            rgb: d[2],               // [R, G, B]
            stampedRgb: isStamped ? (stampedLookup[code] || null) : null,
            count: count
        };
    });
    
    // 5. CONSTRUCT EXPORT OBJECT
    return {
        dmcGrid,
        rgbGrid: exportVisualGrid, // Used for drawing the pattern pages [cite: 3]
        symbolMap: buildSymbolMap(dmcGrid, DMC_RGB, options.type === 'PK'),
        palette,
        totalStitches,
        stitchedSize: {
            w: totalStitches > 0 ? maxX - minX + 1 : 0,
            h: totalStitches > 0 ? maxY - minY + 1 : 0
        },
        canvasSize: { w: width, h: height },
        fabricCount: parseInt(options.fabricCount) || 14,
        exportMode: mappingConfig.exportMode || options.mode || "cross",
        stampedMode: isStamped,
        originalImage: state.originalImageURL,
        processedImage: state.processedImageURL
    };
}