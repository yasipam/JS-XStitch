// app.js
import { EditorState } from "./core/state.js";
import { EditorEvents } from "./core/events.js";
import { ToolRegistry } from "./core/tools.js";

// Mapping Logic
import { mergeSimilarPaletteColors, buildPaletteFromImage, getDistanceFn, rgbToLab } from "./mapping/palette.js"; 
import { mapFullWithPalette, nearestDmcColor } from "./mapping/mappingEngine.js";
import { buildStampedGrid } from "./mapping/stamped.js";
import { DMC_RGB } from "./mapping/constants.js";

// Export Logic
import { buildExportData } from "./export/buildExportData.js";
import { exportPDF } from "./export/exportPDF.js";

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
    antiNoise: 0,
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

        // 1. Setup Distance Metrics
        const useLab = mappingConfig.distanceMethod.startsWith("cie");
        const distFn = getDistanceFn(mappingConfig.distanceMethod, useLab);

        // Pre-calculate the LAB values for the ENTIRE DMC library
        const masterDmcLab = useLab ? DMC_RGB.map(d => rgbToLab(d[2])) : null;

        // 2. Extract colors from image and map to DMC
        const extractedColors = buildPaletteFromImage(currentImage, colourLimit);
        
        const restrictedPalette = extractedColors.map(rgb => {
            return nearestDmcColor(rgb, distFn, masterDmcLab, DMC_RGB);
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
            mappingConfig.distanceMethod,
            mappingConfig.antiNoise
        );

        // 4. Update the actual data state
        state.setMappingResults(rgbGrid, dmcGrid);

        if (mappingConfig.stampedMode) {
            const stamped = buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHueShift });
            state.loadGrid(stamped);
        } else {
            state.loadGrid(rgbGrid);
        }

        renderPalette(restrictedPalette);
        updatePaletteHighlights();

        // 5. AUTO-CENTER FIX: Ensure renderer is resized before clicking reset
        setTimeout(() => {
            if (state.renderer) {
                state.renderer.resizeToContainer();
            }
            const resetBtn = document.getElementById("resetViewBtn");
            if (resetBtn) {
                resetBtn.click();
            }
        }, 100); 

    } catch (error) {
        console.error("Mapping failed:", error);
    }
}

// -----------------------------------------------------------------------------
// UI RENDERING: PALETTE
// -----------------------------------------------------------------------------
function renderPalette(projectPalette = []) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    if (!paletteGrid || !paletteList) return;

    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    const projectCodes = new Set(projectPalette.map(p => String(p[0])));

    DMC_RGB.forEach(([code, name, rgb]) => {
        const isUsed = projectCodes.has(String(code));
        const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        
        const swatch = document.createElement("div");
        swatch.className = `palette-swatch ${isUsed ? 'used' : ''}`;
        swatch.dataset.code = code;
        swatch.style.backgroundColor = rgbStr;
        swatch.title = `${code}: ${name}`;
        
        swatch.onclick = () => {
            state.setColor(rgb);
            document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
        };
        paletteGrid.appendChild(swatch);

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
    // Determine metric for the highlight check
    const useLab = mappingConfig.distanceMethod.startsWith("cie");
    const distFn = getDistanceFn(mappingConfig.distanceMethod, useLab);
    const masterDmcLab = useLab ? DMC_RGB.map(d => rgbToLab(d[2])) : null;

    const usedCodes = new Set(state.pixelGrid.toFlatArray().map(rgb => {
        const match = nearestDmcColor(rgb, distFn, masterDmcLab, DMC_RGB); 
        return match ? String(match[0]) : null;
    }));

    document.querySelectorAll('.palette-swatch').forEach(swatch => {
        const code = swatch.dataset.code;
        if (usedCodes.has(code)) {
            swatch.classList.add('used');
        } else {
            swatch.classList.remove('used');
        }
    });
}

// -----------------------------------------------------------------------------
// UI SETUP
// -----------------------------------------------------------------------------
function setupUpload() {
    const input = document.getElementById("upload"); 
    if (!input) return;

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const img = new Image();
        img.onload = () => {
            currentImage = img; 
            state.clear();
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

function setupEditHistory() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    const clearBtn = document.getElementById("clearAllBtn");

    if (undoBtn) undoBtn.onclick = () => state.undo();
    if (redoBtn) redoBtn.onclick = () => state.redo();
    
    if (clearBtn) {
        clearBtn.onclick = () => {
            if (confirm("Are you sure you want to clear the canvas? This will remove your current work.")) {
                // 1. Perform the undoable grid wipe
                state.clearCanvasAction();

                // 2. Clear the global image reference
                currentImage = null;

                // 3. Reset the file uploader UI
                const uploader = document.getElementById("upload");
                if (uploader) {
                    uploader.value = ""; // This removes the filename from the "Choose File" button
                }
                
                console.log("Canvas cleared and uploader reset.");
            }
        };
    }
}

function setupResetControls() {
    const resetOriginalBtn = document.getElementById("resetOriginalBtn");

    if (resetOriginalBtn) {
        resetOriginalBtn.onclick = () => {
            if (confirm("This will remove all manual edits (pencil, eraser, etc.) and restore the original generated pattern. Proceed?")) {
                state.resetToMappedState();
            }
        };
    }
}

function setupMappingControls() {
    const controlPairs = [
        ["maxSizeSlider", "maxSizeInput", "maxSize"],
        ["maxColours", "maxColoursInput", "maxColours"]
    ];

    controlPairs.forEach(([sliderId, inputId, configKey]) => {
        const slider = document.getElementById(sliderId);
        const input = document.getElementById(inputId);
        if (slider && input) {
            slider.oninput = () => {
                input.value = slider.value;
                mappingConfig[configKey] = parseInt(slider.value, 10);
                runMapping();
            };
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

    // app.js - inside setupMappingControls()
    const biasControls = [
        ["greenToMagenta", "biasGreenMagenta"],
        ["cyanToRed", "biasCyanRed"],
        ["blueToYellow", "biasBlueYellow"]
    ];

    biasControls.forEach(([id, configKey]) => {
        const el = document.getElementById(id);
        if (el) {
            el.oninput = () => {
                // mappingConfig now stores values from -10 to 10
                mappingConfig[configKey] = parseInt(el.value, 10);
                runMapping();
            };
        }
    });

    // Isolated Stitches Toggle
    const isolatedToggle = document.getElementById("reduceIsolatedStitches");
    if (isolatedToggle) {
        isolatedToggle.onchange = () => {
            mappingConfig.reduceIsolatedStitches = isolatedToggle.checked;
            runMapping();
        };
    }

    // Anti-Noise Slider
    const antiNoiseSlider = document.getElementById("antiNoise");
    const antiNoiseVal = document.getElementById("antiNoiseVal");
    if (antiNoiseSlider) {
        antiNoiseSlider.oninput = () => {
            const val = parseInt(antiNoiseSlider.value, 10);
            antiNoiseVal.textContent = val;
            mappingConfig.antiNoise = val;
            runMapping();
        };
    }

    const stampedToggle = document.getElementById("stampedMode");
    if (stampedToggle) {
        stampedToggle.onchange = () => {
            mappingConfig.stampedMode = stampedToggle.checked;
            runMapping();
        };
    }
}

function setupExportButtons() {
    const exportPdfBtn = document.getElementById("exportPDFBtn");
    if (exportPdfBtn) {
        exportPdfBtn.onclick = () => {
            const data = buildExportData(state, mappingConfig, {
                fabricCount: mappingConfig.exportFabricCount,
                mode: mappingConfig.exportMode
            });
            exportPDF(data);
        };
    }

    const exportPngBtn = document.getElementById("exportPngBtn");
    if (exportPngBtn) {
        exportPngBtn.onclick = () => {
            const link = document.createElement("a");
            link.download = "pattern.png";
            link.href = state.renderer.canvas.toDataURL();
            link.click();
        };
    }
}

function setupZoomButtons() {
    const zoomInBtn = document.getElementById("zoomInBtn");
    const zoomOutBtn = document.getElementById("zoomOutBtn");
    const resetViewBtn = document.getElementById("resetViewBtn");

    if (zoomInBtn) {
        zoomInBtn.onclick = () => {
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
            const padding = 40;
            const availableW = state.renderer.canvas.width - padding;
            const availableH = state.renderer.canvas.height - padding;
            const zoomW = availableW / grid.width;
            const zoomH = availableH / grid.height;
            const bestZoom = Math.min(zoomW, zoomH, 20);
            state.setZoom(bestZoom);
            const gridPxW = grid.width * bestZoom;
            const gridPxH = grid.height * bestZoom;
            const newPanX = (state.renderer.canvas.width - gridPxW) / 2;
            const newPanY = (state.renderer.canvas.height - gridPxH) / 2;
            state.setPan(newPanX, newPanY);
        };
    }
}

// -----------------------------------------------------------------------------
// BOOTSTRAP
// -----------------------------------------------------------------------------
window.addEventListener("load", () => {
    const canvas = document.getElementById("canvas");
    if (!canvas) return;

    state = new EditorState(canvas);
    events = new EditorEvents(canvas, state);

    state.renderer.resizeToContainer();
    setupUpload();
    setupToolButtons();
    setupEditHistory();
    setupResetControls();
    setupMappingControls();
    setupExportButtons();
    setupZoomButtons();

    renderPalette([]); 
    state.setColor([0, 0, 0]);

    let paletteUpdateTimeout;
    state.on("pixelChanged", () => {
        clearTimeout(paletteUpdateTimeout);
        paletteUpdateTimeout = setTimeout(() => {
            updatePaletteHighlights();
        }, 100); 
    });

    state.on("requestStampedReload", () => {
        if (state.mappedDmcGrid) {
            const stamped = buildStampedGrid(state.mappedDmcGrid, { 
                hueShift: mappingConfig.stampedHueShift 
            });
            state.loadGrid(stamped);
        }
    });

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