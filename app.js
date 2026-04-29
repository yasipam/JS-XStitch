// app.js
import { EditorState } from "./core/state.js";
import { EditorEvents } from "./core/events.js";
import { ToolRegistry } from "./core/tools.js";
import { onnxModel } from "./core/bgRemover.js";

// Mapping Logic
import { mergeSimilarPaletteColors, buildPaletteFromImage, getDistanceFn, rgbToLab } from "./mapping/palette.js";
import { mapFullWithPalette, nearestDmcColor, cleanupMinOccurrence, removeIsolatedStitches, applyAntiNoise } from "./mapping/mappingEngine.js";
import { applyDitherRGB } from "./mapping/dithering.js";
import { buildStampedGrid } from "./mapping/stamped.js";
import { cropWithBox } from "./mapping/crop.js";
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
let referenceImage = null;
let bgRemoved = false; // Track if background was removed
let pencilSize = 1;
let eraserSize = 1;
let lastBaselineGrid = null;
let lastBaselineDmcGrid = null;

// Background removal mask state
let originalMaskCanvas = null; // Raw AI mask from background removal
let originalImageBeforeBgRemoval = null; // Original image before bg removal (for mask re-processing)

function showCropOverlay({ x1, y1, x2, y2 }) {
    console.log('[Parent] showCropOverlay received', { x1, y1, x2, y2 });
    const w = x2 - x1;
    const h = y2 - y1;
    const overlay = document.getElementById('cropOverlay');
    const dimensions = document.getElementById('cropDimensions');
    const confirmBtn = document.getElementById('cropConfirmBtn');
    const cancelBtn = document.getElementById('cropCancelBtn');

    dimensions.textContent = `${w}×${h}`;
    overlay.style.display = 'flex';

    confirmBtn.onclick = () => {
        console.log('[Parent] Confirm clicked, cropping...');
        overlay.style.display = 'none';
        // Clear the crop box visually first
        clearCropBox();
        // Then handle the crop
        handleCrop({ x1, y1, x2, y2 });
        // Send to iframe to clear the box
        sendToCanvas('CROP_CONFIRM', { x1, y1, x2, y2 });
    };

    cancelBtn.onclick = () => {
        console.log('[Parent] Cancel clicked');
        overlay.style.display = 'none';
        // Clear the crop box visually first
        clearCropBox();
        // Send cancel to iframe
        sendToCanvas('CROP_CANCEL');
    };
}

function clearCropBox() {
    // Send a message to iframe to clear the crop box from the UI
    const iframe = document.getElementById('canvasFrame');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'CLEAR_CROP_BOX' }, '*');
    }
}

function updateSizeUI(newWidth, newHeight) {
    // Update maxSizeSlider and maxSizeInput to reflect cropped size
    const maxSizeSlider = document.getElementById('maxSizeSlider');
    const maxSizeInput = document.getElementById('maxSizeInput');

    if (maxSizeSlider) maxSizeSlider.value = newWidth;
    if (maxSizeInput) maxSizeInput.value = newWidth;
    if (mappingConfig) mappingConfig.maxSize = newWidth;

    // Update the pattern size display after a short delay to let sync complete
    setTimeout(() => {
        if (typeof updatePatternSizeDisplay === 'function') {
            updatePatternSizeDisplay();
        }
    }, 100);
}

function handleCrop({ x1, y1, x2, y2 }) {
    const box = [x1, y1, x2, y2];
    const newWidth = x2 - x1;
    const newHeight = y2 - y1;

    console.log('[Parent] handleCrop called:', { newWidth, newHeight, isEmptyCanvas, isOxsLoaded, hasCurrentImage: !!currentImage });

    if (isEmptyCanvas || isOxsLoaded) {
        // Crop the existing stitch grid directly (blank canvas or OXS mode)
        const oldGrid = state.mappedRgbGrid;
        console.log('[Parent] Grid mode, oldGrid:', oldGrid ? `${oldGrid.length}x${oldGrid[0]?.length}` : 'null');

        if (!oldGrid) {
            console.warn('[Parent] handleCrop: oldGrid is null, cannot crop');
            return;
        }

        const newGrid = [];
        for (let y = y1; y < y2; y++) {
            const row = [];
            for (let x = x1; x < x2; x++) {
                if (y < oldGrid.length && x < oldGrid[y].length) {
                    row.push([...oldGrid[y][x]]);
                } else {
                    row.push([255, 255, 255]);
                }
            }
            newGrid.push(row);
        }

        console.log('[Parent] New grid created:', newGrid.length, 'x', newGrid[0].length);

        state.mappedRgbGrid = newGrid;
        hasEmptyCanvasEdits = false;

        // Send to iframe to resize and update
        console.log('[Parent] Sending INIT to iframe:', { width: newWidth, height: newHeight });
sendToCanvas('INIT', { width: newWidth, height: newHeight, backstitchColor: state.backstitchColor });
        
        console.log('[Parent] Sending UPDATE_GRID to iframe');
        sendToCanvas('UPDATE_GRID', newGrid);

        console.log('[Parent] Switching to pencil tool');
        sendToCanvas('SET_TOOL', 'pencil');

        // Update UI elements to reflect new canvas size
        updateSizeUI(newWidth, newHeight);

    } else if (currentImage) {
        // Crop the mapped grid directly (after image is already mapped)
        const oldGrid = state.mappedRgbGrid;
        console.log('[Parent] Image already mapped, cropping grid directly. oldGrid:', oldGrid ? `${oldGrid.length}x${oldGrid[0]?.length}` : 'null');

        if (!oldGrid) {
            console.warn('[Parent] handleCrop: no mapped grid to crop');
            return;
        }

        const newGrid = [];
        for (let y = y1; y < y2; y++) {
            const row = [];
            for (let x = x1; x < x2; x++) {
                if (y < oldGrid.length && x < oldGrid[y].length) {
                    row.push([...oldGrid[y][x]]);
                } else {
                    row.push([255, 255, 255]);
                }
            }
            newGrid.push(row);
        }

        console.log('[Parent] New cropped grid:', newGrid.length, 'x', newGrid[0].length);

        state.mappedRgbGrid = newGrid;

        // Also update currentImage so slider doesn't restore deleted pixels
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = newWidth;
        croppedCanvas.height = newHeight;
        const ctx = croppedCanvas.getContext('2d', { alpha: true });
        ctx.clearRect(0, 0, newWidth, newHeight);
        for (let y = 0; y < newHeight; y++) {
            for (let x = 0; x < newWidth; x++) {
                const rgb = newGrid[y][x];
                if (rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254) {
                    continue;
                }
                ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
                ctx.fillRect(x, y, 1, 1);
            }
        }

        // Create Image from cropped canvas and update currentImage
        const newImg = new Image();
        newImg.onload = () => {
            currentImage = newImg;
            referenceImage = newImg;
        };
        newImg.src = croppedCanvas.toDataURL('image/png');

        // Send to iframe
        console.log('[Parent] Sending INIT to iframe');
        sendToCanvas('INIT', { width: newWidth, height: newHeight, backstitchColor: state.backstitchColor });
        sendToCanvas('UPDATE_GRID', newGrid);
        sendToCanvas('SET_TOOL', 'pencil');

        // Update UI elements to reflect new canvas size
        updateSizeUI(newWidth, newHeight);

    } else {
        console.warn('[Parent] handleCrop: No valid mode - isEmptyCanvas:', isEmptyCanvas, 'isOxsLoaded:', isOxsLoaded, 'hasImage:', !!currentImage);
    }
}

// OXS Import State
let isOxsLoaded = false;
let loadedOxsPalette = null; // Stores { code: { name, rgb } } from imported OXS
let oxsBaselineDmcGrid = null; // Original DMC grid for OXS (to allow undo)
let oxsBaselineRgbGrid = null; // Original RGB grid for OXS (to allow undo)
let oxsBaselinePalette = null; // Original palette for OXS (to allow undo)

// Empty Canvas Drawing Mode
let isEmptyCanvas = false; // True when user creates new canvas without image/OXS
let hasEmptyCanvasEdits = false; // Tracks if user has drawn on empty canvas

// CM Dimension Inputs
let cmWidthInput = null;
let cmHeightInput = null;
let isUpdatingCmFromSlider = false;
let isUpdatingSliderFromCm = false;

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
codeToRgbMap["0"] = [254, 254, 254];

function getRgbFromCode(code) {
    return codeToRgbMap[String(code)] || [255, 255, 255];
}

// -----------------------------------------------------------------------------
// TWO-STAGE MAX COLOURS ENFORCEMENT
// Ensures maxColours limit is always honored, even after post-processing
// -----------------------------------------------------------------------------
function enforceMaxColors(dmcGrid, maxColours) {
    const h = dmcGrid?.length;
    const w = dmcGrid?.[0]?.length;
    if (!h || !w) return dmcGrid;

    const uniqueColors = new Set();
    const colorFrequency = {};
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            uniqueColors.add(code);
            colorFrequency[code] = (colorFrequency[code] || 0) + 1;
        }
    }

    const currentCount = uniqueColors.size;
    if (currentCount <= maxColours) return dmcGrid;

    const sortedByFreq = Object.entries(colorFrequency)
        .sort((a, b) => b[1] - a[1])
        .map(([code]) => code);
    const keepColors = new Set(sortedByFreq.slice(0, maxColours));
    const excessColors = sortedByFreq.slice(maxColours);

    const codeToRgb = codeToRgbMap;
    const keptRgbMap = {};
    for (const code of keepColors) {
        keptRgbMap[code] = codeToRgb[code] || [128, 128, 128];
    }

    const result = dmcGrid.map(row => row.slice());
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(result[y][x]);
            if (!keepColors.has(code)) {
                const origRgb = codeToRgb[code] || [128, 128, 128];
                let bestCode = null;
                let bestDist = Infinity;

                for (const keepCode of keepColors) {
                    const keepRgb = keptRgbMap[keepCode];
                    const dr = origRgb[0] - keepRgb[0];
                    const dg = origRgb[1] - keepRgb[1];
                    const db = origRgb[2] - keepRgb[2];
                    const d = dr * dr + dg * dg + db * db;
                    if (d < bestDist) {
                        bestDist = d;
                        bestCode = keepCode;
                    }
                }
                result[y][x] = bestCode || Array.from(keepColors)[0];
            }
        }
    }

    return result;
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

    let filteredDmcGrid = applyFilteringToGrid(state.mappedDmcGrid);
    filteredDmcGrid = enforceMaxColors(filteredDmcGrid, mappingConfig.maxColours);
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
    sharpenIntensity: 1,
    sharpenRadius: 2,
    minOccurrence: 1,
    stampedMode: false,
    stampedHue: 0,
    distanceMethod: "euclidean",
    ditherMode: "None",
    ditherStrength: 0,
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
        // Note: reduceIsolatedStitches and minOccurrence are post-processing operations
        // that work on the already-mapped grid - they should NOT invalidate the palette cache
        const needsNewPalette =
            cachedProjectPalette === null ||
            lastPaletteConfig.maxSize !== targetSize ||
            lastPaletteConfig.maxColours !== maxColours ||
            lastPaletteConfig.image !== currentImage ||
            lastPaletteConfig.distanceMethod !== distanceMethod ||
            lastPaletteConfig.mergeNearest !== mappingConfig.mergeNearest;

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
                mergeNearest: mappingConfig.mergeNearest
            };
        }

        // 4. Generate fresh baseline (filtering applied once via applyFilteringToGrid after user edits)
        const [rgbGrid, dmcGrid] = mapFullWithPalette(
            currentImage, targetSize, cachedProjectPalette,
            mappingConfig.brightnessInt / 10,
            mappingConfig.saturationInt / 10,
            mappingConfig.contrastInt / 10,
            false,
            0,
            mappingConfig.biasGreenMagenta,
            mappingConfig.biasCyanRed,
            mappingConfig.biasBlueYellow,
            distanceMethod,
            mappingConfig.antiNoise,
            mappingConfig.ditherMode,
            mappingConfig.ditherStrength / 25,
            mappingConfig.sharpenIntensity,
            mappingConfig.sharpenRadius
        );

        if (isReset) userEditDiff.clear();

        // 6. Store Clean Baseline (BEFORE filtering for proper toggle restoration)
        lastBaselineGrid = dmcGrid.map(row => row.map(c => getRgbFromCode(c)));
        lastBaselineDmcGrid = dmcGrid.map(row => row.map(c => String(c)));

        // 7. Build Unified DMC Grid (Baseline + User Edits + Filtering)
        let liveDmcGrid = userEditDiff.size > 0
            ? patchDmcGrid(dmcGrid, userEditDiff, mappingConfig.distanceMethod)
            : dmcGrid;

        liveDmcGrid = applyFilteringToGrid(liveDmcGrid);
        liveDmcGrid = enforceMaxColors(liveDmcGrid, maxColours);
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
            sendToCanvas('INIT', { width: newWidth, height: newHeight, dmcGrid: liveDmcGrid, backstitchColor: state.backstitchColor });
        } else {
            sendToCanvas('SET_DMC_GRID', liveDmcGrid);
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
            if (state.mode === 'backstitch') {
                state.setBackstitchColor(rgb);
                sendToCanvas('SET_BACKSTITCH_COLOR', rgb);
            } else {
                state.setColor(rgb);
                sendToCanvas('SET_COLOR', rgb);
            }
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
            if (state.mode === 'backstitch') {
                state.setBackstitchColor(rgb);
                sendToCanvas('SET_BACKSTITCH_COLOR', rgb);
            } else {
                state.setColor(rgb);
                sendToCanvas('SET_COLOR', rgb);
            }
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
            toggleBtn.textContent = isHidden ? "Close list ▲" : "Click to search ▼";

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
    if (!threadStats || threadStats.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center;padding:20px;'>No threads found</td></tr>";
        return;
    }
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

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <div class="table-swatch" style="background-color: rgb(${originalRgb[0]}, ${originalRgb[1]}, ${originalRgb[2]}); border: 1px solid #ccc;"></div>
            </td>
            <td title="${name}"><strong>${code}</strong></td>
            <td>${stat.count}</td>
            <td>${stat.count}</td>
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

function setupCollapsiblePanels() {
    const panels = document.querySelectorAll('.panel');
    panels.forEach(panel => {
        const title = panel.querySelector('.panelTitle');
        if (!title) return;

        // Find all sibling elements after the title and wrap them in panel-content
        const contentElements = [];
        let current = title.nextElementSibling;
        while (current && !current.classList.contains('panel')) {
            contentElements.push(current);
            current = current.nextElementSibling;
        }

        if (contentElements.length > 0) {
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'panel-content';

            contentElements.forEach(el => {
                contentWrapper.appendChild(el);
            });

            panel.insertBefore(contentWrapper, title.nextSibling);
        }

        // Make title clickable
        title.addEventListener('click', () => {
            const content = panel.querySelector('.panel-content');
            if (content) {
                title.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
            }
        });
    });
}

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
                referenceImage = img;
                isOxsLoaded = false;
                isEmptyCanvas = false;
                loadedOxsPalette = null;

                resetUIControls();

                const refOpacity = document.getElementById("referenceOpacity");
                const refOpacityVal = document.getElementById("referenceOpacityVal");
                if (refOpacity) refOpacity.value = 0;
                if (refOpacityVal) refOpacityVal.textContent = "0%";
                sendToCanvas('SET_REFERENCE_OPACITY', 0);
                sendToCanvas('TOGGLE_REFERENCE', true);

                const pixelArtToggle = document.getElementById("pixelArtMode");
                if (pixelArtToggle) {
                    const isSmallEnough = Math.max(img.width, img.height) <= 100;
                    pixelArtToggle.disabled = !isSmallEnough;
                }

                const sizeSlider = document.getElementById("maxSizeSlider");
                const sizeInput = document.getElementById("maxSizeInput");
                if (sizeSlider) sizeSlider.disabled = false;
                if (sizeInput) sizeInput.disabled = false;

                setMappingControlsEnabled(true, false);

                bgRemoved = false;
                originalMaskCanvas = null;
                originalImageBeforeBgRemoval = null;
                const maskAdjustPanel = document.getElementById("maskAdjustPanel");
                if (maskAdjustPanel) maskAdjustPanel.style.display = "none";
                const removeBgBtn = document.getElementById("removeBgBtn");
                const bgRemoveStatus = document.getElementById("bgRemoveStatus");
                if (removeBgBtn) {
                    removeBgBtn.disabled = false;
                    removeBgBtn.style.opacity = '1';
                    removeBgBtn.style.display = "inline-block";
                }
                if (bgRemoveStatus) bgRemoveStatus.style.display = "none";

                state.clear();
                userEditDiff.clear();
                lastBaselineGrid = null;
                // Tell the iframe to prepare for an 80px grid
                sendToCanvas('INIT', {
                    width: 80,
                    height: Math.floor(80 * (img.height / img.width)),
                    backstitchColor: state.backstitchColor
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

function setupMaskAdjustSlider() {
    const slider = document.getElementById('maskAdjustSlider');
    const valueDisplay = document.getElementById('maskAdjustValue');
    if (!slider) return;

    slider.addEventListener('input', () => {
        const adjustValue = parseInt(slider.value, 10);
        if (valueDisplay) {
            valueDisplay.textContent = adjustValue;
        }

        // Only process if we have the original mask and image
        if (!originalMaskCanvas || !originalImageBeforeBgRemoval) return;

        // Apply the mask adjustment
        const adjustedMask = onnxModel.applyMaskAdjust(originalMaskCanvas, adjustValue);

        // Apply the adjusted mask to the original image
        currentImage = onnxModel.applyMaskAndGetImage(originalImageBeforeBgRemoval, adjustedMask);

        // Update the state
        const canvas = document.createElement('canvas');
        canvas.width = currentImage.width;
        canvas.height = currentImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(currentImage, 0, 0);
        state.originalImageURL = canvas.toDataURL('image/png');

        // Re-run the mapping with the adjusted image
        runMapping(true);
    });
}

function setupBgRemover() {
    const btn = document.getElementById("removeBgBtn");
    const statusEl = document.getElementById("bgRemoveStatus");
    if (!btn) return;

    btn.onclick = async () => {
        if (!currentImage || bgRemoved) return;

        btn.disabled = true;

        const statusCallback = (type, message, showProgress) => {
            if (type === 'clear') {
                if (statusEl) {
                    statusEl.style.display = 'none';
                    statusEl.innerHTML = '';
                }
            } else if (type === 'error') {
                if (statusEl) {
                    statusEl.style.display = 'inline';
                    statusEl.textContent = message;
                }
                btn.disabled = false;
            } else if (type === 'loading') {
                if (statusEl) {
                    statusEl.style.display = 'inline';
                    statusEl.textContent = message;
                }
            }
        };

        const progressCallback = (progress) => {
            if (statusEl) {
                statusEl.style.display = 'inline';
                statusEl.textContent = `Downloading model... ${progress}%`;
            }
        };

        const success = await onnxModel.init(statusCallback, progressCallback);

        if (!success) {
            btn.disabled = false;
            return;
        }

        if (statusEl) {
            statusEl.textContent = 'Removing background...';
        }

        const result = await onnxModel.run(currentImage);

        if (result && result.processedImage) {
            // Store the original image and mask for mask adjustment
            originalImageBeforeBgRemoval = currentImage;
            originalMaskCanvas = result.maskCanvas;

            currentImage = result.processedImage;
            bgRemoved = true;
            btn.disabled = true;
            btn.style.opacity = '0.5';

            // Show the mask adjust panel
            const maskAdjustPanel = document.getElementById('maskAdjustPanel');
            if (maskAdjustPanel) {
                maskAdjustPanel.style.display = 'block';
            }

            // Reset the slider to 0 when showing the panel
            const maskAdjustSlider = document.getElementById('maskAdjustSlider');
            const maskAdjustValue = document.getElementById('maskAdjustValue');
            if (maskAdjustSlider) maskAdjustSlider.value = 0;
            if (maskAdjustValue) maskAdjustValue.textContent = '0';

            const canvas = document.createElement('canvas');
            canvas.width = currentImage.width;
            canvas.height = currentImage.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(currentImage, 0, 0);

            const base64 = canvas.toDataURL('image/png');
            const img = new Image();
            img.onload = () => {
                currentImage = img;

                const newBase64 = canvas.toDataURL('image/png');
                state.originalImageURL = newBase64;

                runMapping(true);
            };
            img.src = base64;
        } else {
            statusCallback('error', 'Failed to process image');
        }

        btn.disabled = true;
    };
}

function setupNewCanvas() {
    const btn = document.getElementById("newCanvasBtn");
    if (!btn) return;

    btn.onclick = () => {
        const hasEdits = hasEmptyCanvasEdits || userEditDiff.size > 0 || currentImage !== null;
        if (hasEdits) {
            if (!confirm("You have unsaved changes. Create a new blank canvas anyway?")) {
                return;
            }
        }
        createEmptyCanvas(50, 50);
    };
}

function createEmptyCanvas(width, height) {
    console.log(`Creating empty canvas: ${width}x${height}`);
    
    isEmptyCanvas = true;
    hasEmptyCanvasEdits = false;
    isOxsLoaded = false;
    loadedOxsPalette = null;
    currentImage = null;
    referenceImage = null;
    bgRemoved = false;

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
    mappingConfig.sharpenIntensity = 1;
    mappingConfig.sharpenRadius = 2;
    mappingConfig.reduceIsolatedStitches = false;
    mappingConfig.distanceMethod = "euclidean";
    mappingConfig.minOccurrence = 1;
    mappingConfig.stampedMode = false;

    state.clear();
    userEditDiff.clear();
    lastBaselineGrid = null;
    lastBaselineDmcGrid = null;

    state.originalImageURL = null;

    const removeBgBtn = document.getElementById("removeBgBtn");
    const bgRemoveStatus = document.getElementById("bgRemoveStatus");
    if (removeBgBtn) removeBgBtn.style.display = "none";
    if (bgRemoveStatus) bgRemoveStatus.style.display = "none";

    // Reset mask adjustment state
    originalMaskCanvas = null;
    originalImageBeforeBgRemoval = null;
    const maskAdjustPanel = document.getElementById("maskAdjustPanel");
    const maskAdjustSlider = document.getElementById("maskAdjustSlider");
    const maskAdjustValue = document.getElementById("maskAdjustValue");
    if (maskAdjustPanel) maskAdjustPanel.style.display = "none";
    if (maskAdjustSlider) maskAdjustSlider.value = 0;
    if (maskAdjustValue) maskAdjustValue.textContent = "0";

    bgRemoved = false;
    const refOpacity = document.getElementById("referenceOpacity");
    const refOpacityVal = document.getElementById("referenceOpacityVal");
    if (refOpacity) refOpacity.value = 0;
    if (refOpacityVal) refOpacityVal.textContent = "0%";
    sendToCanvas('SET_REFERENCE_OPACITY', 0);
    sendToCanvas('TOGGLE_REFERENCE', true);

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

    const sharpenIntensityVal = document.getElementById("sharpenIntensityVal");
    const sharpenRadiusVal = document.getElementById("sharpenRadiusVal");
    if (sharpenIntensityVal) sharpenIntensityVal.textContent = "1";
    if (sharpenRadiusVal) sharpenRadiusVal.textContent = "2";

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

    sendToCanvas('INIT', { width, height, backstitchColor: state.backstitchColor });
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
    const oldHeight = oldRgbGrid && oldRgbGrid.length > 0 ? oldRgbGrid.length : 0;
    const oldWidth = oldRgbGrid && oldRgbGrid[0] && oldRgbGrid[0].length > 0 ? oldRgbGrid[0].length : 0;
    
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
    
    sendToCanvas('INIT', { width, height, backstitchColor: state.backstitchColor });
    sendToCanvas('UPDATE_GRID', newRgbGrid);

    updateSidebarFromEmptyCanvas();
    updatePatternSizeDisplay();
    populateCmFromStitchBounds();

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

    sendToCanvas('INIT', { width, height, backstitchColor: state.backstitchColor });

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
        "cmWidth", "cmHeight",
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
        
        // Apply user edits on top of restored baseline
        if (userEditDiff.size > 0) {
            state.mappedDmcGrid = patchDmcGrid(state.mappedDmcGrid, userEditDiff, 'cie76');
            rebuildRgbFromDmc();
            sendToCanvas('SET_DMC_GRID', state.mappedDmcGrid);
        }
        
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
    
    // Apply user edits on top of post-processed result
    if (userEditDiff.size > 0) {
        state.mappedDmcGrid = patchDmcGrid(state.mappedDmcGrid, userEditDiff, 'cie76');
        rebuildRgbFromDmc();
        sendToCanvas('SET_DMC_GRID', state.mappedDmcGrid);
    }
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

    renderThreadsTable(threadStats);
}

function setupToolButtons() {
    const tools = ["pencil", "eraser", "fill", "picker", "crop"];
    const dropdownTools = ["pencil", "eraser"];
    let pressTimer = null;
    let isLongPress = false;

    const startLongPress = (btn, e) => {
        const dropdown = btn.querySelector('.tool-dropdown');
        if (!dropdown) return;
        isLongPress = false;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            document.querySelectorAll('.tool-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.add('open');
            e.stopPropagation();
        }, 500);
    };

    const cancelLongPress = () => {
        clearTimeout(pressTimer);
        pressTimer = null;
    };

    tools.forEach(id => {
        const btn = document.getElementById(id === "picker" ? "toolPicker" : id + "Btn");
        if (btn) {
            btn.addEventListener('mousedown', (e) => {
                if (dropdownTools.includes(id)) {
                    startLongPress(btn, e);
                }
            });
            btn.addEventListener('mouseup', () => {
                if (dropdownTools.includes(id)) {
                    cancelLongPress();
                }
            });
            btn.addEventListener('touchstart', (e) => {
                if (dropdownTools.includes(id)) {
                    startLongPress(btn, e);
                }
            });
            btn.addEventListener('touchend', () => {
                if (dropdownTools.includes(id)) {
                    cancelLongPress();
                }
            });

            btn.onclick = (e) => {
                if (mappingConfig.stampedMode) {
                    alert("Drawing tools are disabled in Stamped Mode. Turn off Stamped Mode to edit.");
                    return;
                }

                if (isLongPress) {
                    isLongPress = false;
                    return;
                }

                state.setTool(id);
                sendToCanvas('SET_TOOL', id);
                document.querySelectorAll("#topToolbar button").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            };
        }
    });

    // Setup tool size dropdowns
    document.querySelectorAll('#pencilBtn .tool-radio input, #eraserBtn .tool-radio input').forEach(radio => {
        radio.onclick = (e) => {
            e.stopPropagation();
            const btn = radio.closest('button');
            const size = parseInt(radio.value);
            const toolName = btn.id === 'pencilBtn' ? 'pencil' : 'eraser';

            if (toolName === 'pencil') {
                pencilSize = size;
                btn.querySelector('.tool-size').textContent = size + '×' + size;
            } else {
                eraserSize = size;
                btn.querySelector('.tool-size').textContent = size + '×' + size;
            }

            sendToCanvas('SET_TOOL_SIZE', { tool: toolName, size: size });
            btn.querySelector('.tool-dropdown').classList.remove('open');
        };
    });

    // Close dropdowns when clicking outside the button and dropdown
    document.addEventListener('click', (e) => {
        const dropdownTools = ['pencilBtn', 'eraserBtn'];
        const isOutsideButtonAndDropdown = !e.target.closest('#pencilBtn') && 
                                    !e.target.closest('#eraserBtn') && 
                                    !e.target.closest('.tool-dropdown');
        if (isOutsideButtonAndDropdown) {
            document.querySelectorAll('.tool-dropdown.open').forEach(d => d.classList.remove('open'));
        }
    });
}

// -----------------------------------------------------------------------------
// MODE TOGGLE & BACKSTITCH TOOLS
// -----------------------------------------------------------------------------
function setupModeToggle() {
    const pixelModeBtn = document.getElementById('pixelModeBtn');
    const backstitchModeBtn = document.getElementById('backstitchModeBtn');
    const pixelTools = document.getElementById('pixelTools');
    const backstitchTools = document.getElementById('backstitchTools');

    if (pixelModeBtn) {
        pixelModeBtn.onclick = () => {
            state.setMode('pixel');
            sendToCanvas('SET_MODE', 'pixel');
            
            pixelModeBtn.classList.add('active');
            backstitchModeBtn.classList.remove('active');
            
            // Show/hide tools
            if (pixelTools) pixelTools.style.display = 'inline-block';
            if (backstitchTools) backstitchTools.style.display = 'none';
            
            // Show all tabs (Palette and Threads)
            document.querySelectorAll('#rightSidebar .tabs .tab-link').forEach(tab => {
                tab.style.display = 'inline-block';
            });
            
            // Switch to palette tab
            const paletteTab = document.querySelector('#rightSidebar .tabs .tab-link:first-child');
            if (paletteTab) {
                paletteTab.click(); // Switch to palette tab
            }
        };
    }

    if (backstitchModeBtn) {
        backstitchModeBtn.onclick = () => {
            state.setMode('backstitch');
            sendToCanvas('SET_MODE', 'backstitch');
            // Ensure iframe has the current backstitch color
            sendToCanvas('SET_BACKSTITCH_COLOR', state.backstitchColor);
            
            backstitchModeBtn.classList.add('active');
            pixelModeBtn.classList.remove('active');
            
            // Show/hide tools
            if (pixelTools) pixelTools.style.display = 'none';
            if (backstitchTools) backstitchTools.style.display = 'inline-block';
            
            // Show all tabs
            document.querySelectorAll('#rightSidebar .tabs .tab-link').forEach(tab => {
                tab.style.display = 'inline-block';
            });
            
            // Switch to palette tab (single palette for both modes)
            const paletteTab = document.querySelector('#rightSidebar .tabs .tab-link:first-child');
            if (paletteTab) {
                paletteTab.click(); // Switch to palette tab
            }
        };
    }
}

function setupBackstitchTools() {
    const backstitchPencilBtn = document.getElementById('backstitchPencilBtn');
    const backstitchEraserBtn = document.getElementById('backstitchEraserBtn');

    if (backstitchPencilBtn) {
        backstitchPencilBtn.onclick = () => {
            state.setBackstitchTool('backstitchPencil');
            sendToCanvas('SET_BACKSTITCH_TOOL', 'backstitchPencil');
            
            document.querySelectorAll("#backstitchTools button").forEach(b => b.classList.remove("active"));
            backstitchPencilBtn.classList.add("active");
        };
    }

    if (backstitchEraserBtn) {
        backstitchEraserBtn.onclick = () => {
            state.setBackstitchTool('backstitchEraser');
            sendToCanvas('SET_BACKSTITCH_TOOL', 'backstitchEraser');
            
            document.querySelectorAll("#backstitchTools button").forEach(b => b.classList.remove("active"));
            backstitchEraserBtn.classList.add("active");
        };
    }
}

// -----------------------------------------------------------------------------


function setupEditHistory() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");

    if (undoBtn) undoBtn.onclick = () => sendToCanvas('CMD_UNDO');
    if (redoBtn) redoBtn.onclick = () => sendToCanvas('CMD_REDO');
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
                if (referenceImage) {
                    currentImage = referenceImage;
                    bgRemoved = false;
                    originalMaskCanvas = null;
                    originalImageBeforeBgRemoval = null;
                    const removeBgBtn = document.getElementById("removeBgBtn");
                    if (removeBgBtn) {
                        removeBgBtn.disabled = false;
                        removeBgBtn.style.opacity = '1';
                    }
                    // Hide mask adjust panel on reset
                    const maskAdjustPanel = document.getElementById("maskAdjustPanel");
                    if (maskAdjustPanel) maskAdjustPanel.style.display = "none";
                }
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
            // Handle old checkbox (if exists) or new buttons don't need UI update
            if (reduceIsolatedStitchesToggle) {
                reduceIsolatedStitchesToggle.checked = false;
            }

            const antiNoiseSlider = document.getElementById("antiNoise");
            const antiNoiseVal = document.getElementById("antiNoiseVal");
            if (antiNoiseSlider) antiNoiseSlider.value = 0;
            if (antiNoiseVal) antiNoiseVal.textContent = "0";

            const sharpenIntensitySlider = document.getElementById("sharpenIntensity");
            const sharpenIntensityVal = document.getElementById("sharpenIntensityVal");
            const sharpenRadiusSlider = document.getElementById("sharpenRadius");
            const sharpenRadiusVal = document.getElementById("sharpenRadiusVal");
            if (sharpenIntensitySlider) sharpenIntensitySlider.value = 1;
            if (sharpenIntensityVal) sharpenIntensityVal.textContent = "1";
            if (sharpenRadiusSlider) sharpenRadiusSlider.value = 2;
            if (sharpenRadiusVal) sharpenRadiusVal.textContent = "2";

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

        populateCmFromStitchBounds();
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

    cmWidthInput = document.getElementById("cmWidth");
    cmHeightInput = document.getElementById("cmHeight");

    function getPatternBounds() {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const dmcGrid = state.mappedDmcGrid;
        if (!dmcGrid || dmcGrid.length === 0) return null;
        const height = dmcGrid.length;
        const width = dmcGrid[0]?.length || 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (String(dmcGrid[y][x]) !== "0") {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        if (!isFinite(minX)) return null;
        return { width: maxX - minX + 1, height: maxY - minY + 1 };
    }

    function getFabricCount() {
        const fabricSelect = document.getElementById("fabricCountSelect");
        return fabricSelect ? parseInt(fabricSelect.value) || 14 : 14;
    }

    function populateCmFromStitchBounds() {
        const dmcGrid = state.mappedDmcGrid;
        if (!dmcGrid || dmcGrid.length === 0) return;

        const height = dmcGrid.length;
        const width = dmcGrid[0] ? dmcGrid[0].length : 0;
        if (width === 0) return;

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

        if (!hasStitches) return;

        const stitchW = maxX - minX + 1;
        const stitchH = maxY - minY + 1;
        const fabricCount = getFabricCount();

        const cmW = parseFloat((stitchW / fabricCount * 2.54).toFixed(1));
        const cmH = parseFloat((stitchH / fabricCount * 2.54).toFixed(1));

        if (cmWidthInput && cmHeightInput) {
            cmWidthInput.value = cmW;
            cmHeightInput.value = cmH;
        }
    }

    function calculateCmFromPixels(maxPixels) {
        const bounds = getPatternBounds();
        const fabricCount = getFabricCount();
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            const aspectRatio = bounds.width / bounds.height;
            const isWidthLonger = aspectRatio >= 1;
            const longerCm = (maxPixels / fabricCount * 2.54);
            if (isWidthLonger) {
                return {
                    width: parseFloat(longerCm.toFixed(1)),
                    height: parseFloat((longerCm / aspectRatio).toFixed(1))
                };
            } else {
                return {
                    width: parseFloat((longerCm / aspectRatio).toFixed(1)),
                    height: parseFloat(longerCm.toFixed(1))
                };
            }
        }
        const cm = (maxPixels / fabricCount * 2.54).toFixed(1);
        return { width: parseFloat(cm), height: parseFloat(cm) };
    }

    function updateCmInputsFromSlider() {
        if (!cmWidthInput || !cmHeightInput) return;
        if (isUpdatingSliderFromCm) return;
        isUpdatingCmFromSlider = true;
        const maxSize = parseInt(maxSizeSlider.value, 10);
        const cms = calculateCmFromPixels(maxSize);
        cmWidthInput.value = cms.width;
        cmHeightInput.value = cms.height;
        isUpdatingCmFromSlider = false;
    }

    function calculatePixelsFromCm(cmW, cmH) {
        const bounds = getPatternBounds();
        const fabricCount = getFabricCount();
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            const aspectRatio = bounds.width / bounds.height;
            const widthStitches = Math.round((cmW / 2.54) * fabricCount);
            const heightStitches = Math.round((cmH / 2.54) * fabricCount);
            if (widthStitches >= heightStitches) {
                return Math.min(widthStitches, 300);
            } else {
                return Math.min(heightStitches, 300);
            }
        }
        if (!isEmptyCanvas && !isOxsLoaded) {
            return 80;
        }
        const maxStitches = Math.max(
            Math.round((cmW / 2.54) * fabricCount),
            Math.round((cmH / 2.54) * fabricCount)
        );
        return Math.min(maxStitches, 300);
    }

    function handleCmWidthChange() {
        if (!cmWidthInput || !cmHeightInput || isUpdatingCmFromSlider) return;
        const cmW = parseFloat(cmWidthInput.value);
        if (!cmW || cmW <= 0) return;
        const bounds = getPatternBounds();
        let aspectRatio = 1;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            aspectRatio = bounds.width / bounds.height;
        }
        const cmH = cmW / aspectRatio;
        isUpdatingSliderFromCm = true;
        cmHeightInput.value = parseFloat(cmH.toFixed(1));
        const newMaxSize = calculatePixelsFromCm(cmW, cmH);
        maxSizeSlider.value = newMaxSize;
        maxSizeInput.value = newMaxSize;
        mappingConfig.maxSize = newMaxSize;

        if (isEmptyCanvas) {
            resizeEmptyCanvas(newMaxSize);
        } else {
            runMapping();
        }
        isUpdatingSliderFromCm = false;
    }

    function handleCmHeightChange() {
        if (!cmWidthInput || !cmHeightInput || isUpdatingCmFromSlider) return;
        const cmH = parseFloat(cmHeightInput.value);
        if (!cmH || cmH <= 0) return;
        const bounds = getPatternBounds();
        let aspectRatio = 1;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            aspectRatio = bounds.width / bounds.height;
        }
        const cmW = cmH * aspectRatio;
        isUpdatingSliderFromCm = true;
        cmWidthInput.value = parseFloat(cmW.toFixed(1));
        const newMaxSize = calculatePixelsFromCm(cmW, cmH);
        maxSizeSlider.value = newMaxSize;
        maxSizeInput.value = newMaxSize;
        mappingConfig.maxSize = newMaxSize;

        if (isEmptyCanvas) {
            resizeEmptyCanvas(newMaxSize);
        } else {
            runMapping();
        }
        isUpdatingSliderFromCm = false;
    }

    if (cmWidthInput) {
        cmWidthInput.oninput = () => {
            handleCmWidthChange();
        };
    }
    if (cmHeightInput) {
        cmHeightInput.oninput = () => {
            handleCmHeightChange();
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
                    updateCmInputsFromSlider();
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

                    const sharpenIntensitySlider = document.getElementById("sharpenIntensity");
                    const sharpenIntensityVal = document.getElementById("sharpenIntensityVal");
                    const sharpenRadiusSlider = document.getElementById("sharpenRadius");
                    const sharpenRadiusVal = document.getElementById("sharpenRadiusVal");
                    if (sharpenIntensitySlider) sharpenIntensitySlider.value = 1;
                    if (sharpenIntensityVal) sharpenIntensityVal.textContent = "1";
                    if (sharpenRadiusSlider) sharpenRadiusSlider.value = 2;
                    if (sharpenRadiusVal) sharpenRadiusVal.textContent = "2";

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

    // 6. Dithering Controls
    const ditherModeSelect = document.getElementById("ditherMode");
    const ditherStrengthSlider = document.getElementById("ditherStrength");
    const ditherStrengthVal = document.getElementById("ditherStrengthVal");

    const updateDithering = () => {
        if (ditherModeSelect && ditherStrengthSlider) {
            const mode = ditherModeSelect.value;
            const isNone = mode === "None";

            ditherStrengthSlider.disabled = isNone;

            if (isNone) {
                mappingConfig.ditherMode = "None";
                mappingConfig.ditherStrength = 0;
                ditherStrengthSlider.value = 1;
                if (ditherStrengthVal) ditherStrengthVal.textContent = "1";
            } else {
                mappingConfig.ditherMode = mode;
                const sliderVal = parseInt(ditherStrengthSlider.value, 10) || 1;
                mappingConfig.ditherStrength = sliderVal;
                if (ditherStrengthVal) ditherStrengthVal.textContent = String(sliderVal);
            }

            if (currentImage) {
                runMapping();
            }
        }
    };

    if (ditherModeSelect) {
        ditherModeSelect.onchange = updateDithering;
    }

    if (ditherStrengthSlider) {
        ditherStrengthSlider.oninput = () => {
            const val = parseInt(ditherStrengthSlider.value, 10);
            if (ditherStrengthVal) ditherStrengthVal.textContent = val;
            mappingConfig.ditherStrength = val;
            if (currentImage) {
                runMapping();
            }
        };
    }

    // 7. Toggles & Smoothers
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

    const sharpenIntensitySlider = document.getElementById("sharpenIntensity");
    const sharpenIntensityVal = document.getElementById("sharpenIntensityVal");
    const sharpenRadiusSlider = document.getElementById("sharpenRadius");
    const sharpenRadiusVal = document.getElementById("sharpenRadiusVal");

    if (sharpenIntensitySlider) {
        sharpenIntensitySlider.oninput = () => {
            const val = parseInt(sharpenIntensitySlider.value, 10);
            sharpenIntensityVal.textContent = val;
            mappingConfig.sharpenIntensity = val;

            if (isOxsLoaded) {
                applyOxsPostProcessingWithUndo('sharpenIntensity', val);
            } else {
                runMapping();
            }
        };
    }

    if (sharpenRadiusSlider) {
        sharpenRadiusSlider.oninput = () => {
            const val = parseFloat(sharpenRadiusSlider.value);
            sharpenRadiusVal.textContent = val;
            mappingConfig.sharpenRadius = val;

            if (isOxsLoaded) {
                applyOxsPostProcessingWithUndo('sharpenRadius', val);
            } else {
                runMapping();
            }
        };
    }

    const applyIsolatedStitchesBtn = document.getElementById("applyIsolatedStitches");

    // Apply Isolated Stitch Reduction - run one pass
    if (applyIsolatedStitchesBtn) {
        applyIsolatedStitchesBtn.onclick = () => {
            // Save canvas state before making changes for undo
            sendToCanvas('CMD_SAVE_UNDO');
            
            if (isOxsLoaded) {
                console.log("OXS apply isolated stitch reduction");
                applyOxsPostProcessing('reduceIsolatedStitches');
                if (userEditDiff.size > 0) {
                    state.mappedDmcGrid = patchDmcGrid(state.mappedDmcGrid, userEditDiff, 'cie76');
                    rebuildRgbFromDmc();
                    sendToCanvas('SET_DMC_GRID', state.mappedDmcGrid);
                }
                sendToCanvas('UPDATE_GRID', state.mappedRgbGrid);
                updateThreadsTableFromGrid();
                updatePaletteAfterPostProcess();
            } else {
                // Run isolated stitch reduction directly on current grid (normal image)
                console.log("Apply isolated stitch reduction");
                const currentDmc = state.mappedDmcGrid;
                const currentRgb = state.mappedRgbGrid;
                const reducedDmc = removeIsolatedStitches(currentDmc, currentRgb);
                const reducedRgb = reducedDmc.map(row => row.map(c => getRgbFromCode(c)));

                state.mappedDmcGrid = reducedDmc;
                state.mappedRgbGrid = reducedRgb;
                state.setMappingResults(reducedRgb, reducedDmc);

                if (userEditDiff.size > 0) {
                    const patchedDmc = patchDmcGrid(reducedDmc, userEditDiff, mappingConfig.distanceMethod);
                    state.mappedDmcGrid = patchedDmc;
                    state.mappedRgbGrid = patchedDmc.map(row => row.map(c => getRgbFromCode(c)));
                    state.setMappingResults(state.mappedRgbGrid, patchedDmc);
                }

                sendToCanvas('SET_DMC_GRID', state.mappedDmcGrid);
                sendToCanvas('UPDATE_GRID', state.mappedRgbGrid);
                updateSidebarFromState();
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
            
            // For OXS and empty canvas, get the live DMC grid with user edits
            let dmcGrid = state.mappedDmcGrid;
            if ((isOxsLoaded || isEmptyCanvas) && state.mappedRgbGrid) {
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

                // For OXS or empty canvas mode, get the live grid from canvas with user edits
                if ((isOxsLoaded || isEmptyCanvas) && state.mappedRgbGrid) {
                    exportDmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid) || exportDmcGrid;
                    exportRgbGrid = state.mappedRgbGrid;
                }

                // For OXS or empty canvas with stamped mode: build stamped grid and lookup
                let stampedLookup = {};
                let exportVisualGrid = exportRgbGrid;
                if ((isOxsLoaded || isEmptyCanvas) && mappingConfig.stampedMode && exportDmcGrid) {
                    const stampedResult = buildStampedGrid(exportDmcGrid, { hueShift: mappingConfig.stampedHue });
                    exportVisualGrid = stampedResult.grid;
                    stampedLookup = stampedResult.lookup;
                }

                const data = buildExportData(state, mappingConfig, {
                    fabricCount: fabricSelect.value,
                    mode: modeSelect.value
                });

                // Override grids with live data for OXS or empty canvas
                if (isOxsLoaded || isEmptyCanvas) {
                    data.dmcGrid = exportDmcGrid;
                    data.rgbGrid = exportVisualGrid;
                    
                    // Rebuild palette with stamped colors if needed
                    const usedCodes = new Set(exportDmcGrid.flat().map(String));
                    
                    // For empty canvas, use DMC_RGB; for OXS, use loadedOxsPalette
                    let dataPalette = [];
                    if (isEmptyCanvas) {
                        dataPalette = DMC_RGB.filter(d => usedCodes.has(String(d[0]))).map(d => ({
                            code: String(d[0]),
                            name: d[1],
                            rgb: d[2],
                            stampedRgb: mappingConfig.stampedMode ? (stampedLookup[String(d[0])] || null) : null,
                            count: exportDmcGrid.flat().filter(c => String(c) === String(d[0])).length
                        }));
                    } else {
                        dataPalette = Object.entries(loadedOxsPalette)
                            .filter(([code]) => usedCodes.has(code))
                            .map(([code, entry]) => ({
                                code: code,
                                name: entry.name,
                                rgb: entry.rgb,
                                stampedRgb: mappingConfig.stampedMode ? (stampedLookup[code] || null) : null,
                                count: exportDmcGrid.flat().filter(c => String(c) === code).length
                            }));
                    }
                    data.palette = dataPalette.sort((a, b) => b.count - a.count);
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

            // For empty canvas or OXS with stamped mode, build from live DMC grid
            if (mappingConfig.stampedMode && state.mappedDmcGrid) {
                let dmcGrid = state.mappedDmcGrid;
                if ((isEmptyCanvas || isOxsLoaded) && state.mappedRgbGrid) {
                    dmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid) || dmcGrid;
                }
                rgbGrid = buildStampedRgbGrid(dmcGrid);
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

            // For OXS or empty canvas mode, get the live grid from canvas with user edits
            if ((isOxsLoaded || isEmptyCanvas) && state.mappedRgbGrid) {
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
                state.backstitchGrid
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

function setupZoomButtons() {
    document.getElementById("zoomInBtn").onclick = () => sendToCanvas('CMD_ZOOM', 1);
    document.getElementById("zoomOutBtn").onclick = () => sendToCanvas('CMD_ZOOM', -1);
    document.getElementById("resetViewBtn").onclick = () => sendToCanvas('CMD_RESET_VIEW');
}

function setupReferenceButton() {
    const btn = document.getElementById("referenceBtn");
    const dropdown = document.getElementById("referenceDropdown");
    const opacitySlider = document.getElementById("referenceOpacity");
    const opacityVal = document.getElementById("referenceOpacityVal");

    if (!btn || !dropdown) return;

    btn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle("open");
    };

    document.addEventListener("click", (e) => {
        if (!dropdown.contains(e.target) && e.target !== btn) {
            dropdown.classList.remove("open");
        }
    });

    opacitySlider.oninput = () => {
        const opacity = parseInt(opacitySlider.value) / 100;
        opacityVal.textContent = opacitySlider.value + "%";
        sendToCanvas('SET_REFERENCE_OPACITY', opacity);
    };

    sendToCanvas('SET_REFERENCE_POSITION', 'over');

    function updateReferenceImage() {
        const imgToUse = bgRemoved ? currentImage : referenceImage;
        if (imgToUse && state && state.mappedRgbGrid) {
            const gridW = state.mappedRgbGrid[0].length;
            const gridH = state.mappedRgbGrid.length;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = gridW;
            tempCanvas.height = gridH;
            const ctx = tempCanvas.getContext('2d', { alpha: true });
            ctx.drawImage(imgToUse, 0, 0, gridW, gridH);

            const scaledImageData = tempCanvas.toDataURL("image/png");
            sendToCanvas('SET_REFERENCE_IMAGE', {
                imageData: scaledImageData,
                width: gridW,
                height: gridH
            });
        }
    }

    window.addEventListener("message", (e) => {
        if (e.data.type === 'SYNC_GRID_TO_PARENT') {
            updateReferenceImage();
        }
    });
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
    const ctx = offscreenCanvas.getContext('2d', { alpha: true });

    // 2. Create ImageData to manipulate raw pixels
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const rgb = rgbGrid[y][x];

            // Handle transparency (cloth sentinel is [254,254,254])
            if (rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254) {
                data[index] = 0;
                data[index + 1] = 0;
                data[index + 2] = 0;
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

function getDmcName(code) {
    if (!code) return null;
    for (const [c, name, rgb] of DMC_RGB) {
        if (c === code) return name;
    }
    return null;
}

function updateDmcHoverTooltip(payload) {
    const swatchEl = document.getElementById('hoverColorSwatch');
    const codeEl = document.getElementById('hoverColorCode');
    const nameEl = document.getElementById('hoverColorName');

    if (!swatchEl || !codeEl || !nameEl) return;

    const { code, rgb, isCloth } = payload || {};

    // Handle cloth/none case
    if (isCloth || (code && String(code) === '0')) {
        codeEl.textContent = 'None';
        nameEl.textContent = 'Cloth';
        swatchEl.style.background = 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 50% / 16px 16px';
        return;
    }

    if (!code) {
        codeEl.textContent = '';
        nameEl.textContent = '';
        swatchEl.style.background = 'none';
        swatchEl.style.backgroundColor = '#eee';
        return;
    }

    const name = getDmcName(code);
    codeEl.textContent = code;
    nameEl.textContent = name || 'Unknown';

    // Set swatch color if rgb provided
    if (rgb && Array.isArray(rgb)) {
        // Clear background override and set backgroundColor for actual color
        swatchEl.style.background = 'none';
        swatchEl.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    } else {
        swatchEl.style.background = 'none';
        swatchEl.style.backgroundColor = '#ccc';
    }
}

function resetUIControls() {
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
    mappingConfig.sharpenIntensity = 1;
    mappingConfig.sharpenRadius = 2;
    mappingConfig.reduceIsolatedStitches = false;
    mappingConfig.distanceMethod = "euclidean";
    mappingConfig.minOccurrence = 1;
    mappingConfig.stampedMode = false;
    mappingConfig.pixelArtMode = false;
    mappingConfig.ditherMode = "None";
    mappingConfig.ditherStrength = 0;

    const pixelArtToggle = document.getElementById("pixelArtMode");
    if (pixelArtToggle) pixelArtToggle.checked = false;

    const ids = ["brightness", "saturation", "contrast", "greenToMagenta", "cyanToRed", "blueToYellow", "antiNoise", "sharpenIntensity", "sharpenRadius"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            if (id === "sharpenRadius") {
                el.value = 2;
            } else if (id === "sharpenIntensity") {
                el.value = 1;
            } else {
                el.value = 0;
            }
        }
    });

    const sizeSlider = document.getElementById("maxSizeSlider");
    const sizeInput = document.getElementById("maxSizeInput");
    if (sizeSlider) sizeSlider.value = 80;
    if (sizeInput) sizeInput.value = 80;

    const mergeSlider = document.getElementById("mergeNearest");
    const mergeVal = document.getElementById("mergeNearestVal");
    if (mergeSlider) mergeSlider.value = 0;
    if (mergeVal) mergeVal.textContent = "Off";

    const maskAdjustSlider = document.getElementById("maskAdjustSlider");
    const maskAdjustValue = document.getElementById("maskAdjustValue");
    if (maskAdjustSlider) maskAdjustSlider.value = 0;
    if (maskAdjustValue) maskAdjustValue.textContent = "0";

    const antiNoiseVal = document.getElementById("antiNoiseVal");
    if (antiNoiseVal) antiNoiseVal.textContent = "0";

    const sharpenIntensityVal = document.getElementById("sharpenIntensityVal");
    const sharpenRadiusVal = document.getElementById("sharpenRadiusVal");
    if (sharpenIntensityVal) sharpenIntensityVal.textContent = "1";
    if (sharpenRadiusVal) sharpenRadiusVal.textContent = "2";

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

    // Dithering Controls
    const ditherModeSelect = document.getElementById("ditherMode");
    const ditherStrengthSlider = document.getElementById("ditherStrength");
    const ditherStrengthVal = document.getElementById("ditherStrengthVal");
    if (ditherModeSelect) ditherModeSelect.value = "None";
    if (ditherStrengthSlider) {
        ditherStrengthSlider.disabled = true;
        ditherStrengthSlider.value = 1;
    }
    if (ditherStrengthVal) ditherStrengthVal.textContent = "1";
}

// -----------------------------------------------------------------------------
// BOOTSTRAP
// -----------------------------------------------------------------------------
window.addEventListener("load", () => {
    state = new EditorState(null);

    // Update color preview when color changes
    function updateCurrentColorDisplay(rgb) {
        // Update sidebar current color display
        const currentSwatch = document.getElementById('currentColorSwatch');
        const currentCodeEl = document.getElementById('currentColorCode');
        const currentNameEl = document.getElementById('currentColorName');

        if (currentSwatch) {
            currentSwatch.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        }

        if (currentCodeEl && currentNameEl) {
            // Check for cloth sentinel (254,254,254)
            if (rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254) {
                currentCodeEl.textContent = 'None';
                currentNameEl.textContent = 'Cloth';
                if (currentSwatch) {
                    currentSwatch.style.background = 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 50% / 16px 16px';
                }
            } else {
                // Find closest DMC match
                const dmcEntry = DMC_RGB.find(d => {
                    const dr = d[2][0] - rgb[0];
                    const dg = d[2][1] - rgb[1];
                    const db = d[2][2] - rgb[2];
                    return (dr*dr + dg*dg + db*db) < 100;
                });
                if (dmcEntry) {
                    currentCodeEl.textContent = dmcEntry[0];
                    currentNameEl.textContent = dmcEntry[1];
                } else {
                    currentCodeEl.textContent = '';
                    currentNameEl.textContent = 'Custom';
                }
            }
        }
    }

    state.on("colorChanged", (rgb) => {
        updateCurrentColorDisplay(rgb);
    });

    const canvasFrame = document.getElementById('canvasFrame');

    const initializeCanvas = () => {
        console.log("Sending INIT to iframe...");
        sendToCanvas('INIT', {
            width: state.pixelGrid.width,
            height: state.pixelGrid.height,
            backstitchColor: state.backstitchColor
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

    setupCollapsiblePanels();
    setupUpload();
    setupNewCanvas();
    setupBgRemover();
    setupMaskAdjustSlider();
    setupOxsUpload();
    setupToolButtons();
    setupModeToggle();
    setupBackstitchTools();
    setupEditHistory();
    setupResetControls();
    setupMappingControls();
    setupExportButtons();
    setupZoomButtons();
    setupReferenceButton();
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

        // Handle crop overlay with keyboard
        const cropOverlay = document.getElementById('cropOverlay');
        if (cropOverlay && cropOverlay.style.display !== 'none') {
            if (e.key === 'Enter') {
                document.getElementById('cropConfirmBtn').click();
            } else if (e.key === 'Escape') {
                document.getElementById('cropCancelBtn').click();
            }
            return;
        }

        // Send Escape to canvas when in crop tool mode (no overlay)
        if (e.key === 'Escape') {
            sendToCanvas('CROP_CANCEL');
        }
    });

    window.addEventListener('message', (e) => {
        const { type, payload } = e.data;
        console.log('[Parent] message received:', type, payload);

        if (type === 'REPORT_GRID_STATS') {
            // Sidebar now updates in SYNC handler after mappedDmcGrid is patched
        }

        if (type === 'HOVER_DMC') {
            updateDmcHoverTooltip(payload);
            return;
        }

        if (type === 'CONTEXT_MENU') {
            showContextMenu(payload);
            return;
        }

        if (type === 'CROP_START') {
            showCropOverlay(payload);
            return;
        }

        if (type === 'SYNC_GRID_TO_PARENT') {
            // In stamped mode the canvas shows stamped colors — never overwrite the true RGB grid
            if (!mappingConfig.stampedMode) {
                state.mappedRgbGrid = payload;
                if (!isOxsLoaded) {
                    captureUserEdits(payload);
                }
            }

            // For OXS or empty canvas in stamped mode: the canvas sends stamped colors, rebuild display
            if ((isOxsLoaded || isEmptyCanvas) && mappingConfig.stampedMode && state.mappedRgbGrid) {
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

    // -------------------------------------------------------------------------
    // CONTEXT MENU
    // -------------------------------------------------------------------------
    let currentContextMenuPos = null;

    function showContextMenu(payload) {
        const { gx, gy, rgb, clientX, clientY } = payload;
        const menu = document.getElementById('contextMenu');
        if (!menu) return;

        // Store position for menu actions
        currentContextMenuPos = { gx, gy, rgb };

        // Update color preview in "Pick Color" option
        const colorPreview = menu.querySelector('.ctx-color-preview');
        if (colorPreview && rgb) {
            colorPreview.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        }

        // Update color preview in "Replace Color" option too
        const replaceColorPreview = document.getElementById('ctxReplaceColor')?.querySelector('.ctx-color-preview');
        if (replaceColorPreview && rgb) {
            replaceColorPreview.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        }

        // Position menu at cursor - convert from iframe coordinates to parent page coordinates
        const canvasFrame = document.getElementById('canvasFrame');
        const frameRect = canvasFrame ? canvasFrame.getBoundingClientRect() : { left: 0, top: 0 };
        let x = clientX + frameRect.left;
        let y = clientY + frameRect.top;

        // Adjust if menu would go off screen
        const menuRect = menu.getBoundingClientRect();
        if (x + 180 > window.innerWidth) {
            x = window.innerWidth - 190;
        }
        if (y + 80 > window.innerHeight) {
            y = window.innerHeight - 90;
        }

        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        menu.classList.add('visible');

        // Tell canvas iframe that context menu is open (disables drawing)
        sendToCanvas('SET_CONTEXT_MENU_OPEN', true);

        // If clicking elsewhere, close menu
        const closeMenu = () => closeContextMenu();
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    function closeContextMenu() {
        const menu = document.getElementById('contextMenu');
        if (menu) menu.classList.remove('visible');
        currentContextMenuPos = null;
        
        // Tell canvas iframe that context menu is closed (enables drawing)
        sendToCanvas('SET_CONTEXT_MENU_OPEN', false);
    }

    function handlePickColor() {
        if (!currentContextMenuPos || !currentContextMenuPos.rgb) return;
        
        // Set the active color to the clicked pixel's color
        state.setColor(currentContextMenuPos.rgb);
        
        // Update UI to reflect new color (uses sidebar display now)
        updateCurrentColorDisplay(currentContextMenuPos.rgb);

        // Deselect all palette swatches
        document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
        
        // Also sync to canvas
        sendToCanvas('SET_COLOR', currentContextMenuPos.rgb);

        // Close the menu
        closeContextMenu();
    }

    function handleFillWithColor() {
        if (!currentContextMenuPos || currentContextMenuPos.gx === undefined || currentContextMenuPos.gx < 0) return;

        // Send flood fill command to canvas iframe
        sendToCanvas('FLOOD_FILL', {
            gx: currentContextMenuPos.gx,
            gy: currentContextMenuPos.gy,
            rgb: state.activeColor
        });

        // Close the menu
        closeContextMenu();
    }

    // Bind context menu actions
    document.getElementById('ctxPickColor')?.addEventListener('click', (e) => {
        e.stopPropagation();
        handlePickColor();
    });

    document.getElementById('ctxFill')?.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFillWithColor();
    });

    // Replace Color state
    let replaceColorFromRgb = null;
    let replaceColorFromCode = null;
    let replaceColorToRgb = null;
    let replaceColorToCode = null;

    function openReplaceColorDialog() {
        if (!currentContextMenuPos || !currentContextMenuPos.rgb) {
            closeContextMenu();
            return;
        }

        replaceColorFromRgb = currentContextMenuPos.rgb;
        replaceColorToRgb = null;
        replaceColorToCode = null;

        // Check for cloth sentinel (254,254,254) - this is code "0"
        const isCloth = replaceColorFromRgb[0] === 254 && 
                        replaceColorFromRgb[1] === 254 && 
                        replaceColorFromRgb[2] === 254;

        let dmcEntry = null;
        if (isCloth) {
            replaceColorFromCode = "0";
        } else {
            // Find the DMC code for the "from" color
            const distFn = getDistanceFn('cie76');
            dmcEntry = nearestDmcColor(replaceColorFromRgb, distFn, getDmcLabCache(false), DMC_RGB);
            replaceColorFromCode = dmcEntry ? String(dmcEntry[0]) : null;
        }

        // Update dialog UI
        const fromSwatch = document.getElementById('replaceFromSwatch');
        const fromInfo = document.getElementById('replaceFromInfo');
        if (fromSwatch) {
            if (isCloth) {
                fromSwatch.style.background = 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 50% / 16px 16px';
            } else {
                fromSwatch.style.backgroundColor = `rgb(${replaceColorFromRgb[0]}, ${replaceColorFromRgb[1]}, ${replaceColorFromRgb[2]})`;
            }
        }
        if (fromInfo) {
            fromInfo.textContent = isCloth ? 'None (Cloth)' : (dmcEntry ? `DMC ${dmcEntry[0]}` : 'Custom');
        }

        const toSwatch = document.getElementById('replaceToSwatch');
        const toInfo = document.getElementById('replaceToInfo');
        if (toSwatch) toSwatch.style.background = 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 50% / 16px 16px';
        if (toInfo) toInfo.textContent = 'Select a DMC color';

        updateReplaceCount();
        renderReplacePalette();

        closeContextMenu();

        const overlay = document.getElementById('replaceColorOverlay');
        if (overlay) overlay.style.display = 'flex';
    }

    function renderReplacePalette() {
        const container = document.getElementById('replacePalette');
        if (!container) return;

        container.innerHTML = '';
        
        // Add "None (Cloth)" option at the top
        const noneRow = document.createElement('div');
        noneRow.className = 'palette-row none-option';
        noneRow.dataset.code = '0';
        noneRow.innerHTML = `
            <div class="swatch" style="background: repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 50% / 16px 16px;"></div>
            <div class="palette-info">
                <strong>None</strong> <span>Cloth (Transparent)</span>
            </div>
        `;
        noneRow.onclick = () => selectReplaceColor('0', [255, 255, 255]);
        container.appendChild(noneRow);

        const usedCodes = getUsedDmcCodes();
        const usedSet = new Set(usedCodes);

        const usedColors = [];
        const unusedColors = [];

        DMC_RGB.forEach(([code, name, rgb]) => {
            if (usedSet.has(String(code))) {
                usedColors.push([code, name, rgb]);
            } else {
                unusedColors.push([code, name, rgb]);
            }
        });

        usedColors.sort((a, b) => Number(a[0]) - Number(b[0]));
        unusedColors.sort((a, b) => Number(a[0]) - Number(b[0]));

        const createRow = (code, name, rgb, isUsed) => {
            const row = document.createElement('div');
            row.className = 'palette-row';
            row.dataset.code = code;
            const rgbStr = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            row.innerHTML = `
                <div class="swatch" style="background-color: ${rgbStr}"></div>
                <div class="palette-info">
                    <strong>${code}</strong> <span>${name}</span>
                    ${isUsed ? '<span class="star">★</span>' : ''}
                </div>
            `;
            row.onclick = () => selectReplaceColor(code, rgb);
            return row;
        };

        if (usedColors.length > 0) {
            const header = document.createElement('div');
            header.className = 'palette-section-header';
            header.textContent = 'IN USE';
            header.style.padding = '6px 10px';
            header.style.fontSize = '0.7rem';
            container.appendChild(header);
            usedColors.forEach(([code, name, rgb]) => container.appendChild(createRow(code, name, rgb, true)));
        }

        if (unusedColors.length > 0) {
            if (usedColors.length > 0) {
                const header = document.createElement('div');
                header.className = 'palette-section-header';
                header.textContent = 'NOT IN USE';
                header.style.padding = '6px 10px';
                header.style.fontSize = '0.7rem';
                container.appendChild(header);
            }
            unusedColors.forEach(([code, name, rgb]) => container.appendChild(createRow(code, name, rgb, false)));
        }
    }

    function selectReplaceColor(code, rgb) {
        replaceColorToCode = String(code);
        replaceColorToRgb = rgb;

        const toSwatch = document.getElementById('replaceToSwatch');
        const toInfo = document.getElementById('replaceToInfo');
        
        if (code === '0') {
            // "None" selected - show transparent/checkered swatch
            if (toSwatch) toSwatch.style.background = 'repeating-conic-gradient(#ccc 0% 25%, white 0% 50%) 50% / 16px 16px';
            if (toInfo) toInfo.textContent = 'Cloth (Transparent)';
        } else {
            // Clear background override and set backgroundColor for actual DMC color
            if (toSwatch) {
                toSwatch.style.background = 'none';
                toSwatch.style.backgroundColor = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            }
            if (toInfo) toInfo.textContent = `DMC ${code}`;
        }

        // Highlight selected row
        document.querySelectorAll('#replacePalette .palette-row').forEach(r => r.classList.remove('selected'));
        document.querySelector(`#replacePalette .palette-row[data-code="${code}"]`)?.classList.add('selected');

        updateReplaceCount();
    }

    function getUsedDmcCodes() {
        const dmcGrid = state.mappedDmcGrid;
        if (!dmcGrid || dmcGrid.length === 0) return [];
        const codes = new Set();
        dmcGrid.forEach(row => row.forEach(code => {
            if (code !== '0') codes.add(String(code));
        }));
        return Array.from(codes);
    }

    function countPixelsOfColor(dmcGrid, targetCode) {
        if (!dmcGrid) return 0;
        let count = 0;
        dmcGrid.forEach(row => row.forEach(code => {
            if (String(code) === String(targetCode)) count++;
        }));
        return count;
    }

    function updateReplaceCount() {
        const countEl = document.getElementById('replaceCountInfo');
        const confirmBtn = document.getElementById('replaceColorConfirm');
        if (!countEl || !confirmBtn) return;

        if (!replaceColorFromCode || !replaceColorToCode) {
            countEl.textContent = 'Select a color to replace with';
            confirmBtn.disabled = true;
            return;
        }

        if (replaceColorFromCode === replaceColorToCode) {
            countEl.textContent = 'Same color selected - no changes';
            confirmBtn.disabled = true;
            return;
        }

        const count = countPixelsOfColor(state.mappedDmcGrid, replaceColorFromCode);
        countEl.textContent = `${count} pixel${count !== 1 ? 's' : ''} will be changed`;
        confirmBtn.disabled = count === 0;
    }

    function closeReplaceColorDialog() {
        const overlay = document.getElementById('replaceColorOverlay');
        if (overlay) overlay.style.display = 'none';
        replaceColorFromRgb = null;
        replaceColorFromCode = null;
        replaceColorToRgb = null;
        replaceColorToCode = null;
    }

    // -------------------------------------------------------------------------
    // REPLACE COLOR
    // -------------------------------------------------------------------------
    
    function rebuildRgbGridFromDmc(dmcGrid) {
        if (!dmcGrid) return null;
        
        const h = dmcGrid.length;
        const w = dmcGrid[0]?.length || 0;
        // Use 254,254,254 as sentinel for cloth (renderer will show checkered)
        const rgbGrid = Array.from({ length: h }, () => 
            Array.from({ length: w }, () => [254, 254, 254])
        );
        
        const dmcToRgb = {};
        DMC_RGB.forEach(([code, , rgb]) => { dmcToRgb[String(code)] = rgb; });
        
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const code = String(dmcGrid[y][x]);
                if (code !== "0" && dmcToRgb[code]) {
                    rgbGrid[y][x] = [...dmcToRgb[code]];
                }
            }
        }
        return rgbGrid;
    }

    function executeReplaceColor() {
        if (!replaceColorFromCode || !replaceColorToCode) return;

        const dmcGrid = state.mappedDmcGrid;
        if (!dmcGrid) return;

        const newDmcGrid = dmcGrid.map(row =>
            row.map(code => String(code) === replaceColorFromCode ? replaceColorToCode : code)
        );

        state.mappedDmcGrid = newDmcGrid;

        const newRgbGrid = rebuildRgbGridFromDmc(newDmcGrid);

        state.mappedRgbGrid = newRgbGrid;
        sendToCanvas('SET_DMC_GRID', newDmcGrid);
        sendToCanvas('SET_RGB_GRID', newRgbGrid);

        updateThreadsTableFromGrid();
        renderPalette(getUsedDmcCodes());
        closeReplaceColorDialog();
    }

    // Bind Replace Color menu item
    document.getElementById('ctxReplaceColor')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openReplaceColorDialog();
    });

    // Bind Replace Color dialog buttons
    document.getElementById('replaceColorClose')?.addEventListener('click', closeReplaceColorDialog);
    document.getElementById('replaceColorCancel')?.addEventListener('click', closeReplaceColorDialog);
    document.getElementById('replaceColorConfirm')?.addEventListener('click', executeReplaceColor);

    // Close context menu on Escape (unless crop overlay is open)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const cropOverlay = document.getElementById('cropOverlay');
            if (cropOverlay && cropOverlay.style.display !== 'none') {
                document.getElementById('cropCancelBtn').click();
                return;
            }
            const replaceOverlay = document.getElementById('replaceColorOverlay');
            if (replaceOverlay && replaceOverlay.style.display !== 'none') {
                closeReplaceColorDialog();
                return;
            }
            closeContextMenu();
        }
    });

    renderPalette([]);
    // Initialize current color display in sidebar
    const initColorSwatch = document.getElementById('currentColorSwatch');
    const initHoverSwatch = document.getElementById('hoverColorSwatch');
    if (initColorSwatch) {
        initColorSwatch.style.backgroundColor = 'rgb(0,0,0)';
    }
    if (initHoverSwatch) {
        initHoverSwatch.style.backgroundColor = '#eee';
    }
    state.setColor([0, 0, 0]);

    // Initialize with empty canvas
    createEmptyCanvas(50, 50);

    console.log("Cross Stitch Editor Parent Shell Initialized.");
});