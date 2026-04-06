// app.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// Main entry point for the Cross Stitch Editor.
// -----------------------------------------------------------------------------

import { EditorState } from "./core/state.js";
import { EditorEvents } from "./core/events.js";

import { buildPaletteFromSmall, mergeSimilarPaletteColors } from "./mapping/palette.js";
import { applyDitherRgb } from "./mapping/dithering.js";
import { mapFullWithPalette } from "./mapping/mappingEngine.js";

import { adjustBrightnessSaturationContrastAndBias } from "./processing/utils.js";
import { buildStampedGrid } from "./processing/stamped.js";
import { buildSymbolMap } from "./processing/symbols.js";
import { DMC_RGB } from "./processing/constants.js";

import { buildExportData } from "./export/buildExportData.js";
import { exportPDF } from "./export/exportPDF.js";
import { exportOXS, exportOXSStamped } from "./export/exportOXS.js";

let state;
let events;
let currentImage = null;
let baseRgbGrid = null;
let baseWidth = 0;
let baseHeight = 0;
let currentPalette = [];
let currentDmcGrid = null;
const lockedColours = new Set();

// -----------------------------------------------------------------------------
// MAPPING CONFIG
// -----------------------------------------------------------------------------
const mappingConfig = {
    maxSize: 100,
    maxColours: 30,
    pixelArtMode: false,
    brightnessInt: 0,
    saturationInt: 0,
    contrastInt: 0,
    biasGreenMagenta: 0,
    biasCyanRed: 0,
    biasBlueYellow: 0,
    distanceMethod: "none",
    ditherMode: "None",
    ditherStrength: 0.1,
    antiNoise: 0,
    reduceIsolatedStitches: false,
    minOccurrence: 1,
    stampedMode: false,
    stampedHueShift: 0
};

// Export settings (updated by dropdowns in the UI)
let exportFabricCount = 14;   // initial default
let exportMode = "cross";     // initial default

function setupExportDropdowns() {
    const modeSelect = document.getElementById("exportModeSelect");
    const fabricSelect = document.getElementById("fabricCountSelect");

    if (modeSelect) {
        modeSelect.onchange = () => {
            exportMode = modeSelect.value;   // "cross" | "filled" | "symbol" | "all"
            console.log("Export mode set to:", exportMode);
        };
    }

    if (fabricSelect) {
        fabricSelect.onchange = () => {
            exportFabricCount = parseInt(fabricSelect.value, 10);
            console.log("Fabric count set to:", exportFabricCount);
        };
    }
}

// -----------------------------------------------------------------------------
// IMAGE → BASE GRID
// -----------------------------------------------------------------------------
function imageToBaseGrid(img) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let w = img.width;
    let h = img.height;

    if (!mappingConfig.pixelArtMode) {
        const longest = Math.max(w, h);
        const scale = mappingConfig.maxSize / longest;
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
    }

    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    const grid = [];
    for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            row.push([data[i], data[i + 1], data[i + 2]]);
        }
        grid.push(row);
    }

    baseRgbGrid = grid;
    baseWidth = w;
    baseHeight = h;
}

// -----------------------------------------------------------------------------
// PALETTE UI
// -----------------------------------------------------------------------------
function renderPalette(palette) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    const paletteListContainer = document.getElementById("paletteListContainer");
    const paletteSearch = document.getElementById("paletteSearch");

    if (!paletteGrid || !paletteList) return;

    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    palette.forEach(([code, name, rgb]) => {
        const [r, g, b] = rgb;

        const swatch = document.createElement("div");
        swatch.className = "palette-swatch";
        swatch.style.backgroundColor = `rgb(${r},${g},${b})`;
        swatch.title = `${code} — ${name}`;
        swatch.addEventListener("click", () => {
            state.setColor([r, g, b]);
        });
        paletteGrid.appendChild(swatch);

        const row = document.createElement("div");
        row.className = "palette-row";

        const sw = document.createElement("div");
        sw.className = "swatch";
        sw.style.backgroundColor = `rgb(${r},${g},${b})`;

        const label = document.createElement("span");
        label.textContent = `${code} — ${name}`;

        row.appendChild(sw);
        row.appendChild(label);
        row.addEventListener("click", () => {
            state.setColor([r, g, b]);
        });

        paletteList.appendChild(row);
    });

    const toggleListBtn = document.getElementById("toggleList");
    if (toggleListBtn && paletteListContainer) {
        toggleListBtn.onclick = () => {
            const visible = paletteListContainer.style.display !== "none";
            paletteListContainer.style.display = visible ? "none" : "block";
            toggleListBtn.textContent = visible ? "Show List ▼" : "Hide List ▲";
        };
    }

    if (paletteSearch) {
        paletteSearch.oninput = () => {
            const q = paletteSearch.value.toLowerCase();
            Array.from(paletteList.children).forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(q) ? "" : "none";
            });
        };
    }
}

// -----------------------------------------------------------------------------
// MAPPING PIPELINE
// -----------------------------------------------------------------------------
function runMapping() {
    if (!currentImage) return;

    imageToBaseGrid(currentImage);

    let workingGrid = baseRgbGrid.map(row => row.map(px => [...px]));

    const flat = workingGrid.flat();
    const paletteRgb = buildPaletteFromSmall(flat, {
        k: mappingConfig.maxColours,
        metric: mappingConfig.distanceMethod,
        brightness: 1 + mappingConfig.brightnessInt / 10,
        saturation: 1 + mappingConfig.saturationInt / 10,
        contrast: 1 + mappingConfig.contrastInt / 10,
        smallWidth: 80
    });

    lockedColours.forEach(code => {
        const entry = DMC_RGB.find(([c]) => String(c) === String(code));
        if (entry) {
            const [, , rgb] = entry;
            if (!paletteRgb.some(p => p[0] === rgb[0] && p[1] === rgb[1] && p[2] === rgb[2])) {
                paletteRgb.push([...rgb]);
            }
        }
    });

    const mergedPaletteRgb = mergeSimilarPaletteColors(
        paletteRgb,
        0,
        lockedColours
    );

    if (mappingConfig.ditherMode !== "None") {
        const ditheredFlat = applyDitherRgb(
            workingGrid.flat(),
            {
                mode: mappingConfig.ditherMode,
                strength: mappingConfig.ditherStrength
            },
            baseWidth,
            baseHeight
        );
        const ditheredGrid = [];
        for (let y = 0; y < baseHeight; y++) {
            ditheredGrid.push(ditheredFlat.slice(y * baseWidth, (y + 1) * baseWidth));
        }
        workingGrid = ditheredGrid;
    }

    const adjustedFlat = adjustBrightnessSaturationContrastAndBias(
        workingGrid.flat(),
        1 + mappingConfig.brightnessInt / 10,
        1 + mappingConfig.saturationInt / 10,
        1 + mappingConfig.contrastInt / 10,
        mappingConfig.biasGreenMagenta / 100,
        mappingConfig.biasCyanRed / 100,
        mappingConfig.biasBlueYellow / 100
    );
    const adjustedGrid = [];
    for (let y = 0; y < baseHeight; y++) {
        adjustedGrid.push(adjustedFlat.slice(y * baseWidth, (y + 1) * baseWidth));
    }

    const { rgbGrid, dmcGrid, palette: usedPalette } = mapFullWithPalette(
        adjustedGrid,
        {
            paletteRgb: mergedPaletteRgb,
            brightness: 1 + mappingConfig.brightnessInt / 10,
            saturation: 1 + mappingConfig.saturationInt / 10,
            contrast: 1 + mappingConfig.contrastInt / 10,
            reduceIsolatedStitches: mappingConfig.reduceIsolatedStitches,
            minOccurrence: mappingConfig.minOccurrence,
            biasGreenMagenta: mappingConfig.biasGreenMagenta,
            biasCyanRed: mappingConfig.biasCyanRed,
            biasBlueYellow: mappingConfig.biasBlueYellow
        }
    );

    currentPalette = usedPalette || DMC_RGB;
    currentDmcGrid = dmcGrid;

    let displayGrid = rgbGrid;
    if (mappingConfig.stampedMode) {
        displayGrid = buildStampedGrid(dmcGrid, rgbGrid, {
            hueShift: mappingConfig.stampedHueShift
        });
    }

    state.loadGrid(displayGrid);
    state.setMappingResults(rgbGrid, dmcGrid);
    state.symbolMap = buildSymbolMap(dmcGrid, currentPalette);

    renderPalette(currentPalette);
}

function updateStampedMode() {
    if (!state.mappedRgbGrid || !state.mappedDmcGrid) return;

    if (!mappingConfig.stampedMode) {
        state.loadGrid(state.mappedRgbGrid);
        return;
    }

    const stampedGrid = buildStampedGrid(
        state.mappedDmcGrid,
        state.mappedRgbGrid,
        { hueShift: mappingConfig.stampedHueShift }
    );
    state.loadGrid(stampedGrid);
}

// -----------------------------------------------------------------------------
// UI WIRING
// -----------------------------------------------------------------------------
function setupToolButtons() {
    const pencilBtn = document.getElementById("pencilBtn");
    const eraserBtn = document.getElementById("eraserBtn");
    const fillBtn = document.getElementById("fillBtn");
    const pickerBtn = document.getElementById("toolPicker");

    const buttons = [pencilBtn, eraserBtn, fillBtn, pickerBtn];

    function setActive(btn) {
        buttons.forEach(b => b && b.classList.remove("active"));
        if (btn) btn.classList.add("active");
    }

    if (pencilBtn) {
        pencilBtn.onclick = () => {
            state.setTool("pencil");
            setActive(pencilBtn);
        };
    }
    if (eraserBtn) {
        eraserBtn.onclick = () => {
            state.setTool("eraser");
            setActive(eraserBtn);
        };
    }
    if (fillBtn) {
        fillBtn.onclick = () => {
            state.setTool("fill");
            setActive(fillBtn);
        };
    }
    if (pickerBtn) {
        pickerBtn.onclick = () => {
            state.setTool("picker");
            setActive(pickerBtn);
        };
    }
}

function setupZoomButtons() {
    const zoomInBtn = document.getElementById("zoomInBtn");
    const zoomOutBtn = document.getElementById("zoomOutBtn");
    const resetViewBtn = document.getElementById("resetViewBtn");

    if (zoomInBtn) {
        zoomInBtn.onclick = () => {
            state.setZoom(state.zoom * 1.1);
        };
    }
    if (zoomOutBtn) {
        zoomOutBtn.onclick = () => {
            state.setZoom(state.zoom * 0.9);
        };
    }
    if (resetViewBtn) {
        resetViewBtn.onclick = () => {
            state.setZoom(20);
            state.setPan(0, 0);
        };
    }
}

function setupUpload() {
    const uploadInput = document.getElementById("upload");
    if (!uploadInput) return;

    uploadInput.addEventListener("change", e => {
        const file = e.target.files[0];
        if (!file) return;

        const img = new Image();
        img.src = URL.createObjectURL(file);

        img.onload = () => {
            currentImage = img;
            runMapping();
        };
    });
}

function setupMappingControls() {
    const maxSizeSlider = document.getElementById("maxSizeSlider");
    const maxSizeInput = document.getElementById("maxSizeInput");
    const maxColoursSlider = document.getElementById("maxColours");
    const maxColoursInput = document.getElementById("maxColoursInput");

    const brightness = document.getElementById("brightness");
    const saturation = document.getElementById("saturation");
    const contrast = document.getElementById("contrast");

    const greenToMagenta = document.getElementById("greenToMagenta");
    const cyanToRed = document.getElementById("cyanToRed");
    const blueToYellow = document.getElementById("blueToYellow");

    const distanceRadios = document.querySelectorAll("input[name='colorDistance']");

    function rerun() {
        if (currentImage) runMapping();
    }

    if (maxSizeSlider && maxSizeInput) {
        maxSizeSlider.oninput = () => {
            maxSizeInput.value = maxSizeSlider.value;
            mappingConfig.maxSize = parseInt(maxSizeSlider.value, 10);
            rerun();
        };
        maxSizeInput.oninput = () => {
            maxSizeSlider.value = maxSizeInput.value;
            mappingConfig.maxSize = parseInt(maxSizeInput.value, 10);
            rerun();
        };
    }

    if (maxColoursSlider && maxColoursInput) {
        maxColoursSlider.oninput = () => {
            maxColoursInput.value = maxColoursSlider.value;
            mappingConfig.maxColours = parseInt(maxColoursSlider.value, 10);
            rerun();
        };
        maxColoursInput.oninput = () => {
            maxColoursSlider.value = maxColoursInput.value;
            mappingConfig.maxColours = parseInt(maxColoursInput.value, 10);
            rerun();
        };
    }

    if (brightness) {
        brightness.oninput = () => {
            mappingConfig.brightnessInt = parseInt(brightness.value, 10);
            rerun();
        };
    }
    if (saturation) {
        saturation.oninput = () => {
            mappingConfig.saturationInt = parseInt(saturation.value, 10);
            rerun();
        };
    }
    if (contrast) {
        contrast.oninput = () => {
            mappingConfig.contrastInt = parseInt(contrast.value, 10);
            rerun();
        };
    }

    if (greenToMagenta) {
        greenToMagenta.oninput = () => {
            mappingConfig.biasGreenMagenta = parseInt(greenToMagenta.value, 10);
            rerun();
        };
    }
    if (cyanToRed) {
        cyanToRed.oninput = () => {
            mappingConfig.biasCyanRed = parseInt(cyanToRed.value, 10);
            rerun();
        };
    }
    if (blueToYellow) {
        blueToYellow.oninput = () => {
            mappingConfig.biasBlueYellow = parseInt(blueToYellow.value, 10);
            rerun();
        };
    }

    distanceRadios.forEach(r => {
        r.onchange = () => {
            if (r.checked) {
                mappingConfig.distanceMethod = r.value;
                rerun();
            }
        };
    });
}

function setupStampedControls() {
    const stampedToggle = document.getElementById("stampedMode");
    const stampedHueShift = document.getElementById("stampedHueShift");

    if (stampedToggle) {
        stampedToggle.onchange = () => {
            mappingConfig.stampedMode = stampedToggle.checked;
            state.setStampedMode(stampedToggle.checked);
            updateStampedMode();
        };
    }

    if (stampedHueShift) {
        stampedHueShift.oninput = () => {
            mappingConfig.stampedHueShift = parseInt(stampedHueShift.value, 10);
            if (mappingConfig.stampedMode) updateStampedMode();
        };
    }
}

// -----------------------------------------------------------------------------
// EXPORTS
// -----------------------------------------------------------------------------
function setupExportButtons() {
    const exportPngBtn = document.getElementById("exportPngBtn");
    const exportPdfBtn = document.getElementById("exportPDFBtn");
    const exportJsonBtn = document.getElementById("exportJsonBtn");
    const exportOxsBtn = document.getElementById("exportOxsBtn");

    // PNG: to‑size mapped grid (no scaling)
    if (exportPngBtn) {
        exportPngBtn.onclick = () => {
            if (!state.mappedRgbGrid) return;

            const grid = state.mappedRgbGrid;
            const h = grid.length;
            const w = grid[0].length;

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            canvas.width = w;
            canvas.height = h;

            const imgData = ctx.createImageData(w, h);
            const data = imgData.data;

            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    const [r, g, b] = grid[y][x];
                    const i = (y * w + x) * 4;
                    data[i] = r;
                    data[i + 1] = g;
                    data[i + 2] = b;
                    data[i + 3] = 255;
                }
            }

            ctx.putImageData(imgData, 0, 0);

            const link = document.createElement("a");
            link.download = "pattern.png";
            link.href = canvas.toDataURL("image/png");
            link.click();
        };
    }

    // PDF
    if (exportPdfBtn) {
        exportPdfBtn.onclick = () => {
            try {
                const data = buildExportData(state, mappingConfig, {
                    fabricCount: exportFabricCount,
                    mode: exportMode,
                    patternName: "Cross Stitch Pattern"
                });
                exportPDF(data);
            } catch (err) {
                console.error("PDF export failed:", err);
            }
        };
    }

    // JSON (simple dump of export data)
    if (exportJsonBtn) {
        exportJsonBtn.onclick = () => {
            try {
                const data = buildExportData(state, mappingConfig, {
                    fabricCount: exportFabricCount,
                    mode: exportMode,
                    patternName: "Cross Stitch Pattern"
                });
                const blob = new Blob([JSON.stringify(data, null, 2)], {
                    type: "application/json"
                });
                const link = document.createElement("a");
                link.href = URL.createObjectURL(blob);
                link.download = "pattern.json";
                link.click();
            } catch (err) {
                console.error("JSON export failed:", err);
            }
        };
    }

    // OXS (normal vs stamped based on stampedMode)
    if (exportOxsBtn) {
        exportOxsBtn.onclick = () => {
            try {
                const data = buildExportData(state, mappingConfig, {
                    fabricCount: exportFabricCount,
                    mode: exportMode,
                    patternName: "Cross Stitch Pattern"
                });

                if (mappingConfig.stampedMode) {
                    exportOXSStamped(data.rgbGrid, data.dmcGrid, "pattern_stamped.oxs");
                } else {
                    exportOXS(data.dmcGrid, data.palette, "pattern.oxs");
                }
            } catch (err) {
                console.error("OXS export failed:", err);
            }
        };
    }
}

// -----------------------------------------------------------------------------
// BOOTSTRAP
// -----------------------------------------------------------------------------
window.addEventListener("load", () => {
    const canvas = document.getElementById("canvas");
    if (!canvas) {
        console.error("Canvas element #canvas not found");
        return;
    }

    state = new EditorState(canvas);
    events = new EditorEvents(canvas, state);

    setupToolButtons();
    setupZoomButtons();
    setupUpload();
    setupMappingControls();
    setupStampedControls();
    setupExportButtons();
    setupExportDropdowns();
});
