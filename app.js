// app.js
import { EditorState } from "./core/state.js";
import { EditorEvents } from "./core/events.js";
import { ToolRegistry } from "./core/tools.js";

// Mapping Logic
import { mergeSimilarPaletteColors, buildPaletteFromImage, getDistanceFn, rgbToLab } from "./mapping/palette.js";
import { mapFullWithPalette, nearestDmcColor, cleanupMinOccurrence, removeIsolatedStitches } from "./mapping/mappingEngine.js";
import { buildStampedGrid } from "./mapping/stamped.js";
import { DMC_RGB } from "./mapping/constants.js";
import { exportOXS } from "./export/exportOXS.js";

// Export Logic
import { buildExportData } from "./export/buildExportData.js";
import { exportPDF } from "./export/exportPDF.js";

// Global Instances
let state;
let events;
let currentImage = null;
let lastBaselineGrid = null;    // Existing: stores RGB baseline
let lastBaselineDmcGrid = null; // NEW: stores pure DMC baseline mapping

// -----------------------------------------------------------------------------
// MAPPING CONFIGURATION
// -----------------------------------------------------------------------------

let dmcLabCache = null;
function getDmcLabCache(useLab) {
    if (!useLab) return null;
    if (!dmcLabCache) {
        dmcLabCache = DMC_RGB.map(d => rgbToLab([d[2]])[0]);
    }
    return dmcLabCache;
}

function patchDmcGrid(baselineDmcGrid, edits, distanceMethod) {
    const useLab = distanceMethod.startsWith("cie");
    const distFn = getDistanceFn(distanceMethod, useLab);
    const labCache = getDmcLabCache(useLab);

    const liveDmcGrid = baselineDmcGrid.map(row => row.map(c => String(c)));

    for (const [key, rgb] of edits) {
        const [x, y] = key.split(',').map(Number);
        if (liveDmcGrid[y] && liveDmcGrid[y][x] !== undefined) {
            if (rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255) {
                liveDmcGrid[y][x] = "0";
            } else {
                const match = nearestDmcColor(rgb, distFn, labCache, DMC_RGB);
                liveDmcGrid[y][x] = match ? String(match[0]) : "0";
            }
        }
    }
    return liveDmcGrid;
}

function buildStampedRgbGrid(dmcGrid) {
    if (!mappingConfig.stampedMode) return null;
    return buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHue }).grid;
}

const codeToRgbMap = {};
DMC_RGB.forEach(([code, , rgb]) => { codeToRgbMap[String(code)] = rgb; });
codeToRgbMap["0"] = [255, 255, 255];

function getRgbFromCode(code) {
    return codeToRgbMap[String(code)] || [255, 255, 255];
}

function applyFilteringToGrid(dmcGrid) {
    let filtered = dmcGrid.map(row => row.map(c => String(c)));

    if (mappingConfig.reduceIsolatedStitches) {
        const rgbGrid = filtered.map(row => row.map(c => codeToRgbMap[c] || [0, 0, 0]));
        filtered = removeIsolatedStitches(filtered, rgbGrid);
    }

    if (mappingConfig.minOccurrence > 1) {
        filtered = cleanupMinOccurrence(filtered, mappingConfig.minOccurrence, codeToRgbMap);
    }

    return filtered;
}

function reapplyFiltering() {
    if (!state.mappedDmcGrid) return;

    const filteredDmcGrid = applyFilteringToGrid(state.mappedDmcGrid);
    const filteredRgbGrid = filteredDmcGrid.map(row => row.map(c => getRgbFromCode(c)));

    lastBaselineDmcGrid = filteredDmcGrid;
    lastBaselineGrid = filteredRgbGrid;
    state.mappedDmcGrid = filteredDmcGrid;
    state.mappedRgbGrid = filteredRgbGrid;
    state.setMappingResults(filteredRgbGrid, filteredDmcGrid);

    userEditDiff.clear();

    const displayGrid = mappingConfig.stampedMode
        ? buildStampedRgbGrid(filteredDmcGrid)
        : filteredRgbGrid;
    sendToCanvas('UPDATE_GRID', displayGrid);
    updateSidebarFromState();
}

const mappingConfig = {
    maxSize: 80,
    maxColours: 30,
    mergeNearest: 0,
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
    stampedHue: 0,
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
let sidebarUpdateTimer = null;

// -----------------------------------------------------------------------------
// USER-EDIT DIFF LAYER
// -----------------------------------------------------------------------------
// Stores pixels the user has manually painted over the mapped baseline.
// Structure: Map< "x,y" -> [r,g,b] >
// Reset to empty on upload or explicit "Reset to original".
// Re-populated from SYNC_GRID_TO_PARENT by diffing the live canvas against
// the last known clean baseline (state.mappedRgbGrid).
let userEditDiff = new Map();

/**
 * Capture any pixels that differ between the live canvas grid and the
 * current baseline into userEditDiff.  Called from SYNC_GRID_TO_PARENT.
 */
function captureUserEdits(liveGrid) {
    if (!lastBaselineGrid) return;
    const h = liveGrid.length;
    const w = liveGrid[0].length;
    if (h !== lastBaselineGrid.length || w !== lastBaselineGrid[0].length) return;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [lr, lg, lb] = liveGrid[y][x];
            const [br, bg, bb] = lastBaselineGrid[y][x];
            const key = `${x},${y}`;
            if (lr !== br || lg !== bg || lb !== bb) {
                userEditDiff.set(key, [lr, lg, lb]);
            } else {
                // Pixel matches baseline — no longer a custom edit
                userEditDiff.delete(key);
            }
        }
    }
}

/**
 * Composite: take a fresh baseline grid and re-apply all stored user edits
 * on top of it, returning the merged grid to send to the canvas.
 */
function applyUserEditsToBaseline(baselineGrid) {
    if (userEditDiff.size === 0) return baselineGrid;

    // Deep-clone so we don't mutate the baseline reference
    const merged = baselineGrid.map(row => row.map(px => [...px]));
    for (const [key, rgb] of userEditDiff) {
        const [x, y] = key.split(',').map(Number);
        if (merged[y] && merged[y][x]) {
            merged[y][x] = [...rgb];
        }
    }
    return merged;
}

async function runMapping(isReset = false) {
    if (!currentImage) return;

    try {
        // 1. Calculate Target Size
        let targetSize;
        if (mappingConfig.pixelArtMode) {
            targetSize = Math.max(currentImage.width, currentImage.height);
        } else {
            targetSize = parseInt(mappingConfig.maxSize, 10);
        }

        const maxColours = parseInt(mappingConfig.maxColours, 10);
        const distanceMethod = mappingConfig.distanceMethod;

        // 2. Setup Distance Functions
        const useLab = distanceMethod.startsWith("cie");
        const distFn = getDistanceFn(distanceMethod, useLab);
        const dmcLibraryLab = getDmcLabCache(useLab);

        // 3. Palette Cache Logic
        const needsNewPalette =
            cachedProjectPalette === null ||
            lastPaletteConfig.maxSize !== targetSize ||
            lastPaletteConfig.maxColours !== maxColours ||
            lastPaletteConfig.image !== currentImage ||
            lastPaletteConfig.distanceMethod !== distanceMethod ||
            lastPaletteConfig.mergeNearest !== mappingConfig.mergeNearest;  // Add this line

        if (needsNewPalette) {
            const extractedColors = buildPaletteFromImage(currentImage, maxColours);

            // NEW: Apply merge if enabled
            if (mappingConfig.mergeNearest > 0) {
                const threshold = mappingConfig.mergeNearest * 8; // 8, 16, 24, 32, 40
                const merged = mergeSimilarPaletteColors(
                    extractedColors,
                    threshold,
                    [] // No locked codes for now
                );
                cachedProjectPalette = merged.map(rgb =>
                    nearestDmcColor(rgb, distFn, dmcLibraryLab, DMC_RGB)
                );
            } else {
                cachedProjectPalette = extractedColors.map(rgb =>
                    nearestDmcColor(rgb, distFn, dmcLibraryLab, DMC_RGB)
                );
            }

            lastPaletteConfig = {
                maxSize: targetSize,
                maxColours,
                image: currentImage,
                distanceMethod,
                mergeNearest: mappingConfig.mergeNearest  // Add this
            };
        }

        // 4. Generate fresh baseline (filtering applied once via applyFilteringToGrid after user edits)
        const [rgbGrid, dmcGrid] = mapFullWithPalette(
            currentImage, targetSize, cachedProjectPalette,
            1.0 + (mappingConfig.brightnessInt / 10),
            1.0 + (mappingConfig.saturationInt / 10),
            1.0 + (mappingConfig.contrastInt / 10),
            false,
            0,
            mappingConfig.biasGreenMagenta,
            mappingConfig.biasCyanRed,
            mappingConfig.biasBlueYellow,
            distanceMethod,
            mappingConfig.antiNoise
        );

        if (isReset) userEditDiff.clear();

        // 6. Store Clean Baseline
        lastBaselineGrid = rgbGrid;
        lastBaselineDmcGrid = dmcGrid;

        // 7. Build Unified DMC Grid (Baseline + User Edits + Filtering)
        let liveDmcGrid = userEditDiff.size > 0
            ? patchDmcGrid(dmcGrid, userEditDiff, mappingConfig.distanceMethod)
            : dmcGrid;

        liveDmcGrid = applyFilteringToGrid(liveDmcGrid);
        state.mappedDmcGrid = liveDmcGrid;

        // 8. Build true-color RGB grid from DMC (always from DMC, never from stamped)
        const liveRgbGrid = liveDmcGrid.map(row => row.map(c => getRgbFromCode(c)));
        state.mappedRgbGrid = liveRgbGrid;
        state.setMappingResults(liveRgbGrid, liveDmcGrid);

// 9. Display: stamp is purely visual overlay on top of true colors
        const displayGrid = mappingConfig.stampedMode
            ? buildStampedRgbGrid(liveDmcGrid)
            : liveRgbGrid;

        // 10. Send properly to canvas - resize if dimensions changed
        const newWidth = displayGrid[0].length;
        const newHeight = displayGrid.length;
        const currentGrid = state.pixelGrid;
        const dimensionsChanged = !currentGrid ||
            currentGrid.width !== newWidth ||
            currentGrid.height !== newHeight;

        if (dimensionsChanged) {
            sendToCanvas('INIT', { width: newWidth, height: newHeight });
        }
sendToCanvas('UPDATE_GRID', displayGrid);

        // Clear undo/redo - only pencil/fill tool edits should be undoable
        state.pixelGrid.undoStack = [];
        state.pixelGrid.redoStack = [];

        updateSidebarFromState();

    } catch (error) {
        console.error("Mapping failed:", error);
    }
}

// -----------------------------------------------------------------------------
// UI RENDERING: PALETTE & THREADS
// -----------------------------------------------------------------------------
function renderPalette(usedCodes = []) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    if (!paletteGrid || !paletteList) return;

    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    const usedSet = new Set(usedCodes.map(String));

    const usedColors = [];
    const unusedColors = [];

    DMC_RGB.forEach(([code, name, rgb]) => {
        const isUsed = usedSet.has(String(code));
        if (isUsed) {
            usedColors.push([code, name, rgb]);
        } else {
            unusedColors.push([code, name, rgb]);
        }
    });

    usedColors.sort((a, b) => Number(a[0]) - Number(b[0]));

    const renderSwatch = (item) => {
        const [code, name, rgb] = item;
        const isUsed = usedSet.has(String(code));
        const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

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
            const relatedSwatch = paletteGrid.querySelector(`[data-code="${code}"]`);
            if (relatedSwatch) relatedSwatch.click();
        };
        paletteList.appendChild(row);
    };

    if (usedColors.length > 0) {
        const header = document.createElement("div");
        header.className = "palette-section-header";
        header.textContent = "IN USE";
        paletteList.appendChild(header);
    }

    usedColors.forEach(renderSwatch);

    if (unusedColors.length > 0) {
        if (usedColors.length > 0) {
            const header = document.createElement("div");
            header.className = "palette-section-header";
            header.textContent = "NOT IN USE";
            paletteList.appendChild(header);
        }
        unusedColors.forEach(renderSwatch);
    }
}


function setupPaletteUI() {
    const toggleBtn = document.getElementById("toggleList");
    const listContainer = document.getElementById("paletteListContainer");
    const searchInput = document.getElementById("paletteSearch");

    if (toggleBtn && listContainer) {
        toggleBtn.onclick = () => {
            const isHidden = listContainer.style.display === "none";
            listContainer.style.display = isHidden ? "block" : "none";
            toggleBtn.textContent = isHidden ? "CLose list ▲" : "Click to search ▼";

            // Focus search automatically when opening
            if (isHidden && searchInput) searchInput.focus();
        };
    }

    if (searchInput) {
        searchInput.oninput = () => {
            const query = searchInput.value.toLowerCase();
            const rows = document.querySelectorAll(".palette-row");
            const headers = document.querySelectorAll(".palette-section-header");

            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(query) ? "flex" : "none";
            });

            let currentHeader = null;
            rows.forEach(row => {
                if (row.previousElementSibling && row.previousElementSibling.classList.contains("palette-section-header")) {
                    currentHeader = row.previousElementSibling;
                }
                if (row.style.display !== "none" && currentHeader) {
                    currentHeader.style.display = "block";
                }
            });

            headers.forEach(header => {
                let hasVisibleInSection = false;
                let sibling = header.nextElementSibling;
                while (sibling && !sibling.classList.contains("palette-section-header")) {
                    if (sibling.style.display !== "none") {
                        hasVisibleInSection = true;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
                header.style.display = hasVisibleInSection ? "block" : "none";
            });
        };
    }
}

function renderThreadsTable(threadStats) {
    const tbody = document.getElementById("threadsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    threadStats.sort((a, b) => b.count - a.count);
    const distFn = getDistanceFn("euclidean", false);

    threadStats.forEach(stat => {
        let dmcEntry = null;

        // USE CODE IF PROVIDED: Avoids redundant distance math on every draw
        if (stat.code) {
            dmcEntry = DMC_RGB.find(d => String(d[0]) === String(stat.code));
        }

        // Fallback for non-stamped legacy stats
        if (!dmcEntry) {
            const currentRgb = [stat.r, stat.g, stat.b];
            dmcEntry = nearestDmcColor(currentRgb, distFn, null, DMC_RGB);
        }

        if (!dmcEntry) return;

        const [code, name, originalRgb] = dmcEntry;
        const skeins = Math.ceil(stat.count / 1600);

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <div class="table-swatch" style="background-color: rgb(${originalRgb[0]}, ${originalRgb[1]}, ${originalRgb[2]}); border: 1px solid #ccc;"></div>
            </td>
            <td title="${name}"><strong>${code}</strong></td>
            <td>${stat.count}</td>
            <td>${skeins}</td>
        `;
        tbody.appendChild(row);
    });
}

function updateSidebarFromState() {
    if (!state || !state.mappedDmcGrid) return;

    const countDisplay = document.getElementById("actualColoursUsed");
    const counts = {};

    state.mappedDmcGrid.flat().forEach(code => {
        const sCode = String(code);
        if (sCode === "0") return; // Skip cloth
        counts[sCode] = (counts[sCode] || 0) + 1;
    });

    const threadStats = Object.entries(counts).map(([code, count]) => {
        const dmcEntry = DMC_RGB.find(d => String(d[0]) === code);
        if (!dmcEntry) return null;

        return {
            code: code,
            r: dmcEntry[2][0],
            g: dmcEntry[2][1],
            b: dmcEntry[2][2],
            count: count
        };
    }).filter(s => s !== null);

    if (countDisplay) {
        countDisplay.innerHTML = `Actual Colours: ${threadStats.length}`;
    }
    renderThreadsTable(threadStats);
    renderPalette(threadStats.map(s => s.code));
    updatePatternSizeDisplay();
}

function updatePatternSizeDisplay() {
    const display = document.getElementById("patternSizeDisplay");
    if (!display || !state || !state.mappedDmcGrid) {
        if (display) display.textContent = "--";
        return;
    }

    const dmcGrid = state.mappedDmcGrid;
    const height = dmcGrid.length;
    const width = dmcGrid[0] ? dmcGrid[0].length : 0;

    let minX = width, maxX = 0, minY = height, maxY = 0;
    let hasStitches = false;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (String(dmcGrid[y][x]) !== "0") {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                hasStitches = true;
            }
        }
    }

    if (!hasStitches) {
        display.textContent = "--";
        return;
    }

    const stitchW = maxX - minX + 1;
    const stitchH = maxY - minY + 1;

    const fabricSelect = document.getElementById("fabricCountSelect");
    const fabricCount = fabricSelect ? parseInt(fabricSelect.value) || 14 : 14;

    const sizeW = (stitchW / fabricCount * 2.54).toFixed(1);
    const sizeH = (stitchH / fabricCount * 2.54).toFixed(1);

    display.textContent = `${stitchW} x ${stitchH} stitches (${sizeW} x ${sizeH} cm on ${fabricCount}ct)`;
}


// -----------------------------------------------------------------------------
// UI SETUP
// -----------------------------------------------------------------------------
window.openTab = function (evt, tabName) {
    const contents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < contents.length; i++) contents[i].style.display = "none";

    const links = document.getElementsByClassName("tab-link");
    for (let i = 0; i < links.length; i++) links[i].className = links[i].className.replace(" active", "");

    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
};

// app.js

function setupUpload() {
    const input = document.getElementById("upload");
    if (!input) return;

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Use FileReader to get a persistent Base64 string for the PDF export
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Data = event.target.result;

            // CRITICAL: Save to state so the PDF cover page can access it
            state.originalImageURL = base64Data;

            const img = new Image();
            img.onload = () => {
                currentImage = img;

                resetUIControls();

                const sizeSlider = document.getElementById("maxSizeSlider");
                const sizeInput = document.getElementById("maxSizeInput");
                if (sizeSlider) sizeSlider.disabled = false;
                if (sizeInput) sizeInput.disabled = false;

                state.clear();
                userEditDiff.clear();
                lastBaselineGrid = null;
                // Tell the iframe to prepare for an 80px grid
                sendToCanvas('INIT', {
                    width: 80,
                    height: Math.floor(80 * (img.height / img.width))
                });

                runMapping(true); // isReset=true so view resets to best-fit
            };
            img.src = base64Data;
        };
        reader.readAsDataURL(file);
    };
}

function setupToolButtons() {
    const tools = ["pencil", "eraser", "fill", "picker"];
    tools.forEach(id => {
        const btn = document.getElementById(id === "picker" ? "toolPicker" : id + "Btn");
        if (btn) {
            btn.onclick = () => {
                // Prevent tool switching if Stamped Mode is ON
                if (mappingConfig.stampedMode) {
                    alert("Drawing tools are disabled in Stamped Mode. Turn off Stamped Mode to edit.");
                    return;
                }
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
                userEditDiff.clear();
                lastBaselineGrid = null;
                runMapping(true);
            }
        };
    }
}

// app.js
function setupMappingControls() {
    // 1. Size & Color Pairs
    const controlPairs = [
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

    const maxSizeSlider = document.getElementById("maxSizeSlider");
    const maxSizeInput = document.getElementById("maxSizeInput");

    const handleMaxSizeChange = () => {
        const newSize = parseInt(maxSizeSlider.value, 10);

        const hasEdits = userEditDiff.size > 0;
        const hasMinOccurrence = mappingConfig.minOccurrence !== 1;
        const hasIsolated = mappingConfig.reduceIsolatedStitches;
        const hasAntiNoise = mappingConfig.antiNoise !== 0;

        if (hasEdits || hasMinOccurrence || hasIsolated || hasAntiNoise) {
            if (!confirm("Resizing the image will remove all your drawn edits and reset cleanup options. Continue?")) {
                maxSizeSlider.value = mappingConfig.maxSize;
                maxSizeInput.value = mappingConfig.maxSize;
                return;
            }

            userEditDiff.clear();
            lastBaselineGrid = null;

            mappingConfig.maxSize = 80;
            maxSizeSlider.value = 80;
            maxSizeInput.value = 80;
            mappingConfig.minOccurrence = 1;
            mappingConfig.reduceIsolatedStitches = false;
            mappingConfig.antiNoise = 0;

            const minOccurrenceInput = document.getElementById("minOccurrenceInput");
            if (minOccurrenceInput) minOccurrenceInput.value = 1;

            const reduceIsolatedStitchesToggle = document.getElementById("reduceIsolatedStitches");
            if (reduceIsolatedStitchesToggle) reduceIsolatedStitchesToggle.checked = false;

            const antiNoiseSlider = document.getElementById("antiNoise");
            const antiNoiseVal = document.getElementById("antiNoiseVal");
            if (antiNoiseSlider) antiNoiseSlider.value = 0;
            if (antiNoiseVal) antiNoiseVal.textContent = "0";

            runMapping(true);
        } else {
            mappingConfig.maxSize = newSize;
            runMapping();
        }
    };

    if (maxSizeSlider) {
        maxSizeSlider.oninput = () => {
            maxSizeInput.value = maxSizeSlider.value;
            handleMaxSizeChange();
        };
    }
    if (maxSizeInput) {
        maxSizeInput.oninput = () => {
            maxSizeSlider.value = maxSizeInput.value;
            handleMaxSizeChange();
        };
    }

    const pixelArtToggle = document.getElementById("pixelArtMode");

    if (pixelArtToggle) {
        pixelArtToggle.onchange = () => {
            const isPixelMode = pixelArtToggle.checked;
            mappingConfig.pixelArtMode = isPixelMode;

            if (currentImage) {
                const newSize = isPixelMode
                    ? Math.max(currentImage.width, currentImage.height)
                    : parseInt(maxSizeSlider.value, 10);

                const hasEdits = userEditDiff.size > 0;
                const hasMinOccurrence = mappingConfig.minOccurrence !== 1;
                const hasIsolated = mappingConfig.reduceIsolatedStitches;
                const hasAntiNoise = mappingConfig.antiNoise !== 0;

                if (hasEdits || hasMinOccurrence || hasIsolated || hasAntiNoise) {
                    if (!confirm("Switching pixel art mode will remove all your drawn edits and reset cleanup options. Continue?")) {
                        pixelArtToggle.checked = !isPixelMode;
                        return;
                    }

                    userEditDiff.clear();
                    lastBaselineGrid = null;

                    mappingConfig.maxSize = 80;
                    maxSizeSlider.value = 80;
                    maxSizeSlider.disabled = false;
                    maxSizeInput.disabled = false;
                    maxSizeInput.value = 80;
                    mappingConfig.minOccurrence = 1;
                    mappingConfig.reduceIsolatedStitches = false;
                    mappingConfig.antiNoise = 0;

                    const minOccurrenceInput = document.getElementById("minOccurrenceInput");
                    if (minOccurrenceInput) minOccurrenceInput.value = 1;

                    const reduceIsolatedStitchesToggle = document.getElementById("reduceIsolatedStitches");
                    if (reduceIsolatedStitchesToggle) reduceIsolatedStitchesToggle.checked = false;

                    const antiNoiseSlider = document.getElementById("antiNoise");
                    const antiNoiseVal = document.getElementById("antiNoiseVal");
                    if (antiNoiseSlider) antiNoiseSlider.value = 0;
                    if (antiNoiseVal) antiNoiseVal.textContent = "0";

                    runMapping(true);
                } else {
                    mappingConfig.maxSize = newSize;
                    runMapping();
                }

                if (isPixelMode) {
                    maxSizeSlider.disabled = true;
                    maxSizeInput.disabled = true;
                } else {
                    maxSizeSlider.disabled = false;
                    maxSizeInput.disabled = false;
                }
            }
        };
    }

    const mergeSlider = document.getElementById("mergeNearest");
    const mergeVal = document.getElementById("mergeNearestVal");
    if (mergeSlider) {
        mergeSlider.oninput = () => {
            const val = parseInt(mergeSlider.value, 10);
            mappingConfig.mergeNearest = val;

            // Update label
            const labels = ["Off", "Light", "Mild", "Medium", "Strong", "Very Strong"];
            mergeVal.textContent = labels[val];

            runMapping();
        };
    }

    // 3. Distance Radios
    const distanceRadios = document.querySelectorAll("input[name='colorDistance']");
    distanceRadios.forEach(radio => {
        radio.onchange = () => {
            if (radio.checked) {
                mappingConfig.distanceMethod = radio.value;
                runMapping();
            }
        };
    });

    // 4. Levels (Brightness/Sat/Contrast)
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

    // 5. Bias Controls
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

    // 6. Toggles & Smoothers
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

    const reduceIsolatedStitchesToggle = document.getElementById("reduceIsolatedStitches");
    if (reduceIsolatedStitchesToggle) {
        reduceIsolatedStitchesToggle.checked = mappingConfig.reduceIsolatedStitches;

        reduceIsolatedStitchesToggle.onchange = () => {
            mappingConfig.reduceIsolatedStitches = reduceIsolatedStitchesToggle.checked;

            const antiNoiseSlider = document.getElementById("antiNoise");
            const antiNoiseVal = document.getElementById("antiNoiseVal");

            if (reduceIsolatedStitchesToggle.checked) {
                mappingConfig.antiNoise = Math.max(mappingConfig.antiNoise, 1);
                if (antiNoiseSlider) antiNoiseSlider.value = mappingConfig.antiNoise;
                if (antiNoiseVal) antiNoiseVal.textContent = mappingConfig.antiNoise;
            } else {
                mappingConfig.antiNoise = 0;
                if (antiNoiseSlider) antiNoiseSlider.value = 0;
                if (antiNoiseVal) antiNoiseVal.textContent = "0";
            }
            runMapping();
        };
    }

    const stampedToggle = document.getElementById("stampedMode");
    const stampedHue = document.getElementById("stampedHue");
    const stampedHueVal = document.getElementById("stampedHueVal");
    const stampedControls = document.getElementById("stampedControls");

    if (stampedToggle) {
        // Ensure initial UI state matches configuration
        stampedToggle.checked = mappingConfig.stampedMode;
        if (stampedControls) {
            stampedControls.style.display = mappingConfig.stampedMode ? "block" : "none";
        }

        stampedToggle.onchange = () => {
            mappingConfig.stampedMode = stampedToggle.checked;

            if (stampedControls) {
                stampedControls.style.display = mappingConfig.stampedMode ? "block" : "none";
            }

            // DISABLING TOOLS
            const drawingTools = ["pencil", "eraser", "fill", "picker"];
            drawingTools.forEach(id => {
                const btn = document.getElementById(id === "picker" ? "toolPicker" : id + "Btn");
                if (btn) {
                    btn.disabled = mappingConfig.stampedMode;
                    btn.classList.remove("active");
                }
            });

            if (mappingConfig.stampedMode) {
                state.setTool("pan");
                sendToCanvas('SET_TOOL', "pan");
                const panBtn = document.getElementById("panBtn");
                if (panBtn) panBtn.classList.add("active");
            }

            // Instant toggle: switch between stamped overlay and true colors
            if (!state.mappedDmcGrid) return;
            const displayGrid = mappingConfig.stampedMode
                ? buildStampedRgbGrid(state.mappedDmcGrid)
                : state.mappedRgbGrid;
            sendToCanvas('UPDATE_GRID', displayGrid);
        };
    }

    if (stampedHue) {
        // Ensure initial UI state matches configuration
        stampedHue.value = mappingConfig.stampedHue;
        if (stampedHueVal) {
            stampedHueVal.textContent = `${mappingConfig.stampedHue}°`;
        }

        // Use oninput for immediate, smooth feedback as the user slides
        stampedHue.oninput = () => {
            mappingConfig.stampedHue = parseInt(stampedHue.value, 10);

            if (stampedHueVal) {
                stampedHueVal.textContent = `${stampedHue.value}°`;
            }

            // Instant: rebuild stamped overlay and send to canvas
            if (!state.mappedDmcGrid) return;
            const displayGrid = buildStampedRgbGrid(state.mappedDmcGrid);
            sendToCanvas('UPDATE_GRID', displayGrid);
        };
    }

    // 8. Min Occurrence
    const minOccurrenceInput = document.getElementById("minOccurrenceInput");
    if (minOccurrenceInput) {
        minOccurrenceInput.oninput = () => {
            const val = parseInt(minOccurrenceInput.value, 10) || 1;
            mappingConfig.minOccurrence = val;
            runMapping();
        };
    }

    const reapplyFilterBtn = document.getElementById("reapplyFilterBtn");
    if (reapplyFilterBtn) {
        reapplyFilterBtn.onclick = () => {
            if (!currentImage) {
                alert("Please upload an image first.");
                return;
            }
            reapplyFiltering();
        };
    }
} // <--- Properly closing setupMappingControls here

function setupExportButtons() {
    const exportPdfBtn = document.getElementById("exportPDFBtn");
    const exportPngBtn = document.getElementById("exportPngBtn");
    const exportOxsBtn = document.getElementById("exportOxsBtn");

    // Selectors for PDF configuration
    const fabricSelect = document.getElementById("fabricCountSelect");
    const modeSelect = document.getElementById("exportModeSelect"); // crosses, symbol, filled
    const pdfTypeSelect = document.getElementById("pdfTypeSelect"); // Printable vs Standard
    const pkCheckbox = document.getElementById("addPatternKeeper");
    const stampedToggle = document.getElementById("stampedMode");

    if (exportPdfBtn) {
        exportPdfBtn.onclick = async () => {
            try {
                const data = buildExportData(state, mappingConfig, {
                    fabricCount: fabricSelect.value,
                    mode: modeSelect.value
                });

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
    
    // --- PNG EXPORT ---
    if (exportPngBtn) {
        exportPngBtn.onclick = () => {
            let rgbGrid = state.mappedRgbGrid;

            if (!rgbGrid) {
                console.error("No grid data available to export.");
                return;
            }

            if (mappingConfig.stampedMode && state.mappedDmcGrid) {
                rgbGrid = buildStampedRgbGrid(state.mappedDmcGrid);
            }

            exportPixelPNG(rgbGrid, "pattern_1x1.png");
        };
    }

    // --- OXS EXPORT ---
    if (exportOxsBtn) {
        exportOxsBtn.onclick = () => {
            if (!state.mappedDmcGrid) {
                console.error("No grid data available to export.");
                return;
            }

            const stampedRgbGrid = mappingConfig.stampedMode
                ? buildStampedRgbGrid(state.mappedDmcGrid)
                : null;
            exportOXS(
                state.mappedDmcGrid,
                DMC_RGB,
                "kriss_kross_pattern.oxs",
                stampedRgbGrid
            );
        };
    }

    if (fabricSelect) {
        fabricSelect.onchange = () => {
            updatePatternSizeDisplay();
        };
    }
}

function setupZoomButtons() {
    document.getElementById("zoomInBtn").onclick = () => sendToCanvas('CMD_ZOOM', 1);
    document.getElementById("zoomOutBtn").onclick = () => sendToCanvas('CMD_ZOOM', -1);
    document.getElementById("resetViewBtn").onclick = () => sendToCanvas('CMD_RESET_VIEW');
}

/**
 * Generates a PNG where 1 pixel = 1 stitch
 */
function exportPixelPNG(rgbGrid, filename) {
    const height = rgbGrid.length;
    const width = rgbGrid[0].length;

    // 1. Create a "hidden" canvas at the exact grid dimensions
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const ctx = offscreenCanvas.getContext('2d');

    // 2. Create ImageData to manipulate raw pixels
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const rgb = rgbGrid[y][x];

            // Handle transparency (cloth/0)
            // If your cloth is 255,255,255 and you want it transparent:
            if (rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255) {
                data[index] = 255;
                data[index + 1] = 255;
                data[index + 2] = 255;
                data[index + 3] = 0; // Transparent Alpha
            } else {
                data[index] = rgb[0];     // R
                data[index + 1] = rgb[1]; // G
                data[index + 2] = rgb[2]; // B
                data[index + 3] = 255;    // Opaque Alpha
            }
        }
    }

    // 3. Put the pixels on the canvas and trigger download
    ctx.putImageData(imageData, 0, 0);

    const link = document.createElement('a');
    link.download = filename;
    link.href = offscreenCanvas.toDataURL("image/png");
    link.click();
}

function resetUIControls() {
    mappingConfig.maxSize = 80;
    mappingConfig.maxColours = 30;
    mappingConfig.mergeNearest = 0; 
    mappingConfig.pixelArtMode = false;
    mappingConfig.brightnessInt = 0;
    mappingConfig.saturationInt = 0;
    mappingConfig.contrastInt = 0;
    mappingConfig.biasGreenMagenta = 0;
    mappingConfig.biasCyanRed = 0;
    mappingConfig.biasBlueYellow = 0;
    mappingConfig.antiNoise = 0;
    mappingConfig.reduceIsolatedStitches = false;
    mappingConfig.distanceMethod = "euclidean";
    mappingConfig.minOccurrence = 1;
    mappingConfig.stampedMode = false;
    mappingConfig.pixelArtMode = false;

    const pixelArtToggle = document.getElementById("pixelArtMode");
    if (pixelArtToggle) pixelArtToggle.checked = false;

    const ids = ["brightness", "saturation", "contrast", "greenToMagenta", "cyanToRed", "blueToYellow", "antiNoise"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 0;
    });

    const sizeSlider = document.getElementById("maxSizeSlider");
    const sizeInput = document.getElementById("maxSizeInput");
    if (sizeSlider) sizeSlider.value = 80;
    if (sizeInput) sizeInput.value = 80;

    const mergeSlider = document.getElementById("mergeNearest");
    const mergeVal = document.getElementById("mergeNearestVal");
    if (mergeSlider) mergeSlider.value = 0;
    if (mergeVal) mergeVal.textContent = "Off";

    const antiNoiseVal = document.getElementById("antiNoiseVal");
    if (antiNoiseVal) antiNoiseVal.textContent = "0";

    const reduceIsolatedStitchesToggle = document.getElementById("reduceIsolatedStitches");
    if (reduceIsolatedStitchesToggle) reduceIsolatedStitchesToggle.checked = false;

    // Max Colours
    const maxColoursSlider = document.getElementById("maxColours");
    const maxColoursInput = document.getElementById("maxColoursInput");
    if (maxColoursSlider) maxColoursSlider.value = 30;
    if (maxColoursInput) maxColoursInput.value = 30;

    // Color Distance (default = euclidean)
    document.querySelectorAll("input[name='colorDistance']").forEach(radio => {
        radio.checked = radio.value === "euclidean";
    });

    // Min Occurrence
    const minOccurrenceInput = document.getElementById("minOccurrenceInput");
    if (minOccurrenceInput) minOccurrenceInput.value = 1;

    // Stamped Mode
    const stampedToggle = document.getElementById("stampedMode");
    const stampedControls = document.getElementById("stampedControls");
    if (stampedToggle) {
        stampedToggle.checked = false;
        if (stampedControls) stampedControls.style.display = "none";
    }
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
            // Sidebar now updates in SYNC handler after mappedDmcGrid is patched
        }

        if (type === 'SYNC_GRID_TO_PARENT') {
            // In stamped mode the canvas shows stamped colors — never overwrite the true RGB grid
            if (!mappingConfig.stampedMode) {
                state.mappedRgbGrid = payload;
                captureUserEdits(payload);
            }

            Promise.resolve().then(() => {
                if (!lastBaselineDmcGrid) return;

                const patchedDmcGrid = patchDmcGrid(lastBaselineDmcGrid, userEditDiff, mappingConfig.distanceMethod);
                state.mappedDmcGrid = patchedDmcGrid;

                // Update sidebar after mappedDmcGrid is patched with user edits
                updateSidebarFromState();
            });
        }
    });

    renderPalette([]);
    state.setColor([0, 0, 0]);

    console.log("Cross Stitch Editor Parent Shell Initialized.");
});