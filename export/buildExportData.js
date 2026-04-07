// export/buildExportData.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// Collects ALL data needed for PDF / OXS / JSON / PNG exports.
// This is the JS equivalent of Streamlit's run_pipeline_full().
// -----------------------------------------------------------------------------

// export/buildExportData.js
// -----------------------------------------------------------------------------
// Collects ALL data needed for PDF / OXS / JSON / PNG exports.
// This bridges the EditorState to the various export renderers.
// -----------------------------------------------------------------------------

import { buildSymbolMap } from "../mapping/symbols.js"; // FIXED: Was constants.js
import { tilePattern } from "../mapping/tiling.js";
import { DMC_RGB } from "../mapping/constants.js";

/**
 * Build a complete export data object.
 *
 * @param {EditorState} state
 * @param {Object} mappingConfig - all mapping settings
 * @param {Object} options - export options (fabricCount, mode, patternName)
 */
export function buildExportData(state, mappingConfig, options = {}) {
    // Check if mapping has been performed yet
    if (!state.mappedRgbGrid || !state.mappedDmcGrid) {
        throw new Error("No mapped grid available. Run mapping first.");
    }

    // -------------------------------------------------------------------------
    // 1. Extract core data from state
    // -------------------------------------------------------------------------
    const rgbGrid = state.mappedRgbGrid;     
    const dmcGrid = state.mappedDmcGrid;     
    
    // Use existing symbol map or generate a new one using the symbols module
    const symbolMap = state.symbolMap || buildSymbolMap(dmcGrid, DMC_RGB);

    const height = dmcGrid.length;
    const width = dmcGrid[0].length;

    // -------------------------------------------------------------------------
    // 2. Palette extraction (identify unique DMC codes used in the pattern)
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
    // 3. Physical sizing based on fabric count
    // -------------------------------------------------------------------------
    const fabricCount = options.fabricCount || 14; 
    const inchesWide = width / fabricCount;
    const inchesHigh = height / fabricCount;

    // -------------------------------------------------------------------------
    // 4. Tiling (Splitting the grid for multi-page PDF output)
    // -------------------------------------------------------------------------
    const tiles = tilePattern(dmcGrid, 50, 70); // Uses standard tile dimensions

    // -------------------------------------------------------------------------
    // 5. Build final consolidated export object
    // -------------------------------------------------------------------------
    return {
        rgbGrid,
        dmcGrid,
        symbolMap,
        palette,
        width,
        height,
        inchesWide,
        inchesHigh,
        fabricCount,
        tiles,
        exportMode: options.mode || "cross",
        stampedMode: mappingConfig.stampedMode,
        stampedHueShift: mappingConfig.stampedHueShift,
        patternName: options.patternName || "Cross Stitch Pattern",
        mappingConfig: { ...mappingConfig }
    };
}