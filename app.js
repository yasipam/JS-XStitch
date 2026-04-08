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
// IFRAME BRIDGE (Global Scope)
// -----------------------------------------------------------------------------
function sendToCanvas(type, payload) {
    const canvasFrame = document.getElementById('canvasFrame');
    if (canvasFrame && canvasFrame.contentWindow) {
        canvasFrame.contentWindow.postMessage({ type, payload }, '*');
    }
}

// -----------------------------------------------------------------------------
// CORE PIPELINE: IMAGE -> GRID
// -----------------------------------------------------------------------------
let cachedProjectPalette = null;
let lastPaletteConfig = { maxSize: 0, maxColours: 0, image: null, distanceMethod: "" };

async function runMapping() {
    if (!currentImage) return;

    try {
        const maxSize = mappingConfig.maxSize;
        const maxColours = mappingConfig.maxColours;
        const distanceMethod = mappingConfig.distanceMethod;

        const useLab = distanceMethod.startsWith("cie");
        const distFn = getDistanceFn(distanceMethod, useLab);
        const dmcLibraryLab = useLab ? DMC_RGB.map(d => rgbToLab(d[2])) : null;

        const needsNewPalette = 
            cachedProjectPalette === null ||
            lastPaletteConfig.maxSize !== maxSize ||
            lastPaletteConfig.maxColours !== maxColours ||
            lastPaletteConfig.image !== currentImage ||
            lastPaletteConfig.distanceMethod !== distanceMethod;

        if (needsNewPalette) {
            const extractedColors = buildPaletteFromImage(currentImage, maxColours);
            cachedProjectPalette = extractedColors.map(rgb => {
                return nearestDmcColor(rgb, distFn, dmcLibraryLab, DMC_RGB);
            });

            lastPaletteConfig = { 
                maxSize: maxSize, 
                maxColours: maxColours, 
                image: currentImage, 
                distanceMethod: distanceMethod 
            };
        }

        const [rgbGrid, dmcGrid] = mapFullWithPalette(
            currentImage,
            maxSize,
            cachedProjectPalette, 
            1.0 + (mappingConfig.brightnessInt / 10),
            1.0 + (mappingConfig.saturationInt / 10),
            1.0 + (mappingConfig.contrastInt / 10),
            mappingConfig.reduceIsolatedStitches,
            mappingConfig.minOccurrence,
            mappingConfig.biasGreenMagenta,
            mappingConfig.biasCyanRed,
            mappingConfig.biasBlueYellow,
            distanceMethod,
            mappingConfig.antiNoise
        );

        state.setMappingResults(rgbGrid, dmcGrid);

        if (mappingConfig.stampedMode) {
            const stamped = buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHueShift });
            state.loadGrid(stamped);
            sendToCanvas('UPDATE_GRID', stamped);
        } else {
            state.loadGrid(rgbGrid);
            sendToCanvas('UPDATE_GRID', rgbGrid);
        }

        renderPalette(cachedProjectPalette);
        updatePaletteHighlights();

        requestAnimationFrame(() => {
            sendToCanvas('CMD_RESET_VIEW');
        });

    } catch (error) {
        console.error("Mapping failed:", error);
    }
}

// -----------------------------------------------------------------------------
// UI RENDERING: PALETTE & THREADS
// -----------------------------------------------------------------------------
function renderPalette(projectPalette = []) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    if (!paletteGrid || !paletteList) return;

    // Clear previous entries
    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    const projectCodes = new Set(projectPalette.map(p => String(p[0])));

    DMC_RGB.forEach(([code, name, rgb]) => {
        const isUsed = projectCodes.has(String(code));
        const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        
        // 1. Grid Swatch (Only if used in project, or show all - usually show all for picker)
        const swatch = document.createElement("div");
        swatch.className = `palette-swatch ${isUsed ? 'used' : ''}`;
        swatch.dataset.code = code;
        swatch.style.backgroundColor = rgbStr;
        swatch.title = `${code}: ${name}`;
        
        swatch.onclick = () => {
            state.setColor(rgb);
            sendToCanvas('SET_COLOR', rgb);
            document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
        };
        paletteGrid.appendChild(swatch);

        // 2. Full List Row (Searchable section)
        const row = document.createElement("div");
        row.className = "palette-row";
        row.dataset.code = code;
        row.innerHTML = `
            <div class="swatch" style="background-color: ${rgbStr}"></div>
            <div class="palette-info">
                <strong>${code}</strong> <span>${name}</span>
                ${isUsed ? '<span class="star">★</span>' : ''}
            </div>
        `;
        row.onclick = () => {
            state.setColor(rgb);
            sendToCanvas('SET_COLOR', rgb);
            // Also select in grid if visible
            const relatedSwatch = paletteGrid.querySelector(`[data-code="${code}"]`);
            if (relatedSwatch) relatedSwatch.click();
        };
        paletteList.appendChild(row);
    });
}


function setupPaletteUI() {
    const toggleBtn = document.getElementById("toggleList");
    const listContainer = document.getElementById("paletteListContainer");
    const searchInput = document.getElementById("paletteSearch");

    if (toggleBtn && listContainer) {
        toggleBtn.onclick = () => {
            const isHidden = listContainer.style.display === "none";
            listContainer.style.display = isHidden ? "block" : "none";
            toggleBtn.textContent = isHidden ? "Hide List ▲" : "Show Full List ▼";
            
            // Focus search automatically when opening
            if (isHidden && searchInput) searchInput.focus();
        };
    }

    if (searchInput) {
        searchInput.oninput = () => {
            const query = searchInput.value.toLowerCase();
            const rows = document.querySelectorAll(".palette-row");
            
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                // Filter rows based on search text
                row.style.display = text.includes(query) ? "flex" : "none";
            });
        };
    }
}

function updatePaletteHighlights() {
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

function renderThreadsTable(threadStats) {
    const tbody = document.getElementById("threadsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // 1. Sort by stitch count descending
    threadStats.sort((a, b) => b.count - a.count);

    // 2. Use the standard Euclidean distance for the table readout
    const distFn = getDistanceFn("euclidean", false);

    threadStats.forEach(stat => {
        const rgb = [stat.r, stat.g, stat.b];
        
        // 3. Find the closest DMC color for the manually picked RGB
        // We pass 'null' for the LAB library to ensure it recalculates for new colors
        const dmc = nearestDmcColor(rgb, distFn, null, DMC_RGB);
        
        const code = dmc ? dmc[0] : "???";
        const name = dmc ? dmc[1] : "Unknown";

        // 4. Standard skein calculation
        const skeins = Math.ceil(stat.count / 1600);

        const row = document.createElement("tr");
        row.innerHTML = `
            <td><div class="table-swatch" style="background-color: rgb(${stat.r},${stat.g},${stat.b})"></div></td>
            <td title="${name}"><strong>${code}</strong></td>
            <td>${stat.count}</td>
            <td>${skeins}</td>
        `;
        tbody.appendChild(row);
    });
}

// -----------------------------------------------------------------------------
// UI SETUP
// -----------------------------------------------------------------------------
window.openTab = function(evt, tabName) {
    const contents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < contents.length; i++) contents[i].style.display = "none";

    const links = document.getElementsByClassName("tab-link");
    for (let i = 0; i < links.length; i++) links[i].className = links[i].className.replace(" active", "");

    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
};

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
            sendToCanvas('UPDATE_GRID', state.pixelGrid.grid);
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
                sendToCanvas('SET_TOOL', id);
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

    if (undoBtn) undoBtn.onclick = () => sendToCanvas('CMD_UNDO');
    if (redoBtn) redoBtn.onclick = () => sendToCanvas('CMD_REDO');

    if (clearBtn) {
        clearBtn.onclick = () => {
            if (confirm("Are you sure you want to clear the canvas?")) {
                sendToCanvas('CMD_CLEAR');
                currentImage = null;
                const uploader = document.getElementById("upload");
                if (uploader) uploader.value = "";
                resetUIControls();
            }
        };
    }
}

function setupResetControls() {
    const resetOriginalBtn = document.getElementById("resetOriginalBtn");
    if (resetOriginalBtn) {
        resetOriginalBtn.onclick = () => {
            if (confirm("Restore original pattern and discard all edits?")) {
                resetUIControls();
                state.resetToMappedState();
                runMapping();
            }
        };
    }
}

// app.js

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

    const isolatedToggle = document.getElementById("reduceIsolatedStitches");
    if (isolatedToggle) {
        isolatedToggle.onchange = () => {
            mappingConfig.reduceIsolatedStitches = isolatedToggle.checked;
            runMapping();
        };
    }

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

    // NEW: Handle Minimum Occurrence directly in mapping config
    const minOccurrenceInput = document.getElementById("minOccurrenceInput");
    if (minOccurrenceInput) {
        minOccurrenceInput.onchange = () => {
            const val = parseInt(minOccurrenceInput.value, 10) || 1;
            mappingConfig.minOccurrence = val;
            // Option 1: Run a full re-map (Cleanest result)
            runMapping(); 
            // Option 2: Just cleanup the current canvas (Faster)
            // sendToCanvas('CMD_CLEANUP_MIN', val); 
        };
    }
}

// Keep this separate if you want a dedicated "Apply Cleanup" button for the current canvas
function setupMinOccurrenceControl() {
    const input = document.getElementById("minOccurrenceInput");
    const applyBtn = document.getElementById("applyMinBtn");

    if (input && applyBtn) {
        applyBtn.onclick = () => {
            const val = parseInt(input.value, 10);
            if (val >= 1) {
                console.log(`Parent: Requesting manual cleanup for < ${val} stitches`);
                sendToCanvas('CMD_CLEANUP_MIN', val);
            }
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
            // Updated to be clearer on how to implement this later
            console.warn("PNG export: Send CMD_EXPORT_PNG to iframe to get dataURL.");
            sendToCanvas('CMD_EXPORT_PNG'); 
        };
    }
}

function setupZoomButtons() {
    document.getElementById("zoomInBtn").onclick = () => sendToCanvas('CMD_ZOOM', 1);
    document.getElementById("zoomOutBtn").onclick = () => sendToCanvas('CMD_ZOOM', -1);
    document.getElementById("resetViewBtn").onclick = () => sendToCanvas('CMD_RESET_VIEW');
}

function resetUIControls() {
    mappingConfig.maxSize = 80;
    mappingConfig.maxColours = 30;
    mappingConfig.brightnessInt = 0;
    mappingConfig.saturationInt = 0;
    mappingConfig.contrastInt = 0;
    mappingConfig.biasGreenMagenta = 0;
    mappingConfig.biasCyanRed = 0;
    mappingConfig.biasBlueYellow = 0;
    mappingConfig.antiNoise = 0;
    mappingConfig.reduceIsolatedStitches = false;

    const ids = ["brightness", "saturation", "contrast", "greenToMagenta", "cyanToRed", "blueToYellow", "antiNoise"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 0;
    });

    const sizeSlider = document.getElementById("maxSizeSlider");
    const sizeInput = document.getElementById("maxSizeInput");
    if (sizeSlider) sizeSlider.value = 80;
    if (sizeInput) sizeInput.value = 80;

    const antiNoiseVal = document.getElementById("antiNoiseVal");
    if (antiNoiseVal) antiNoiseVal.textContent = "0";

    const isolatedToggle = document.getElementById("reduceIsolatedStitches");
    if (isolatedToggle) isolatedToggle.checked = false;
}

// -----------------------------------------------------------------------------
// BOOTSTRAP
// -----------------------------------------------------------------------------
window.addEventListener("load", () => {
    state = new EditorState(null); 
    const canvasFrame = document.getElementById('canvasFrame');

    const initializeCanvas = () => {
        console.log("Sending INIT to iframe...");
        sendToCanvas('INIT', {
            width: state.pixelGrid.width,
            height: state.pixelGrid.height
        });

        if (state.pixelGrid.grid) {
            sendToCanvas('UPDATE_GRID', state.pixelGrid.grid);
        }
        
        canvasFrame.contentWindow.focus();
    };

    if (canvasFrame.contentDocument && canvasFrame.contentDocument.readyState === 'complete') {
        initializeCanvas();
    } else {
        canvasFrame.onload = initializeCanvas;
    }

    setupUpload();
    setupToolButtons();
    setupEditHistory();
    setupResetControls();
    setupMappingControls();
    setupExportButtons();
    setupZoomButtons();
    setupPaletteUI();

    // GLOBAL KEYBOARD BRIDGE
    window.addEventListener("keydown", (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            if (activeEl.type !== 'range' && activeEl.type !== 'checkbox') {
                return; 
            }
        }

        const isZ = e.key.toLowerCase() === "z";
        const isY = e.key.toLowerCase() === "y";
        const hasMod = e.ctrlKey || e.metaKey;

        if (hasMod && (isZ || isY)) {
            e.preventDefault();
            let cmd = 'CMD_UNDO';
            if (isY || (isZ && e.shiftKey)) {
                cmd = 'CMD_REDO';
            }
            sendToCanvas(cmd);
        }
    });

    window.addEventListener('message', (e) => {
        const { type, payload } = e.data;

        if (type === 'REPORT_GRID_STATS') {
            const countDisplay = document.getElementById("actualColoursUsed");
            if (countDisplay) {
                countDisplay.innerHTML = `Actual Colours: ${payload.count}`;
            }
            renderThreadsTable(payload.threadStats);
        }
    });

    renderPalette([]); 
    state.setColor([0, 0, 0]);

    console.log("Cross Stitch Editor Parent Shell Initialized.");
});