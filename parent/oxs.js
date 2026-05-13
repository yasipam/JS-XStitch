// parent/oxs.js
// -----------------------------------------------------------------------------
// OXS file loading, saving and post-processing
// -----------------------------------------------------------------------------

import { state, isOxsLoaded, loadedOxsPalette, oxsBaselineDmcGrid, oxsBaselineRgbGrid, oxsBaselinePalette, isEmptyCanvas, mappingConfig, userEditDiff, hasBackstitchEdits } from './state.js';
import { sendToCanvas } from './canvas.js';
import { patchDmcGrid, getRgbFromCode, enforceMaxColors } from './mapping.js';
import { dmcCodeToEntry, dmcCodeToRgb } from './constants.js';
import { DMC_RGB } from '../mapping/constants.js';
import { findNearestDmcCode, findAvailableDmcCode } from '../mapping/utils.js';
import { getColorCounts } from '../core/gridUtils.js';
import { renderPalette, renderThreadsTable, updatePatternSizeDisplay, setMappingControlsEnabled, updateCropToolState } from './ui-setup.js';
import { applyAntiNoise } from '../mapping/mappingEngine.js';
import { rgbToLab } from '../mapping/palette.js';
import { buildStampedRgbGrid } from './mapping.js';

export function loadOxsPattern(parsed) {
    const { width, height, dmcGrid, rgbGrid, dmcPalette, backstitchLines = [], referenceImageData = null } = parsed;

    isOxsLoaded = true;
    loadedOxsPalette = dmcPalette;
    currentImage = null;
    referenceImage = null;
    overlayImage = null;
    hasBackstitchEdits = false;

    resetUIControls();
    updateCropToolState();

    state.clear();
    userEditDiff.clear();
    lastBaselineGrid = null;
    lastBaselineDmcGrid = null;

    oxsBaselineDmcGrid = dmcGrid.map(row => row.map(c => c));
    oxsBaselineRgbGrid = rgbGrid.map(row => row.map(c => [...c]));
    oxsBaselinePalette = {};
    Object.entries(dmcPalette).forEach(([code, entry]) => {
        oxsBaselinePalette[code] = { name: entry.name, rgb: [...entry.rgb] };
    });

    state.originalImageURL = null;

    sendToCanvas('INIT', { width, height });

    state.mappedDmcGrid = dmcGrid;
    state.mappedRgbGrid = rgbGrid;

    sendToCanvas('UPDATE_GRID', rgbGrid);

    if (backstitchLines.length > 0) {
        sendToCanvas('LOAD_BACKSTITCH', backstitchLines);
    }

    sendToCanvas('TOGGLE_REFERENCE', false);

    if (referenceImageData) {
        const img = new Image();
        img.onload = () => {
            overlayImage = referenceImageData;

            sendToCanvas('SET_REFERENCE_IMAGE', {
                imageData: referenceImageData,
                width: img.width,
                height: img.height
            });

            const refOpacity = document.getElementById("referenceOpacity");
            const refOpacityVal = document.getElementById("referenceOpacityVal");
            if (refOpacity) refOpacity.value = 0;
            if (refOpacityVal) refOpacityVal.textContent = "0%";
            sendToCanvas('SET_REFERENCE_OPACITY', 0);
            sendToCanvas('TOGGLE_REFERENCE', true);
        };
        img.src = referenceImageData;
    }

    setMappingControlsEnabled(false, true);

    const usedCodes = Object.keys(dmcPalette);
    renderPalette(usedCodes);

    updateThreadsTableFromGrid();
    updatePatternSizeDisplay();
}

import { currentImage, referenceImage, overlayImage, resetUIControls } from './state.js';
import { lastBaselineGrid, lastBaselineDmcGrid } from './state.js';

export function updatePaletteFromOxs(dmcPalette, rgbGrid) {
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

export function applyOxsPostProcessing(control) {
    if (!isOxsLoaded || !state.mappedDmcGrid || !state.mappedRgbGrid) return;

    const dmcGrid = state.mappedDmcGrid;
    const rgbGrid = state.mappedRgbGrid;
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    switch (control) {
        case 'reduceIsolatedStitches':
            const { removeIsolatedStitches } = await import('../mapping/mappingEngine.js');
            state.mappedDmcGrid = removeIsolatedStitches(dmcGrid, rgbGrid);
            rebuildRgbFromDmc();
            break;

        case 'minOccurrence':
            const minOcc = parseInt(document.getElementById("minOccurrenceInput")?.value || 1, 10);
            const codeToRgb = {};
            Object.entries(loadedOxsPalette).forEach(([code, entry]) => {
                codeToRgb[code] = entry.rgb;
            });
            const { cleanupMinOccurrence } = await import('../mapping/mappingEngine.js');
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

export function applyOxsPostProcessingWithUndo(control, value, prevValue = null) {
    console.log(`applyOxsPostProcessingWithUndo: ${control} = ${value}, prevValue = ${prevValue}`);

    if (!isOxsLoaded) return;

    if (!oxsBaselineDmcGrid || !oxsBaselineRgbGrid) {
        console.log("No baseline to restore");
        return;
    }

    if (control === 'merge' && prevValue !== null && value < prevValue) {
        console.log(`Reducing merge level from ${prevValue} to ${value} - restoring baseline first`);
        state.mappedDmcGrid = oxsBaselineDmcGrid.map(row => row.map(c => c));
        state.mappedRgbGrid = oxsBaselineRgbGrid.map(row => row.map(c => [...c]));
        loadedOxsPalette = {};
        Object.entries(oxsBaselinePalette).forEach(([code, entry]) => {
            loadedOxsPalette[code] = { name: entry.name, rgb: [...entry.rgb] };
        });
        sendToCanvas('UPDATE_GRID', state.mappedRgbGrid);
    }

    if (value === 0 || value === false) {
        console.log("Restoring from baseline");
        state.mappedDmcGrid = oxsBaselineDmcGrid.map(row => row.map(c => c));
        state.mappedRgbGrid = oxsBaselineRgbGrid.map(row => row.map(c => [...c]));

        loadedOxsPalette = {};
        Object.entries(oxsBaselinePalette).forEach(([code, entry]) => {
            loadedOxsPalette[code] = { name: entry.name, rgb: [...entry.rgb] };
        });

        if (userEditDiff.size > 0) {
            state.mappedDmcGrid = patchDmcGrid(state.mappedDmcGrid, userEditDiff, 'cie76');
            rebuildRgbFromDmc();
            sendToCanvas('SET_DMC_GRID', state.mappedDmcGrid);
        }

        sendToCanvas('UPDATE_GRID', state.mappedRgbGrid);
        updateThreadsTableFromGrid();

        const usedCodes = Object.keys(loadedOxsPalette);
        renderPalette(usedCodes);
        return;
    }

    console.log(`Applying ${control} with value ${value}`);
    applyOxsPostProcessing(control);

    if (userEditDiff.size > 0) {
        state.mappedDmcGrid = patchDmcGrid(state.mappedDmcGrid, userEditDiff, 'cie76');
        rebuildRgbFromDmc();
        sendToCanvas('SET_DMC_GRID', state.mappedDmcGrid);
        updateCropToolState();
    }
}

export function rebuildRgbFromDmc() {
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

export function updateSidebarFromOxsGrid(rgbGrid) {
    console.log("updateSidebarFromOxsGrid called");
    if (!rgbGrid || !loadedOxsPalette) return;

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

            if (matchedCode && bestDist < DISTANCE_THRESHOLD) {
                counts[matchedCode] = (counts[matchedCode] || 0) + 1;
                usedCodes.add(matchedCode);
            } else {
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

export function findAvailableDmcCode(rgb) {
    const code = findNearestDmcCode(rgb, DMC_RGB);
    return code || "310";
}

export function getLiveDmcGridFromRgb(rgbGrid) {
    if (!rgbGrid) return null;

    const h = rgbGrid.length;
    const w = rgbGrid[0].length;
    const dmcGrid = Array.from({ length: h }, () => Array(w).fill("0"));

    let paletteArray;
    if (loadedOxsPalette) {
        paletteArray = Object.entries(loadedOxsPalette).map(([code, entry]) => [code, entry.name, entry.rgb]);
    } else {
        paletteArray = DMC_RGB;
    }
    console.log('[getLiveDmcGridFromRgb] Using palette:', loadedOxsPalette ? 'loadedOxsPalette' : 'DMC_RGB');

    let skippedWhite = 0;
    let skippedSentinel = 0;
    let mappedCount = 0;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const rgb = rgbGrid[y][x];
            const isWhite = rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255;
            const isClothSentinel = rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254;
            if (isWhite) { skippedWhite++; continue; }
            if (isClothSentinel) { skippedSentinel++; continue; }

            const matchedCode = findNearestDmcCode(rgb, paletteArray);
            if (matchedCode) {
                dmcGrid[y][x] = matchedCode;
                mappedCount++;
            }
        }
    }

    console.log('[getLiveDmcGridFromRgb] Skipped white:', skippedWhite, ', skipped sentinel:', skippedSentinel, ', mapped:', mappedCount);
    return dmcGrid;
}

export function applyAntiNoiseToOxsGrid() {
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

export function applyMergeToOxsGrid() {
    if (!state.mappedDmcGrid || !loadedOxsPalette) return;

    const codes = Object.keys(loadedOxsPalette);
    const paletteRgb = codes.map(code => loadedOxsPalette[code].rgb);

    const threshold = mappingConfig.mergeNearest * 2;
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

export function updatePaletteAfterPostProcess() {
    if (!loadedOxsPalette || !state.mappedRgbGrid) return;
    updatePaletteFromOxs(loadedOxsPalette, state.mappedRgbGrid);
}

export function updateThreadsTableFromGrid() {
    if (!state.mappedDmcGrid) return;

    const counts = getColorCounts(state.mappedDmcGrid);

    const threadStats = Array.from(counts.entries()).map(([code, count]) => {
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

    renderThreadsTable(threadStats);
}