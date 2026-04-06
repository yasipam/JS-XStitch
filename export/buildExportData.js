// export/buildExportData.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// Collects ALL data needed for PDF / OXS / JSON / PNG exports.
// This is the JS equivalent of Streamlit's run_pipeline_full().
// -----------------------------------------------------------------------------

import { buildSymbolMap } from "../processing/symbols.js";
import { tilePattern } from "../processing/tiling.js";
import { DMC_RGB } from "../processing/constants.js";

/**
 * Build a complete export data object.
 *
 * @param {EditorState} state
 * @param {Object} mappingConfig - all mapping settings (brightness, biases, etc.)
 * @param {Object} options - export options (fabricCount, mode, patternName)
 */
export function buildExportData(state, mappingConfig, options = {}) {
    if (!state.mappedRgbGrid || !state.mappedDmcGrid) {
        throw new Error("No mapped grid available. Run mapping first.");
    }

    // -------------------------------------------------------------------------
    // 1. Extract core data from state
    // -------------------------------------------------------------------------
    const rgbGrid = state.mappedRgbGrid;     // true mapped RGB grid
    const dmcGrid = state.mappedDmcGrid;     // DMC code grid
    const symbolMap = state.symbolMap || buildSymbolMap(dmcGrid, DMC_RGB);

    const height = dmcGrid.length;
    const width = dmcGrid[0].length;

    // -------------------------------------------------------------------------
    // 2. Palette extraction (unique DMC codes)
    // -------------------------------------------------------------------------
    const usedCodes = new Set();
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const code = String(dmcGrid[y][x]);
            if (code !== "0") usedCodes.add(code);
        }
    }

    const palette = [];
    for (const [code, name, rgb] of DMC_RGB) {
        if (usedCodes.has(String(code))) {
            palette.push([String(code), name, rgb]);
        }
    }

    // -------------------------------------------------------------------------
    // 3. Fabric count → physical size
    // -------------------------------------------------------------------------
    const fabricCount = options.fabricCount || 14; // default Aida 14
    const inchesWide = width / fabricCount;
    const inchesHigh = height / fabricCount;

    // -------------------------------------------------------------------------
    // 4. Tiling (multi‑page splitting)
    // -------------------------------------------------------------------------
    // tilePattern() should return an array of tiles:
    //   [{ grid: <2D array>, x0, y0, w, h }, ...]
    const tiles = tilePattern(dmcGrid, {
        maxPageStitches: 80, // you can adjust this later
    });

    // -------------------------------------------------------------------------
    // 5. Export mode (cross / filled / symbol / all)
    // -------------------------------------------------------------------------
    const exportMode = options.mode || "cross";

    // -------------------------------------------------------------------------
    // 6. Pattern metadata
    // -------------------------------------------------------------------------
    const patternName = options.patternName || "Cross Stitch Pattern";

    // -------------------------------------------------------------------------
    // 7. Stamped mode (for PDF)
    // -------------------------------------------------------------------------
    const stampedMode = mappingConfig.stampedMode;
    const stampedHueShift = mappingConfig.stampedHueShift;

    // -------------------------------------------------------------------------
    // 8. Build final export object
    // -------------------------------------------------------------------------
    return {
        // core grids
        rgbGrid,
        dmcGrid,
        symbolMap,

        // palette
        palette,

        // dimensions
        width,
        height,
        inchesWide,
        inchesHigh,
        fabricCount,

        // tiling
        tiles,

        // modes
        exportMode,
        stampedMode,
        stampedHueShift,

        // metadata
        patternName,

        // mapping settings (useful for JSON export)
        mappingConfig: { ...mappingConfig },
    };
}
