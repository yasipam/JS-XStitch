// parent/constants.js
// -----------------------------------------------------------------------------
// DMC lookup maps and constants - must be initialized first
// -----------------------------------------------------------------------------

import { EditorState } from "../core/state.js";
import { EditorEvents } from "../core/events.js";
import { ToolRegistry } from "../core/tools.js";
import { onnxModel } from "../core/bgRemover.js";

import { mergeSimilarPaletteColors, buildPaletteFromImage, getDistanceFn, rgbToLab } from "../mapping/palette.js";
import { mapFullWithPalette, nearestDmcColor, cleanupMinOccurrence, removeIsolatedStitches, applyAntiNoise } from "../mapping/mappingEngine.js";
import { applyDitherRGB } from "../mapping/dithering.js";
import { buildStampedGrid } from "../mapping/stamped.js";
import { cropWithBox } from "../mapping/crop.js";
import { DMC_RGB } from "../mapping/constants.js";
import { findNearestDmcCode } from "../mapping/utils.js";
import { exportOXS } from "../export/exportOXS.js";
import { parseOxsFileFromFile } from "../import/importOXS.js";

import { buildExportData } from "../export/buildExportData.js";
import { exportPDF } from "../export/exportPDF.js";

import { getAllSaveSlots, saveSaveSlot, loadSaveSlot, deleteSaveSlot } from "../localSaveSlots.js";

import { getGridBounds, getColorCounts, getUsedCodes, calculateCmSize, debugGridUtils } from "../core/gridUtils.js";

// Fix #7: DMC Lookup Maps (optimizes DMC_RGB lookups)
export const dmcCodeToEntry = new Map();
export const dmcCodeToRgb = new Map();
DMC_RGB.forEach(([code, name, rgb]) => {
    const codeStr = String(code);
    dmcCodeToEntry.set(codeStr, { name, rgb });
    dmcCodeToRgb.set(codeStr, rgb);
});

// Also populate codeToRgbMap for backwards compatibility
export const codeToRgbMap = dmcCodeToRgb;

// Use Map.set() to properly add cloth sentinel (code "0")
dmcCodeToRgb.set("0", [254, 254, 254]);
codeToRgbMap["0"] = [254, 254, 254];  // Keep for backwards compatibility

export function getRgbFromCode(code) {
    return dmcCodeToRgb.get(String(code)) || [255, 255, 255];
}

export function getDmcName(code) {
    if (!code) return null;
    for (const [c, name, rgb] of DMC_RGB) {
        if (c === code) return name;
    }
    return null;
}

export function getDmcCodeFromRgb(rgb) {
    if (!rgb || !Array.isArray(rgb)) return null;
    for (const [code, name, dmcRgb] of DMC_RGB) {
        if (dmcRgb[0] === rgb[0] && dmcRgb[1] === rgb[1] && dmcRgb[2] === rgb[2]) {
            return code;
        }
    }
    return null;
}

export function getDmcLabCache(useLab) {
    if (!useLab) return null;
    if (!dmcLabCache) {
        dmcLabCache = DMC_RGB.map(d => rgbToLab([d[2]])[0]);
    }
    return dmcLabCache;
}

let dmcLabCache = null;