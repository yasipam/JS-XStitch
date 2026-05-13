// parent/empty-canvas.js
// -----------------------------------------------------------------------------
// Empty canvas creation and management
// -----------------------------------------------------------------------------

import { state, isEmptyCanvas, isOxsLoaded, hasEmptyCanvasEdits, hasBackstitchEdits, loadedOxsPalette, userEditDiff, lastBaselineGrid, lastBaselineDmcGrid, mappingConfig } from './state.js';
import { sendToCanvas } from './canvas.js';
import { dmcCodeToEntry, dmcCodeToRgb } from './constants.js';
import { DMC_RGB } from '../mapping/constants.js';
import { findNearestDmcCode } from '../mapping/utils.js';

export function createEmptyCanvas(width, height) {
    console.log(`Creating empty canvas: ${width}x${height}`);

    isEmptyCanvas = true;
    hasEmptyCanvasEdits = false;
    hasBackstitchEdits = false;
    isOxsLoaded = false;
    loadedOxsPalette = null;
    currentImage = null;
    referenceImage = null;
    bgRemoved = false;

    resetUIElements({ resetMask: true });

    updateCropToolState();

    state.clear();
    userEditDiff.clear();
    lastBaselineGrid = null;
    lastBaselineDmcGrid = null;
    state.originalImageURL = null;

    const removeBgBtn = document.getElementById("removeBgBtn");
    const bgRemoveStatus = document.getElementById("bgRemoveStatus");
    if (removeBgBtn) removeBgBtn.style.display = "none";
    if (bgRemoveStatus) bgRemoveStatus.style.display = "none";

    originalMaskCanvas = null;
    originalImageBeforeBgRemoval = null;
    const maskAdjustPanel = document.getElementById("maskAdjustPanel");
    if (maskAdjustPanel) maskAdjustPanel.style.display = "none";

    bgRemoved = false;
    const refOpacity = document.getElementById("referenceOpacity");
    const refOpacityVal = document.getElementById("referenceOpacityVal");
    if (refOpacity) refOpacity.value = 0;
    if (refOpacityVal) refOpacityVal.textContent = "0%";
    sendToCanvas('SET_REFERENCE_OPACITY', 0);
    sendToCanvas('TOGGLE_REFERENCE', true);

    const emptyDmcGrid = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => "0")
    );
    const emptyRgbGrid = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => [255, 255, 255])
    );

    state.mappedDmcGrid = emptyDmcGrid;
    state.mappedRgbGrid = emptyRgbGrid;

    sendToCanvas('INIT', { width, height, clearBackstitch: true });
    sendToCanvas('UPDATE_GRID', emptyRgbGrid);

    setMappingControlsEnabled(true, false);

    renderPalette([]);
    updateSidebarFromEmptyCanvas();
    updatePatternSizeDisplay();

    console.log("Empty canvas created");
}

export function resizeEmptyCanvas(newSize) {
    console.log(`Resizing empty canvas to: ${newSize}x${newSize}`);

    const height = newSize;
    const width = newSize;

    const oldRgbGrid = state.mappedRgbGrid || [];
    const oldDmcGrid = state.mappedDmcGrid || [];
    const oldHeight = oldRgbGrid && oldRgbGrid.length > 0 ? oldRgbGrid.length : 0;
    const oldWidth = oldRgbGrid && oldRgbGrid[0] && oldRgbGrid[0].length > 0 ? oldRgbGrid[0].length : 0;

    const newDmcGrid = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => "0")
    );
    const newRgbGrid = Array.from({ length: height }, () =>
        Array.from({ length: width }, () => [255, 255, 255])
    );

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
    populateCmFromStitchBounds();

    console.log("Empty canvas resized");
}

export function updateSidebarFromEmptyCanvas() {
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
            const isClothSentinel = rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254;
            if (isWhite || isClothSentinel) continue;

            const matchedCode = findNearestDmcCode(rgb, DMC_RGB);

            if (matchedCode) {
                const entry = dmcCodeToEntry.get(matchedCode);
                if (entry) {
                    const dr = rgb[0] - entry.rgb[0];
                    const dg = rgb[1] - entry.rgb[1];
                    const db = rgb[2] - entry.rgb[2];
                    const dist = dr * dr + dg * dg + db * db;

                    if (dist < DISTANCE_THRESHOLD) {
                        counts[matchedCode] = (counts[matchedCode] || 0) + 1;
                        usedCodes.add(matchedCode);
                    }
                }
            }
        }
    }

    const threadStats = Object.entries(counts).map(([code, count]) => {
        const entry = dmcCodeToEntry.get(code);
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
    }

    renderThreadsTable(threadStats);
    renderPalette(Array.from(usedCodes));
    updatePatternSizeDisplay();
}

// Need these from ui-render.js - will import after creating it
import { renderPalette, renderThreadsTable, updatePatternSizeDisplay, setMappingControlsEnabled, resetUIElements, updateCropToolState, populateCmFromStitchBounds } from './ui-setup.js';