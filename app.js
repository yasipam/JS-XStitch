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
import { mergeSimilarPaletteColors, buildPaletteFromImage } from "./mapping/palette.js"; 
import { applyDitherRGB } from "./mapping/dithering.js"; 
import { mapFullWithPalette, nearestDmcColor } from "./mapping/mappingEngine.js";
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

    try {
        const colourLimit = mappingConfig.maxColours;

        // 1. Extract colors from image
        const extractedColors = buildPaletteFromImage(currentImage, colourLimit);
        
        // 2. Map to actual DMC threads (Fixes the dullness)
        // We pass "null" for the distanceFn so nearestDmcColor uses its default perceptual RGB math
        const restrictedPalette = extractedColors.map(rgb => {
            const match = nearestDmcColor(rgb, {name: "none"}, null, DMC_RGB);
            return match; // match is [code, name, [r,g,b]]
        });

        // 3. Run mapping engine
        const [rgbGrid, dmcGrid] = mapFullWithPalette(
            currentImage,
            mappingConfig.maxSize,
            restrictedPalette, 
            1.0 + (mappingConfig.brightnessInt / 10),
            1.0 + (mappingConfig.saturationInt / 10),
            1.0 + (mappingConfig.contrastInt / 10),
            mappingConfig.reduceIsolatedStitches,
            mappingConfig.minOccurrence,
            mappingConfig.biasGreenMagenta,
            mappingConfig.biasCyanRed,
            mappingConfig.biasBlueYellow,
            mappingConfig.distanceMethod
        );

        state.setMappingResults(rgbGrid, dmcGrid);

        if (mappingConfig.stampedMode) {
            const stamped = buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHueShift });
            state.loadGrid(stamped);
        } else {
            state.loadGrid(rgbGrid);
        }

        renderPalette(restrictedPalette);
        updatePaletteHighlights();

        requestAnimationFrame(() => {
            const resetBtn = document.getElementById("resetViewBtn");
            if (resetBtn) {
                resetBtn.click();
                console.log("Auto-centered image after mapping.");
            }
        });

    } catch (error) {
        console.error("Mapping failed:", error);
    }
}

// -----------------------------------------------------------------------------
// UI RENDERING: PALETTE
// -----------------------------------------------------------------------------
// app.js

// app.js
function renderPalette(projectPalette = []) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    if (!paletteGrid || !paletteList) return;

    // Clear existing content once
    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    // Create a set of codes currently in the project for fast lookup
    const projectCodes = new Set(projectPalette.map(p => String(p[0])));

    // Render THE FULL DMC LIBRARY
    DMC_RGB.forEach(([code, name, rgb]) => {
        const isUsed = projectCodes.has(String(code));
        const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        
        // --- Grid Swatch ---
        const swatch = document.createElement("div");
        swatch.className = `palette-swatch ${isUsed ? 'used' : ''}`;
        swatch.dataset.code = code; // CRITICAL: Tagging for the update function
        swatch.style.backgroundColor = rgbStr;
        swatch.title = `${code}: ${name}`;
        
        swatch.onclick = () => {
            state.setColor(rgb);
            // Visual feedback for selection
            document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
        };
        paletteGrid.appendChild(swatch);

        // --- List Row ---
        const row = document.createElement("div");
        row.className = "palette-row";
        row.dataset.code = code;
        row.innerHTML = `
            <div class="swatch" style="background-color: ${rgbStr}"></div>
            <span><strong>${code}</strong> - ${name} <span class="star">${isUsed ? '★' : ''}</span></span>
        `;
        row.onclick = () => state.setColor(rgb);
        paletteList.appendChild(row);
    });
}

function updatePaletteHighlights() {
    // 1. Get current unique colors from the grid
    const usedCodes = new Set(state.pixelGrid.toFlatArray().map(rgb => {
        // Find the DMC code for this RGB (requires a helper or nearestDmcColor)
        const match = nearestDmcColor(rgb); 
        return match ? String(match[0]) : null;
    }));

    // 2. Only update the CSS classes of existing elements
    document.querySelectorAll('.palette-swatch').forEach(swatch => {
        const code = swatch.dataset.code;
        if (usedCodes.has(code)) {
            swatch.classList.add('used'); // CSS handles the border/scale
        } else {
            swatch.classList.remove('used');
        }
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

    // 1. Initialize Global State & Events
    state = new EditorState(canvas);
    events = new EditorEvents(canvas, state);

    // 2. Initial UI setup
    state.renderer.resizeToContainer();
    setupUpload();
    setupToolButtons();
    setupMappingControls();
    setupExportButtons();
    setupZoomButtons();

    // 3. PALETTE INITIALIZATION
    // Render the full library once on load
    renderPalette([]); 

    // Wire up the reactive highlights (runs when you draw/paint)
    let paletteUpdateTimeout;

    state.on("pixelChanged", () => {
        // 1. Clear the timer if it's already running
        clearTimeout(paletteUpdateTimeout);

        // 2. Set a new timer to update in 100ms
        // This allows the drawing tool to "breathe" while you drag the mouse
        paletteUpdateTimeout = setTimeout(() => {
            updatePaletteHighlights();
        }, 100); 
    });

    // Setup the Show/Hide toggle for the list
    const toggleBtn = document.getElementById("toggleList");
    const container = document.getElementById("paletteListContainer");
    if (toggleBtn && container) {
        container.style.display = "none"; 
        toggleBtn.onclick = (e) => {
            e.preventDefault();
            const isHidden = container.style.display === "none";
            container.style.display = isHidden ? "block" : "none";
            toggleBtn.textContent = isHidden ? "Hide List ▲" : "Show List ▼";
        };
    }

    // 4. SYNC UI TO CONFIG DEFAULTS
    const maxSizeSlider = document.getElementById("maxSizeSlider");
    const maxSizeInput = document.getElementById("maxSizeInput");
    if (maxSizeSlider && maxSizeInput) {
        maxSizeSlider.value = mappingConfig.maxSize;
        maxSizeInput.value = mappingConfig.maxSize;
    }

    const maxColoursSlider = document.getElementById("maxColours");
    const maxColoursInput = document.getElementById("maxColoursInput");
    if (maxColoursSlider && maxColoursInput) {
        maxColoursSlider.value = mappingConfig.maxColours;
        maxColoursInput.value = mappingConfig.maxColours;
    }

    // 5. SEARCH LOGIC
    const paletteSearch = document.getElementById("paletteSearch");
    if (paletteSearch) {
        paletteSearch.oninput = () => {
            const q = paletteSearch.value.toLowerCase();
            const rows = document.querySelectorAll(".palette-row");
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(q) ? "flex" : "none";
            });
        };
    }
    
    console.log("Cross Stitch Editor Initialized.");
});