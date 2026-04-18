import { buildSymbolMap } from "../mapping/symbols.js";
import { tilePattern } from "../mapping/tiling.js";
import { DMC_RGB } from "../mapping/constants.js";
import { buildStampedGrid } from "../mapping/stamped.js";

/**
 * Compiles project state into a clean object for the PDF generator.
 * Fix: Explicitly generates and passes the stamped grid for visual rendering
 * while maintaining original DMC identity for the legend.
 */
// export/buildExportData.js

export function buildExportData(state, mappingConfig, options = {}) {
    if (!state.mappedDmcGrid) {
        throw new Error("No mapped grid available. Run mapping first.");
    }

    const dmcGrid = state.mappedDmcGrid;
    const isStamped = mappingConfig.stampedMode;

    // 1. GENERATE VISUAL GRID
    let exportVisualGrid = state.mappedRgbGrid;
    let stampedLookup = {};

    if (isStamped) {
        // Re-generate the high-contrast grid and lookup map
        const stampedResult = buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHue });
        exportVisualGrid = stampedResult.grid;
        stampedLookup = stampedResult.lookup;
    }

    // 2. CALCULATE STITCHED AREA
    const height = dmcGrid.length;
    const width = dmcGrid[0].length;
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

    // 3. BUILD PALETTE with Stamped Colors included
    const usedCodes = new Set(dmcGrid.flat().map(String));
    const palette = DMC_RGB.filter(d => usedCodes.has(String(d[0]))).map(d => {
        const code = String(d[0]);
        const count = dmcGrid.flat().filter(c => String(c) === code).length;

        return {
            code: code,
            name: d[1] || "Unknown",
            rgb: d[2],
            stampedRgb: isStamped ? (stampedLookup[code] || null) : null,
            count: count
        };
    });

    palette.sort((a, b) => b.count - a.count);

    return {
        dmcGrid,
        rgbGrid: exportVisualGrid,
        symbolMap: buildSymbolMap(dmcGrid, DMC_RGB, options.type === 'PK'),
        palette,
        totalStitches,
        stitchedSize: {
            w: totalStitches > 0 ? maxX - minX + 1 : 0,
            h: totalStitches > 0 ? maxY - minY + 1 : 0
        },
        canvasSize: { w: width, h: height },
        fabricCount: parseInt(options.fabricCount) || 14,
        exportMode: options.mode || mappingConfig.exportMode || "filled",
        stampedMode: isStamped,
        originalImage: state.originalImageURL
    };
}