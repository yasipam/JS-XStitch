// parent/export.js
// -----------------------------------------------------------------------------
// Export functionality - PDF, PNG, OXS
// -----------------------------------------------------------------------------

import { state, mappingConfig, isOxsLoaded, loadedOxsPalette, overlayImage } from './state.js';
import { sendToCanvas } from './canvas.js';
import { buildStampedRgbGrid, getLiveDmcGridFromRgb } from './oxs.js';
import { buildStampedGrid } from '../mapping/stamped.js';
import { buildExportData } from '../export/buildExportData.js';
import { exportPDF } from '../export/exportPDF.js';
import { exportOXS } from '../export/exportOXS.js';
import { DMC_RGB } from '../mapping/constants.js';

export function setupExportButtons() {
    const exportPdfBtn = document.getElementById("exportPDFBtn");
    const exportPngBtn = document.getElementById("exportPngBtn");
    const exportOxsBtn = document.getElementById("exportOxsBtn");

    const fabricSelect = document.getElementById("fabricCountSelect");
    const modeSelect = document.getElementById("exportModeSelect");
    const pdfTypeSelect = document.getElementById("pdfTypeSelect");
    const pkCheckbox = document.getElementById("addPatternKeeper");
    const stampedToggle = document.getElementById("stampedMode");

    if (exportPdfBtn) {
        exportPdfBtn.onclick = async () => {
            try {
                console.log('[PDF Export] Starting export...');
                console.log('[PDF Export] state.mappedRgbGrid exists:', !!state.mappedRgbGrid);
                console.log('[PDF Export] state.mappedDmcGrid exists:', !!state.mappedDmcGrid);

                let exportDmcGrid = state.mappedDmcGrid;
                let exportRgbGrid = state.mappedRgbGrid;

                if (state.mappedRgbGrid) {
                    const convertedGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid);
                    console.log('[PDF Export] getLiveDmcGridFromRgb result:', convertedGrid ? 'valid' : 'null');
                    if (convertedGrid) {
                        let zeroCount = 0;
                        for (let y = 0; y < Math.min(5, convertedGrid.length); y++) {
                            for (let x = 0; x < Math.min(5, convertedGrid[0].length); x++) {
                                if (convertedGrid[y][x] === "0") zeroCount++;
                            }
                        }
                        console.log('[PDF Export] First 5x5 has', zeroCount, '"0" codes');
                    }
                    exportDmcGrid = convertedGrid || exportDmcGrid;
                    exportRgbGrid = state.mappedRgbGrid;
                }

                let stampedLookup = {};
                let exportVisualGrid = exportRgbGrid;
                if (mappingConfig.stampedMode && exportDmcGrid) {
                    const stampedResult = buildStampedGrid(exportDmcGrid, { hueShift: mappingConfig.stampedHue });
                    exportVisualGrid = stampedResult.grid;
                    stampedLookup = stampedResult.lookup;
                }

                const data = buildExportData(state, mappingConfig, {
                    fabricCount: fabricSelect.value,
                    mode: modeSelect.value
                });

                data.dmcGrid = exportDmcGrid;
                data.rgbGrid = exportVisualGrid;

                const usedCodes = new Set(exportDmcGrid.flat().map(String));

                let dataPalette = [];
                if (isOxsLoaded) {
                    dataPalette = Object.entries(loadedOxsPalette)
                        .filter(([code]) => usedCodes.has(code))
                        .map(([code, entry]) => ({
                            code: code,
                            name: entry.name,
                            rgb: entry.rgb,
                            stampedRgb: mappingConfig.stampedMode ? (stampedLookup[code] || null) : null,
                            count: exportDmcGrid.flat().filter(c => String(c) === code).length
                        }));
                } else {
                    dataPalette = DMC_RGB.filter(d => usedCodes.has(String(d[0]))).map(d => ({
                        code: String(d[0]),
                        name: d[1],
                        rgb: d[2],
                        stampedRgb: mappingConfig.stampedMode ? (stampedLookup[String(d[0])] || null) : null,
                        count: exportDmcGrid.flat().filter(c => String(c) === String(d[0])).length
                    }));
                }
                data.palette = dataPalette.sort((a, b) => b.count - a.count);

                const exportType = pdfTypeSelect ? pdfTypeSelect.value : 'PRINTABLE';
                await exportPDF(data, exportType);

                if (pkCheckbox && pkCheckbox.checked) {
                    await exportPDF(data, 'PK');
                }
            } catch (error) {
                console.error("PDF Export failed:", error);
            }
        };
    }

    if (exportPngBtn) {
        exportPngBtn.onclick = () => {
            let rgbGrid = state.mappedRgbGrid;

            if (!rgbGrid) {
                console.error("No grid data available to export.");
                return;
            }

            if (mappingConfig.stampedMode && state.mappedDmcGrid && state.mappedRgbGrid) {
                let dmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid) || state.mappedDmcGrid;
                rgbGrid = buildStampedRgbGrid(dmcGrid);
            }

            exportPixelPNG(rgbGrid, "pattern_1x1.png");
        };
    }

    if (exportOxsBtn) {
        exportOxsBtn.onclick = () => {
            if (!state.mappedDmcGrid) {
                console.error("No grid data available to export.");
                return;
            }

            let exportDmcGrid = state.mappedDmcGrid;

            if (state.mappedRgbGrid) {
                console.log('[OXS Export] Converting live grid...');
                exportDmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid) || exportDmcGrid;
            }

            const stampedRgbGrid = mappingConfig.stampedMode
                ? buildStampedRgbGrid(exportDmcGrid)
                : null;
            exportOXS(
                exportDmcGrid,
                DMC_RGB,
                "kriss_kross_pattern.oxs",
                stampedRgbGrid,
                state.backstitchGrid,
                overlayImage
            );
        };
    }

    if (fabricSelect) {
        fabricSelect.onchange = () => {
            updatePatternSizeDisplay();
            populateCmFromStitchBounds();
        };
    }
}

import { updatePatternSizeDisplay, populateCmFromStitchBounds } from './ui-setup.js';

/**
 * Generates a PNG where 1 pixel = 1 stitch
 */
export function exportPixelPNG(rgbGrid, filename) {
    const height = rgbGrid.length;
    const width = rgbGrid[0].length;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const ctx = offscreenCanvas.getContext('2d', { alpha: true });

    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const rgb = rgbGrid[y][x];

            if (rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254) {
                data[index] = 0;
                data[index + 1] = 0;
                data[index + 2] = 0;
                data[index + 3] = 0;
            } else {
                data[index] = rgb[0];
                data[index + 1] = rgb[1];
                data[index + 2] = rgb[2];
                data[index + 3] = 255;
            }
        }
    }

    ctx.putImageData(imageData, 0, 0);

    const link = document.createElement('a');
    link.download = filename;
    link.href = offscreenCanvas.toDataURL("image/png");
    link.click();
}