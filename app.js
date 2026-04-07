// app.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// Main entry point for the Cross Stitch Editor.
// -----------------------------------------------------------------------------

// app.js
// -----------------------------------------------------------------------------
// Main entry point for the Cross Stitch Editor.
// Coordinates UI events, the Mapping Pipeline, and the Editor State.
// -----------------------------------------------------------------------------

import { EditorState } from "./core/state.js";
import { EditorEvents } from "./core/events.js";
import { ToolRegistry } from "./core/tools.js";

// Mapping Logic
import { mergeSimilarPaletteColors } from "./mapping/palette.js";
import { applyDitherRGB } from "./mapping/dithering.js"; 
import { mapFullWithPalette } from "./mapping/mappingEngine.js";
import { resizeToWidth } from "./mapping/utils.js"; 
import { buildStampedGrid } from "./mapping/stamped.js";
import { buildSymbolMap } from "./mapping/symbols.js"; 
import { DMC_RGB } from "./mapping/constants.js";

// Export Logic
import { buildExportData } from "./export/buildExportData.js";
import { exportPDF } from "./export/exportPDF.js";
import { exportOXS, exportOXSStamped } from "./export/exportOXS.js";

// Global Instances
let state;
let events;
let currentImage = null;

// -----------------------------------------------------------------------------
// MAPPING CONFIGURATION
// -----------------------------------------------------------------------------
const mappingConfig = {
    maxSize: 80,
    maxColours: 30,
    brightnessInt: 0,
    saturationInt: 0,
    contrastInt: 0,
    biasGreenMagenta: 0,
    biasCyanRed: 0,
    biasBlueYellow: 0,
    reduceIsolatedStitches: false,
    minOccurrence: 1,
    stampedMode: false,
    stampedHueShift: 0,
    distanceMethod: "euclidean",
    exportFabricCount: 14,
    exportMode: "cross"
};

// -----------------------------------------------------------------------------
// CORE PIPELINE: IMAGE -> GRID
// -----------------------------------------------------------------------------
async function runMapping() {
    if (!currentImage) return;

    // 1. Sync config from UI sliders
    mappingConfig.maxSize = parseInt(document.getElementById("maxSizeSlider").value, 10);
    mappingConfig.maxColours = parseInt(document.getElementById("maxColours").value, 10);

    // 2. Prepare Target Palette
    // For now, we use a slice of the DMC master list based on 'maxColours'
    const targetPalette = DMC_RGB.slice(0, mappingConfig.maxColours).map(item => item[2]);

    // 3. Execute the Mapping Engine
    const [rgbGrid, dmcGrid] = mapFullWithPalette(
        currentImage,
        mappingConfig.maxSize,
        targetPalette,
        1.0 + (mappingConfig.brightnessInt / 10),
        1.0 + (mappingConfig.saturationInt / 10),
        1.0 + (mappingConfig.contrastInt / 10),
        mappingConfig.reduceIsolatedStitches,
        mappingConfig.minOccurrence,
        mappingConfig.biasGreenMagenta,
        mappingConfig.biasCyanRed,
        mappingConfig.biasBlueYellow,
        mappingConfig.distanceMethod // Ensure this matches Argument 12 in the engine
    );

    // 4. Update the Application State
    state.setMappingResults(rgbGrid, dmcGrid);
    
    // If Stamped Mode is active, override the visual grid
    if (mappingConfig.stampedMode) {
        const stamped = buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHueShift });
        state.loadGrid(stamped);
    } else {
        state.loadGrid(rgbGrid);
    
// Trigger the Reset View logic immediately so the image is centered
    document.getElementById("resetViewBtn").click(); 
}
    // 5. Update UI Palette
    renderPalette(DMC_RGB.slice(0, mappingConfig.maxColours));
}

// -----------------------------------------------------------------------------
// UI RENDERING: PALETTE
// -----------------------------------------------------------------------------
function renderPalette(palette) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    if (!paletteGrid || !paletteList) return;

    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    palette.forEach(([code, name, rgb]) => {
        const swatch = document.createElement("div");
        swatch.className = "palette-swatch";
        swatch.style.backgroundColor = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        swatch.title = `${code}: ${name}`;
        swatch.onclick = () => state.setColor(rgb);
        paletteGrid.appendChild(swatch);
    });
}

// -----------------------------------------------------------------------------
// UI SETUP: CONTROLS & LISTENERS
// -----------------------------------------------------------------------------
function setupUpload() {
    const input = document.getElementById("upload");
    if (!input) return;

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        console.log("File detected:", file.name);

        const img = new Image();
        img.onload = () => {
            console.log("Image loaded into memory. Running mapping...");
            currentImage = img;
            runMapping();
        };
        img.src = URL.createObjectURL(file);
    };
}

function setupToolButtons() {
    const tools = ["pencil", "eraser", "fill", "picker"];
    tools.forEach(id => {
        const btn = document.getElementById(id === "picker" ? "toolPicker" : id + "Btn");
        if (btn) {
            btn.onclick = () => {
                state.setTool(id);
                document.querySelectorAll("#topToolbar button").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            };
        }
    });
}

// -----------------------------------------------------------------------------
// UI BINDING: Sync Sliders and Number Inputs
// -----------------------------------------------------------------------------
function setupMappingControls() {
    // Define the pairs of [SliderID, InputID, ConfigKey]
    const controlPairs = [
        ["maxSizeSlider", "maxSizeInput", "maxSize"],
        ["maxColours", "maxColoursInput", "maxColours"]
    ];

    controlPairs.forEach(([sliderId, inputId, configKey]) => {
        const slider = document.getElementById(sliderId);
        const input = document.getElementById(inputId);

        if (slider && input) {
            // When slider moves -> update input + config
            slider.oninput = () => {
                input.value = slider.value;
                mappingConfig[configKey] = parseInt(slider.value, 10);
                runMapping();
            };

            // When number is typed -> update slider + config
            input.oninput = () => {
                slider.value = input.value;
                mappingConfig[configKey] = parseInt(input.value, 10);
                runMapping();
            };
        }
    });

    const distanceRadios = document.querySelectorAll("input[name='colorDistance']");
    distanceRadios.forEach(radio => {
        radio.onchange = () => {
            if (radio.checked) {
                mappingConfig.distanceMethod = radio.value;
                runMapping();
            }
        };
    });

    // Handle Levels Sliders (Brightness, Saturation, Contrast)
    // These don't have number inputs in your HTML yet, but let's keep them reactive
    const levels = ["brightness", "saturation", "contrast"];
    levels.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.oninput = () => {
                mappingConfig[id + "Int"] = parseInt(el.value, 10);
                runMapping();
            };
        }
    });
}

    const stampedToggle = document.getElementById("stampedMode");
    if (stampedToggle) {
        stampedToggle.onchange = () => {
            mappingConfig.stampedMode = stampedToggle.checked;
            runMapping();
        };
    }

function setupExportButtons() {
    document.getElementById("exportPDFBtn").onclick = () => {
        const data = buildExportData(state, mappingConfig, {
            fabricCount: mappingConfig.exportFabricCount,
            mode: mappingConfig.exportMode
        });
        exportPDF(data);
    };

    document.getElementById("exportPngBtn").onclick = () => {
        const link = document.createElement("a");
        link.download = "pattern.png";
        link.href = state.renderer.canvas.toDataURL();
        link.click();
    };
}


function setupZoomButtons() {
    const zoomInBtn = document.getElementById("zoomInBtn");
    const zoomOutBtn = document.getElementById("zoomOutBtn");
    const resetViewBtn = document.getElementById("resetViewBtn");

    if (zoomInBtn) {
        zoomInBtn.onclick = () => {
            // Use the center of the canvas as the focal point
            const centerX = state.renderer.canvas.width / 2;
            const centerY = state.renderer.canvas.height / 2;
            ToolRegistry.zoom.applyZoom(state, -1, centerX, centerY);
        };
    }

    if (zoomOutBtn) {
        zoomOutBtn.onclick = () => {
            const centerX = state.renderer.canvas.width / 2;
            const centerY = state.renderer.canvas.height / 2;
            ToolRegistry.zoom.applyZoom(state, 1, centerX, centerY);
        };
    }

    if (resetViewBtn) {
        resetViewBtn.onclick = () => {
            const grid = state.pixelGrid;
            const padding = 40; // Pixels of space around the image
            
            // Calculate which zoom level fits the image perfectly into the canvas
            const availableW = state.renderer.canvas.width - padding;
            const availableH = state.renderer.canvas.height - padding;
            const zoomW = availableW / grid.width;
            const zoomH = availableH / grid.height;
            const bestZoom = Math.min(zoomW, zoomH, 20); // Cap zoom at 20x

            state.setZoom(bestZoom);

            // Center the grid by calculating the empty space on the sides
            const gridPxW = grid.width * bestZoom;
            const gridPxH = grid.height * bestZoom;
            const newPanX = (state.renderer.canvas.width - gridPxW) / 2;
            const newPanY = (state.renderer.canvas.height - gridPxH) / 2;

            state.setPan(newPanX, newPanY);
        };
    }

    // Add this inside setupMappingControls
    const biasControls = [
        ["greenToMagenta", "biasGreenMagenta"],
        ["cyanToRed", "biasCyanRed"],
        ["blueToYellow", "biasBlueYellow"]
    ];

    biasControls.forEach(([id, configKey]) => {
        const el = document.getElementById(id);
        if (el) {
            el.oninput = () => {
                mappingConfig[configKey] = parseInt(el.value, 10);
                runMapping();
            };
        }
    });



}

// -----------------------------------------------------------------------------
// BOOTSTRAP
// -----------------------------------------------------------------------------
window.addEventListener("load", () => {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;

    // Initialize Global State & Events
    state = new EditorState(canvas);
    events = new EditorEvents(canvas, state);

    // Initial Resize
    state.renderer.resizeToContainer();

    // Wire up UI
    setupUpload();
    setupToolButtons();
    setupMappingControls();
    setupExportButtons();
    setupZoomButtons();
    
    console.log("Cross Stitch Editor Initialized.");

    // SYNC UI TO CONFIG DEFAULTS
    const maxSizeSlider = document.getElementById("maxSizeSlider");
    const maxSizeInput = document.getElementById("maxSizeInput");
    
    if (maxSizeSlider && maxSizeInput) {
        maxSizeSlider.value = mappingConfig.maxSize;
        maxSizeInput.value = mappingConfig.maxSize;
    }

    // Do the same for Max Colours if needed
    const maxColoursSlider = document.getElementById("maxColours");
    const maxColoursInput = document.getElementById("maxColoursInput");
    
    if (maxColoursSlider && maxColoursInput) {
        maxColoursSlider.value = mappingConfig.maxColours;
        maxColoursInput.value = mappingConfig.maxColours;
    }
});