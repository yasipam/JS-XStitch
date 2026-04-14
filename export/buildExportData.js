import { buildSymbolMap } from "../mapping/symbols.js";
import { tilePattern } from "../mapping/tiling.js";
import { DMC_RGB } from "../mapping/constants.js";

export function buildExportData(state, mappingConfig, options = {}) {
    if (!state.mappedRgbGrid || !state.mappedDmcGrid) {
        throw new Error("No mapped grid available. Run mapping first.");
    }

    const dmcGrid = state.mappedDmcGrid;
    const rgbGrid = state.mappedRgbGrid;
    const height = dmcGrid.length;
    const width = dmcGrid[0].length;

    // Calculate Stitched Area
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
    const stitchedW = totalStitches > 0 ? maxX - minX + 1 : 0;
    const stitchedH = totalStitches > 0 ? maxY - minY + 1 : 0;

    const usedCodes = new Set(dmcGrid.flat().map(String));
    const palette = DMC_RGB.filter(d => usedCodes.has(String(d[0]))).map(d => {
        const count = dmcGrid.flat().filter(c => String(c) === String(d[0])).length;
        return {
            code: String(d[0]),
            name: d[1],
            rgb: d[2],
            count: count,
            skeins: Math.ceil(count / 1600)
        };
    });

    return {
        dmcGrid,
        rgbGrid,
        symbolMap: state.symbolMap || buildSymbolMap(dmcGrid, DMC_RGB),
        palette,
        totalStitches,
        stitchedSize: { w: stitchedW, h: stitchedH },
        canvasSize: { w: width, h: height },
        fabricCount: parseInt(options.fabricCount) || 14,
        // Priority: MappingConfig (Sync'd in UI) -> Options -> Default
        exportMode: mappingConfig.exportMode || options.mode || "cross",
        stampedMode: mappingConfig.stampedMode,
        originalImage: state.originalImageURL,
        processedImage: state.processedImageURL
    };
}