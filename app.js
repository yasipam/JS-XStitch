// app.js
import { EditorState } from "./core/state.js";
import { EditorEvents } from "./core/events.js";
import { ToolRegistry } from "./core/tools.js";

// Mapping Logic
import { mergeSimilarPaletteColors, buildPaletteFromImage, getDistanceFn, rgbToLab } from "./mapping/palette.js";
import { mapFullWithPalette, nearestDmcColor, cleanupMinOccurrence, removeIsolatedStitches, applyAntiNoise } from "./mapping/mappingEngine.js";
import { buildStampedGrid } from "./mapping/stamped.js";
import { DMC_RGB } from "./mapping/constants.js";
import { exportOXS } from "./export/exportOXS.js";
import { parseOxsFileFromFile } from "./import/importOXS.js";

// Export Logic
import { buildExportData } from "./export/buildExportData.js";
import { exportPDF } from "./export/exportPDF.js";

// Global Instances
let state;
let events;
let currentImage = null;
let lastBaselineGrid = null;    // Existing: stores RGB baseline
let lastBaselineDmcGrid = null; // NEW: stores pure DMC baseline mapping

// OXS Import State
let isOxsLoaded = false;
let loadedOxsPalette = null; // Stores { code: { name, rgb } } from imported OXS
let oxsBaselineDmcGrid = null; // Original DMC grid for OXS (to allow undo)
let oxsBaselineRgbGrid = null; // Original RGB grid for OXS (to allow undo)
let oxsBaselinePalette = null; // Original palette for OXS (to allow undo)

// Empty Canvas Drawing Mode
let isEmptyCanvas = false; // True when user creates new canvas without image/OXS
let hasEmptyCanvasEdits = false; // Tracks if user has drawn on empty canvas

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
    exportMode: "filled"
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
        if (display) display.innerHTML = "--";
        return;
    }

    const dmcGrid = state.mappedDmcGrid;
    const height = dmcGrid.length;
    const width = dmcGrid[0] ? dmcGrid[0].length : 0;

    let minX = width, maxX = 0, minY = height, maxY = 0;
    let totalStitches = 0;
    let hasStitches = false;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (String(dmcGrid[y][x]) !== "0") {
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
                totalStitches++;
                hasStitches = true;
            }
        }
    }

    if (!hasStitches) {
        display.innerHTML = "--";
        return;
    }

    const stitchW = maxX - minX + 1;
    const stitchH = maxY - minY + 1;

    const fabricSelect = document.getElementById("fabricCountSelect");
    const fabricCount = fabricSelect ? parseInt(fabricSelect.value) || 14 : 14;

    const sizeW = (stitchW / fabricCount * 2.54).toFixed(1);
    const sizeH = (stitchH / fabricCount * 2.54).toFixed(1);

    display.innerHTML = `${stitchW} x ${stitchH} stitches<br>${sizeW} x ${sizeH} cm on ${fabricCount}ct<br>Total: ${totalStitches.toLocaleString()} stitches`;
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
    const btn = document.getElementById("uploadBtn");
    if (!input) return;

    if (btn) {
        btn.onclick = () => input.click();
    }

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
                isOxsLoaded = false;
                isEmptyCanvas = false;
                loadedOxsPalette = null;

                resetUIControls();

                const sizeSlider = document.getElementById("maxSizeSlider");
                const sizeInput = document.getElementById("maxSizeInput");
                if (sizeSlider) sizeSlider.disabled = false;
                if (sizeInput) sizeInput.disabled = false;

                setMappingControlsEnabled(true, false);

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

function setupOxsUpload() {
    const input = document.getElementById("oxsUpload");
    const btn = document.getElementById("oxsImportBtn");
    if (!input) return;

    if (btn) {
        btn.onclick = () => input.click();
    }

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const parsed = await parseOxsFileFromFile(file);
            loadOxsPattern(parsed);

            const uploader = document.getElementById("oxsUpload");
            if (uploader) uploader.value = "";
        } catch (err) {
            alert("Failed to load OXS file: " + err.message);
            console.error(err);
        }
    };
}

function setupNewCanvas() {
    const btn = document.getElementById("newCanvasBtn");
    if (!btn) return;

    btn.onclick = () => createEmptyCanvas(50, 50);
}

function createEmptyCanvas(width, height) {
    console.log(`Creating empty canvas: ${width}x${height}`);
    
    isEmptyCanvas = true;
    hasEmptyCanvasEdits = false;
    isOxsLoaded = false;
    loadedOxsPalette = null;
    currentImage = null;

    // Reset config values (without disabling controls)
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

    state.clear();
    userEditDiff.clear();
    lastBaselineGrid = null;
    lastBaselineDmcGrid = null;

    state.originalImageURL = null;

    // Reset UI elements to defaults (without disabling controls)
    const pixelArtToggle = document.getElementById("pixelArtMode");
    if (pixelArtToggle) pixelArtToggle.checked = false;

    ["brightness", "saturation", "contrast", "greenToMagenta", "cyanToRed", "blueToYellow", "antiNoise"].forEach(id => {
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

    const reduceIsolatedToggle = document.getElementById("reduceIsolatedStitches");
    if (reduceIsolatedToggle) reduceIsolatedToggle.checked = false;

    const maxColoursSlider = document.getElementById("maxColours");
    const maxColoursInput = document.getElementById("maxColoursInput");
    if (maxColoursSlider) maxColoursSlider.value = 30;
    if (maxColoursInput) maxColoursInput.value = 30;

    document.querySelectorAll("input[name='colorDistance']").forEach(radio => {
        radio.checked = radio.value === "euclidean";
    });

    const minOccurrenceInput = document.getElementById("minOccurrenceInput");
    if (minOccurrenceInput) minOccurrenceInput.value = 1;

    const stampedToggle = document.getElementById("stampedMode");
    const stampedControls = document.getElementById("stampedControls");
    if (stampedToggle) {
        stampedToggle.checked = false;
        if (stampedControls) stampedControls.style.display = "none";
    }

    // Initialize empty grids (white canvas)
    const emptyDmcGrid = Array.from({ length: height }, () => 
        Array.from({ length: width }, () => "0")
    );
    const emptyRgbGrid = Array.from({ length: height }, () => 
        Array.from({ length: width }, () => [255, 255, 255])
    );

    state.mappedDmcGrid = emptyDmcGrid;
    state.mappedRgbGrid = emptyRgbGrid;

    sendToCanvas('INIT', { width, height });
    sendToCanvas('UPDATE_GRID', emptyRgbGrid);

    // Enable all controls for empty canvas mode
    setMappingControlsEnabled(true, false);

    // Show palette and update sidebar
    renderPalette([]);
    updateSidebarFromEmptyCanvas();
    updatePatternSizeDisplay();

    console.log("Empty canvas created");
}

function resizeEmptyCanvas(newSize) {
    console.log(`Resizing empty canvas to: ${newSize}x${newSize}`);
    
    const height = newSize;
    const width = newSize;
    
    // Store existing content if smaller
    const oldRgbGrid = state.mappedRgbGrid || [];
    const oldDmcGrid = state.mappedDmcGrid || [];
    const oldHeight = oldRgbGrid.length || 50;
    const oldWidth = oldRgbGrid[0]?.length || 50;
    
    // Create new empty grids
    const newDmcGrid = Array.from({ length: height }, () => 
        Array.from({ length: width }, () => "0")
    );
    const newRgbGrid = Array.from({ length: height }, () => 
        Array.from({ length: width }, () => [255, 255, 255])
    );
    
    // Copy over existing content
    for (let y = 0; y < Math.min(height, oldHeight); y++) {
        for (let x = 0; x < Math.min(width, oldWidth); x++) {
            if (oldRgbGrid[y] && oldRgbGrid[y][x]) {
                newRgbGrid[y][x] = [...oldRgbGrid[y][x]];
                newDmcGrid[y][x] = (oldDmcGrid && oldDmcGrid[y] && oldDmcGrid[y][x]) ? oldDmcGrid[y][x] : "0";
            }
        }
    }
    
    state.mappedDmcGrid = newDmcGrid;
    state.mappedRgbGrid = newRgbGrid;
    
    sendToCanvas('INIT', { width, height });
    sendToCanvas('UPDATE_GRID', newRgbGrid);
    
    updateSidebarFromEmptyCanvas();
    updatePatternSizeDisplay();
    
    console.log("Empty canvas resized");
}

function updateSidebarFromEmptyCanvas() {
    if (!state.mappedRgbGrid) return;

    const rgbGrid = state.mappedRgbGrid;
    const countDisplay = document.getElementById("actualColoursUsed");
    const counts = {};
    const usedCodes = new Set();
    const DISTANCE_THRESHOLD = 2000;

    for (let y = 0; y < rgbGrid.length; y++) {
        for (let x = 0; x < rgbGrid[0].length; x++) {
            const rgb = rgbGrid[y][x];
            const isWhite = rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255;
            if (isWhite) continue;

            let matchedCode = null;
            let bestDist = Infinity;

            DMC_RGB.forEach(([code, , dmcRgb]) => {
                const dr = rgb[0] - dmcRgb[0];
                const dg = rgb[1] - dmcRgb[1];
                const db = rgb[2] - dmcRgb[2];
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                    bestDist = dist;
                    matchedCode = code;
                }
            });

            if (matchedCode && bestDist < DISTANCE_THRESHOLD) {
                counts[matchedCode] = (counts[matchedCode] || 0) + 1;
                usedCodes.add(matchedCode);
            }
        }
    }

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
    renderPalette(Array.from(usedCodes));
    updatePatternSizeDisplay();
}

function loadOxsPattern(parsed) {
    const { width, height, dmcGrid, rgbGrid, dmcPalette } = parsed;

    isOxsLoaded = true;
    loadedOxsPalette = dmcPalette;
    currentImage = null;

    resetUIControls();

    state.clear();
    userEditDiff.clear();
    lastBaselineGrid = null;
    lastBaselineDmcGrid = null;

    // Store baseline for undo functionality
    oxsBaselineDmcGrid = dmcGrid.map(row => row.map(c => c));
    oxsBaselineRgbGrid = rgbGrid.map(row => row.map(c => [...c]));
    // Deep clone the palette for baseline
    oxsBaselinePalette = {};
    Object.entries(dmcPalette).forEach(([code, entry]) => {
        oxsBaselinePalette[code] = { name: entry.name, rgb: [...entry.rgb] };
    });

    state.originalImageURL = null;

    sendToCanvas('INIT', { width, height });

    state.mappedDmcGrid = dmcGrid;
    state.mappedRgbGrid = rgbGrid;

    sendToCanvas('UPDATE_GRID', rgbGrid);

    setMappingControlsEnabled(false, true); // Disable mapping controls but enable post-processing

    const usedCodes = Object.keys(dmcPalette);
    renderPalette(usedCodes);

    updateThreadsTableFromGrid();
    updatePatternSizeDisplay();
}

function updatePaletteFromOxs(dmcPalette, rgbGrid) {
    const paletteGrid = document.getElementById("paletteGrid");
    if (!paletteGrid) return;

    const codes = Object.keys(dmcPalette);
    if (codes.length === 0) return;

    paletteGrid.innerHTML = "";

    codes.forEach(code => {
        const { name, rgb } = dmcPalette[code];
        const div = document.createElement("div");
        div.className = "palette-swatch used";
        div.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        div.title = `DMC ${code} - ${name}`;
        div.dataset.code = code;
        div.dataset.name = name;
        div.dataset.rgb = rgb.join(",");

        div.onclick = () => {
            state.setColor(rgb);
            sendToCanvas('SET_COLOR', rgb);
            document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
            div.classList.add('selected');
        };

        paletteGrid.appendChild(div);
    });
}

function setMappingControlsEnabled(enabled, isOxsMode = false) {
    console.log(`setMappingControlsEnabled called: enabled=${enabled}, isOxsMode=${isOxsMode}`);
    
    const mappingControls = [
        "maxSizeSlider", "maxSizeInput",
        "pixelArtMode",
        "maxColours", "maxColoursInput",
        "brightness", "saturation", "contrast",
        "greenToMagenta", "cyanToRed", "blueToYellow"
    ];

    const postProcessingControls = [
        "mergeNearest",
        "reduceIsolatedStitches",
        "antiNoise",
        "minOccurrenceInput",
        "reapplyFilterBtn"
    ];

    mappingControls.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !enabled || isOxsMode;
            console.log(`  ${id} disabled = ${el.disabled}`);
        }
    });

    document.querySelectorAll('input[name="colorDistance"]').forEach(radio => {
        radio.disabled = !enabled || isOxsMode;
        console.log(`  radio ${radio.value} disabled = ${radio.disabled}`);
    });

    postProcessingControls.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !(enabled || isOxsMode);
            console.log(`  ${id} disabled = ${el.disabled}`);
        }
    });
}

function applyOxsPostProcessing(control) {
    if (!isOxsLoaded || !state.mappedDmcGrid || !state.mappedRgbGrid) return;

    const dmcGrid = state.mappedDmcGrid;
    const rgbGrid = state.mappedRgbGrid;
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    switch (control) {
        case 'reduceIsolatedStitches':
            state.mappedDmcGrid = removeIsolatedStitches(dmcGrid, rgbGrid);
            rebuildRgbFromDmc();
            break;

        case 'minOccurrence':
            const minOcc = parseInt(document.getElementById("minOccurrenceInput")?.value || 1, 10);
            const codeToRgb = {};
            Object.entries(loadedOxsPalette).forEach(([code, entry]) => {
                codeToRgb[code] = entry.rgb;
            });
            state.mappedDmcGrid = cleanupMinOccurrence(dmcGrid, minOcc, codeToRgb);
            rebuildRgbFromDmc();
            break;

        case 'antiNoise':
            applyAntiNoiseToOxsGrid();
            break;

        case 'merge':
            applyMergeToOxsGrid();
            break;

        default:
            return;
    }

    sendToCanvas('UPDATE_GRID', state.mappedRgbGrid);
    updateThreadsTableFromGrid();
    updatePaletteAfterPostProcess();
}

function applyOxsPostProcessingWithUndo(control, value, prevValue = null) {
    console.log(`applyOxsPostProcessingWithUndo: ${control} = ${value}, prevValue = ${prevValue}`);
    
    if (!isOxsLoaded) return;

    if (!oxsBaselineDmcGrid || !oxsBaselineRgbGrid) {
        console.log("No baseline to restore");
        return;
    }

    // For merge: if value is less than previous, restore from baseline first
    if (control === 'merge' && prevValue !== null && value < prevValue) {
        console.log(`Reducing merge level from ${prevValue} to ${value} - restoring baseline first`);
        state.mappedDmcGrid = oxsBaselineDmcGrid.map(row => row.map(c => c));
        state.mappedRgbGrid = oxsBaselineRgbGrid.map(row => row.map(c => [...c]));
        loadedOxsPalette = {};
        Object.entries(oxsBaselinePalette).forEach(([code, entry]) => {
            loadedOxsPalette[code] = { name: entry.name, rgb: [...entry.rgb] };
        });
        // Update canvas after restoring baseline
        sendToCanvas('UPDATE_GRID', state.mappedRgbGrid);
        // After restoring, apply the new lower value
    }

    // If value is 0 or false, restore from baseline completely
    if (value === 0 || value === false) {
        console.log("Restoring from baseline");
        state.mappedDmcGrid = oxsBaselineDmcGrid.map(row => row.map(c => c));
        state.mappedRgbGrid = oxsBaselineRgbGrid.map(row => row.map(c => [...c]));
        
        // Restore palette from baseline
        loadedOxsPalette = {};
        Object.entries(oxsBaselinePalette).forEach(([code, entry]) => {
            loadedOxsPalette[code] = { name: entry.name, rgb: [...entry.rgb] };
        });
        
        // Update canvas
        sendToCanvas('UPDATE_GRID', state.mappedRgbGrid);
        updateThreadsTableFromGrid();
        
        // Update palette with baseline colors
        const usedCodes = Object.keys(loadedOxsPalette);
        renderPalette(usedCodes);
        return;
    }

    // Apply the operation (non-zero value)
    console.log(`Applying ${control} with value ${value}`);
    applyOxsPostProcessing(control);
}

function rebuildRgbFromDmc() {
    if (!state.mappedDmcGrid || !loadedOxsPalette) return;

    const dmcGrid = state.mappedDmcGrid;
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const newRgbGrid = Array.from({ length: h }, () => Array(w).fill([255, 255, 255]));

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            if (code !== "0" && loadedOxsPalette[code]) {
                newRgbGrid[y][x] = [...loadedOxsPalette[code].rgb];
            }
        }
    }

    state.mappedRgbGrid = newRgbGrid;
}

function updateSidebarFromOxsGrid(rgbGrid) {
    console.log("updateSidebarFromOxsGrid called");
    if (!rgbGrid || !loadedOxsPalette) return;

    const countDisplay = document.getElementById("actualColoursUsed");
    const counts = {};
    const usedCodes = new Set();
    const DISTANCE_THRESHOLD = 2000; // Only match if reasonably close

    for (let y = 0; y < rgbGrid.length; y++) {
        for (let x = 0; x < rgbGrid[0].length; x++) {
            const rgb = rgbGrid[y][x];
            const isWhite = rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255;
            if (isWhite) continue;

            let matchedCode = null;
            let bestDist = Infinity;

            Object.entries(loadedOxsPalette).forEach(([code, entry]) => {
                const dr = rgb[0] - entry.rgb[0];
                const dg = rgb[1] - entry.rgb[1];
                const db = rgb[2] - entry.rgb[2];
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                    bestDist = dist;
                    matchedCode = code;
                }
            });

            // Only count if close enough match
            if (matchedCode && bestDist < DISTANCE_THRESHOLD) {
                counts[matchedCode] = (counts[matchedCode] || 0) + 1;
                usedCodes.add(matchedCode);
            } else {
                // New color not in palette - add it dynamically
                console.log(`New color detected: RGB(${rgb[0]}, ${rgb[1]}, ${rgb[2]}), bestDist=${bestDist}`);
                const newCode = findAvailableDmcCode(rgb);
                loadedOxsPalette[newCode] = { name: `DMC ${newCode}`, rgb: rgb };
                counts[newCode] = (counts[newCode] || 0) + 1;
                usedCodes.add(newCode);
                console.log(`Added new color to palette: DMC ${newCode}`);
            }
        }
    }

    const threadStats = Object.entries(counts).map(([code, count]) => {
        const entry = loadedOxsPalette[code];
        if (!entry) return null;
        return {
            code: code,
            r: entry.rgb[0],
            g: entry.rgb[1],
            b: entry.rgb[2],
            count: count
        };
    }).filter(s => s !== null);

    if (countDisplay) {
        countDisplay.innerHTML = `Actual Colours: ${threadStats.length}`;
        console.log(`Actual Colours: ${threadStats.length}`);
    }

    renderThreadsTable(threadStats);
    renderPalette(Array.from(usedCodes));

    // Update pattern size display with full info (stitch count, dimensions, cm)
    // For OXS or empty canvas, we need to get the live DMC grid to account for user edits
    if ((isOxsLoaded || isEmptyCanvas) && state.mappedRgbGrid) {
        const liveDmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid);
        if (liveDmcGrid) {
            const originalDmcGrid = state.mappedDmcGrid;
            state.mappedDmcGrid = liveDmcGrid;
            updatePatternSizeDisplay();
            state.mappedDmcGrid = originalDmcGrid;
            return;
        }
    }
    updatePatternSizeDisplay();
}

function findAvailableDmcCode(rgb) {
    // Find the closest DMC color to use as the code
    let bestCode = "310";
    let bestDist = Infinity;
    
    DMC_RGB.forEach(([code, name, dmcRgb]) => {
        const dr = rgb[0] - dmcRgb[0];
        const dg = rgb[1] - dmcRgb[1];
        const db = rgb[2] - dmcRgb[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            bestCode = code;
        }
    });
    
    return bestCode;
}

function getLiveDmcGridFromRgb(rgbGrid) {
    if (!rgbGrid || !loadedOxsPalette) return null;

    const h = rgbGrid.length;
    const w = rgbGrid[0].length;
    const dmcGrid = Array.from({ length: h }, () => Array(w).fill("0"));

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const rgb = rgbGrid[y][x];
            const isWhite = rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255;
            if (isWhite) continue;

            let matchedCode = null;
            let bestDist = Infinity;

            Object.entries(loadedOxsPalette).forEach(([code, entry]) => {
                const dr = rgb[0] - entry.rgb[0];
                const dg = rgb[1] - entry.rgb[1];
                const db = rgb[2] - entry.rgb[2];
                const dist = dr * dr + dg * dg + db * db;
                if (dist < bestDist) {
                    bestDist = dist;
                    matchedCode = code;
                }
            });

            if (matchedCode) {
                dmcGrid[y][x] = matchedCode;
            }
        }
    }

    return dmcGrid;
}

function applyAntiNoiseToOxsGrid() {
    if (!state.mappedDmcGrid || !loadedOxsPalette) return;

    const dmcGrid = state.mappedDmcGrid;
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(w, h);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            const rgb = (code !== "0" && loadedOxsPalette[code])
                ? loadedOxsPalette[code].rgb
                : [255, 255, 255];
            const idx = (y * w + x) * 4;
            imageData.data[idx] = rgb[0];
            imageData.data[idx + 1] = rgb[1];
            imageData.data[idx + 2] = rgb[2];
            imageData.data[idx + 3] = 255;
        }
    }

    const strength = parseInt(document.getElementById("antiNoise")?.value || 0, 10);
    if (strength > 0) {
        const smoothed = applyAntiNoise(imageData, strength);

        const newDmcGrid = Array.from({ length: h }, () => Array(w).fill("0"));

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const r = smoothed.data[idx];
                const g = smoothed.data[idx + 1];
                const b = smoothed.data[idx + 2];

                let bestCode = "0";
                let bestDist = Infinity;

                Object.entries(loadedOxsPalette).forEach(([code, entry]) => {
                    const dr = r - entry.rgb[0];
                    const dg = g - entry.rgb[1];
                    const db = b - entry.rgb[2];
                    const dist = dr * dr + dg * dg + db * db;
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestCode = code;
                    }
                });

                newDmcGrid[y][x] = bestCode;
            }
        }

        state.mappedDmcGrid = newDmcGrid;
        rebuildRgbFromDmc();
    }
}

function applyMergeToOxsGrid() {
    if (!state.mappedDmcGrid || !loadedOxsPalette) return;

    const codes = Object.keys(loadedOxsPalette);
    const paletteRgb = codes.map(code => loadedOxsPalette[code].rgb);

    const threshold = mappingConfig.mergeNearest * 8;
    if (threshold <= 0) return;

    const paletteLab = paletteRgb.map(rgb => rgbToLab([rgb])[0]);

    const groups = [];
    const used = new Array(codes.length).fill(false);

    for (let i = 0; i < codes.length; i++) {
        if (used[i]) continue;

        const group = [i];
        used[i] = true;
        const baseLab = paletteLab[i];

        for (let j = i + 1; j < codes.length; j++) {
            if (used[j]) continue;

            const dist = Math.sqrt(
                (baseLab[0] - paletteLab[j][0]) ** 2 +
                (baseLab[1] - paletteLab[j][1]) ** 2 +
                (baseLab[2] - paletteLab[j][2]) ** 2
            );

            if (dist < threshold) {
                group.push(j);
                used[j] = true;
            }
        }

        groups.push(group);
    }

    const mergedPalette = {};
    const codeRemap = {};

    groups.forEach(group => {
        const representativeIdx = group[0];
        const representativeCode = codes[representativeIdx];
        mergedPalette[representativeCode] = loadedOxsPalette[representativeCode];

        group.forEach(idx => {
            if (idx !== representativeIdx) {
                codeRemap[codes[idx]] = representativeCode;
            }
        });
    });

    const dmcGrid = state.mappedDmcGrid;
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const newDmcGrid = dmcGrid.map(row => row.map(code => {
        const strCode = String(code);
        return codeRemap[strCode] || strCode;
    }));

    state.mappedDmcGrid = newDmcGrid;
    loadedOxsPalette = mergedPalette;
    rebuildRgbFromDmc();
}

function updatePaletteAfterPostProcess() {
    if (!loadedOxsPalette || !state.mappedRgbGrid) return;
    updatePaletteFromOxs(loadedOxsPalette, state.mappedRgbGrid);
}

function updateThreadsTableFromGrid() {
    if (!state.mappedDmcGrid) return;

    const dmcGrid = state.mappedDmcGrid;
    const counts = {};

    for (let y = 0; y < dmcGrid.length; y++) {
        for (let x = 0; x < dmcGrid[0].length; x++) {
            const code = String(dmcGrid[y][x]);
            if (code !== "0") {
                counts[code] = (counts[code] || 0) + 1;
            }
        }
    }

    const tbody = document.getElementById("threadsTableBody");
    if (!tbody) return;

    tbody.innerHTML = "";

    Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([code, count]) => {
        const dmcEntry = DMC_RGB.find(d => String(d[0]) === code);
        const name = dmcEntry ? dmcEntry[1] : `DMC ${code}`;
        const rgb = dmcEntry ? dmcEntry[2] : [128, 128, 128];

        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="background-color: rgb(${rgb[0]},${rgb[1]},${rgb[2]})"></td>
            <td>${code}</td>
            <td>${count}</td>
            <td>${Math.ceil(count / 1000)}</td>
        `;
        tbody.appendChild(row);
    });
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
                isOxsLoaded = false;
                loadedOxsPalette = null;
                const uploader = document.getElementById("upload");
                if (uploader) uploader.value = "";
                resetUIControls();
                setMappingControlsEnabled(false, false);
            }
        };
    }
}

function setupResetControls() {
    const resetOriginalBtn = document.getElementById("resetOriginalBtn");
    if (resetOriginalBtn) {
        resetOriginalBtn.onclick = () => {
            if (isOxsLoaded) {
                alert("Cannot reset to original for imported OXS files. Use Clear All to start fresh.");
                return;
            }
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

            if (isEmptyCanvas) {
                resizeEmptyCanvas(80);
            } else {
                runMapping(true);
            }
        } else if (isEmptyCanvas) {
            // Empty canvas mode - resize directly
            resizeEmptyCanvas(newSize);
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
            const prevVal = mappingConfig.mergeNearest;
            mappingConfig.mergeNearest = val;

            // Update label
            const labels = ["Off", "Light", "Mild", "Medium", "Strong", "Very Strong"];
            mergeVal.textContent = labels[val];

            if (isOxsLoaded) {
                console.log(`OXS mergeNearest slider changed from ${prevVal} to ${val}`);
                applyOxsPostProcessingWithUndo('merge', val, prevVal);
            } else {
                runMapping();
            }
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

            if (isOxsLoaded) {
                console.log(`OXS antiNoise slider changed to ${val}`);
                applyOxsPostProcessingWithUndo('antiNoise', val);
            } else {
                runMapping();
            }
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

            if (isOxsLoaded) {
                console.log(`OXS reduceIsolatedStitches toggled to ${reduceIsolatedStitchesToggle.checked}`);
                applyOxsPostProcessingWithUndo('reduceIsolatedStitches', reduceIsolatedStitchesToggle.checked ? 1 : 0);
            } else {
                runMapping();
            }
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
            
            // For OXS, get the live DMC grid with user edits
            let dmcGrid = state.mappedDmcGrid;
            if (isOxsLoaded && state.mappedRgbGrid) {
                dmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid) || state.mappedDmcGrid;
            }
            
            const displayGrid = mappingConfig.stampedMode
                ? buildStampedRgbGrid(dmcGrid)
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
            
            // For OXS, get the live DMC grid with user edits
            let dmcGrid = state.mappedDmcGrid;
            if (isOxsLoaded && state.mappedRgbGrid) {
                dmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid) || state.mappedDmcGrid;
            }
            
            const displayGrid = buildStampedRgbGrid(dmcGrid);
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
            if (isOxsLoaded) {
                const minOcc = parseInt(document.getElementById("minOccurrenceInput")?.value || 1, 10);
                console.log(`OXS minOccurrence button clicked, value = ${minOcc}`);
                applyOxsPostProcessingWithUndo('minOccurrence', minOcc);
                return;
            }

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
                let exportDmcGrid = state.mappedDmcGrid;
                let exportRgbGrid = state.mappedRgbGrid;

                // For OXS mode, get the live grid from canvas with user edits
                if (isOxsLoaded && state.mappedRgbGrid) {
                    exportDmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid);
                    exportRgbGrid = state.mappedRgbGrid;
                }

                // For OXS with stamped mode: build stamped grid and lookup
                let stampedLookup = {};
                let exportVisualGrid = exportRgbGrid;
                if (isOxsLoaded && mappingConfig.stampedMode && exportDmcGrid) {
                    const stampedResult = buildStampedGrid(exportDmcGrid, { hueShift: mappingConfig.stampedHue });
                    exportVisualGrid = stampedResult.grid;
                    stampedLookup = stampedResult.lookup;
                }

                const data = buildExportData(state, mappingConfig, {
                    fabricCount: fabricSelect.value,
                    mode: modeSelect.value
                });

                // Override grids with live data for OXS
                if (isOxsLoaded) {
                    data.dmcGrid = exportDmcGrid;
                    data.rgbGrid = exportVisualGrid;
                    
                    // Rebuild palette with stamped colors if needed
                    const usedCodes = new Set(exportDmcGrid.flat().map(String));
                    data.palette = Object.entries(loadedOxsPalette)
                        .filter(([code]) => usedCodes.has(code))
                        .map(([code, entry]) => {
                            const count = exportDmcGrid.flat().filter(c => String(c) === code).length;
                            return {
                                code: code,
                                name: entry.name,
                                rgb: entry.rgb,
                                stampedRgb: mappingConfig.stampedMode ? (stampedLookup[code] || null) : null,
                                count: count
                            };
                        })
                        .sort((a, b) => b.count - a.count);
                }

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

            let exportDmcGrid = state.mappedDmcGrid;

            // For OXS mode, get the live grid from canvas with user edits
            if (isOxsLoaded && state.mappedRgbGrid) {
                exportDmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid);
            }

            const stampedRgbGrid = mappingConfig.stampedMode
                ? buildStampedRgbGrid(exportDmcGrid)
                : null;
            exportOXS(
                exportDmcGrid,
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
    setupNewCanvas();
    setupOxsUpload();
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
                if (!isOxsLoaded) {
                    captureUserEdits(payload);
                }
            }

            // For OXS in stamped mode: the canvas sends stamped colors, we need to rebuild the display
            if (isOxsLoaded && mappingConfig.stampedMode && state.mappedRgbGrid) {
                const liveDmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid);
                if (liveDmcGrid) {
                    const stampedGrid = buildStampedRgbGrid(liveDmcGrid);
                    sendToCanvas('UPDATE_GRID', stampedGrid);
                }
                // Don't update sidebar with stamped colors - they won't match original palette
                return;
            }

            Promise.resolve().then(() => {
                if (isOxsLoaded) {
                    // For OXS: directly use the synced grid for thread counts
                    // (only when NOT in stamped mode - stamped colors won't match)
                    updateSidebarFromOxsGrid(payload);
                } else if (isEmptyCanvas) {
                    // For empty canvas mode: track edits and update sidebar
                    console.log("Empty canvas sync received, checking for changes...");
                    
                    // Check if there are any non-white pixels (actual edits)
                    let hasEdits = false;
                    for (let y = 0; y < payload.length && !hasEdits; y++) {
                        for (let x = 0; x < payload[0].length && !hasEdits; x++) {
                            const rgb = payload[y][x];
                            if (!(rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255)) {
                                hasEdits = true;
                            }
                        }
                    }
                    
                    console.log("Empty canvas: hasEdits =", hasEdits);
                    
                    if (!hasEmptyCanvasEdits && hasEdits) {
                        hasEmptyCanvasEdits = true;
                        setMappingControlsEnabled(false, false); // Lock after first user edit
                        console.log("Empty canvas: actual edit made, locking controls");
                    }
                    state.mappedRgbGrid = payload;
                    
                    // Convert RGB grid to DMC codes for exports
                    const newDmcGrid = payload.map(row => row.map(rgb => {
                        const isWhite = rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255;
                        if (isWhite) return "0";
                        
                        // Find nearest DMC
                        let bestCode = "310";
                        let bestDist = Infinity;
                        DMC_RGB.forEach(([code, , dmcRgb]) => {
                            const dr = rgb[0] - dmcRgb[0];
                            const dg = rgb[1] - dmcRgb[1];
                            const db = rgb[2] - dmcRgb[2];
                            const dist = dr * dr + dg * dg + db * db;
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestCode = code;
                            }
                        });
                        return bestCode;
                    }));
                    state.mappedDmcGrid = newDmcGrid;
                    
                    updateSidebarFromEmptyCanvas();
                } else if (lastBaselineDmcGrid) {
                    const patchedDmcGrid = patchDmcGrid(lastBaselineDmcGrid, userEditDiff, mappingConfig.distanceMethod);
                    state.mappedDmcGrid = patchedDmcGrid;
                    updateSidebarFromState();
                }
            });
        }
    });

    renderPalette([]);
    state.setColor([0, 0, 0]);

    // Initialize with empty canvas
    createEmptyCanvas(50, 50);

    console.log("Cross Stitch Editor Parent Shell Initialized.");
});