// parent/mapping.js
// -----------------------------------------------------------------------------
// Image mapping logic - color mapping, filtering, DMC grid generation
// -----------------------------------------------------------------------------

import { getDmcLabCache, dmcCodeToRgb, codeToRgbMap, dmcCodeToEntry } from './constants.js';
import { state, mappingConfig, cachedProjectPalette, lastPaletteConfig, userEditDiff, lastBaselineGrid, lastBaselineDmcGrid } from './state.js';
import { sendToCanvas } from './canvas.js';
import { buildStampedGrid } from '../mapping/stamped.js';
import { removeIsolatedStitches, cleanupMinOccurrence, applyAntiNoise } from '../mapping/mappingEngine.js';
import { DMC_RGB } from '../mapping/constants.js';
import { findNearestDmcCode } from '../mapping/utils.js';
import { nearestDmcColor, getDistanceFn, rgbToLab } from '../mapping/palette.js';

export function patchDmcGrid(baselineDmcGrid, edits, distanceMethod) {
    const useLab = distanceMethod.startsWith("cie");
    const distFn = getDistanceFn(distanceMethod, useLab);
    const labCache = getDmcLabCache(useLab);

    const liveDmcGrid = baselineDmcGrid.map(row => row.map(c => String(c)));

    for (const [key, rgb] of edits) {
        const [x, y] = key.split(',').map(Number);
        if (liveDmcGrid[y] && liveDmcGrid[y][x] !== undefined) {
            const isWhite = rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255;
            const isClothSentinel = rgb[0] === 254 && rgb[1] === 254 && rgb[2] === 254;
            if (isWhite || isClothSentinel) {
                liveDmcGrid[y][x] = "0";
            } else {
                const match = nearestDmcColor(rgb, distFn, labCache, DMC_RGB);
                liveDmcGrid[y][x] = match ? String(match[0]) : "0";
            }
        }
    }
    return liveDmcGrid;
}

export function buildStampedRgbGrid(dmcGrid) {
    if (!mappingConfig.stampedMode) return null;
    return buildStampedGrid(dmcGrid, { hueShift: mappingConfig.stampedHue }).grid;
}

// -----------------------------------------------------------------------------
// TWO-STAGE MAX COLOURS ENFORCEMENT
// Ensures maxColours limit is always honored, even after post-processing
// -----------------------------------------------------------------------------
export function enforceMaxColors(dmcGrid, maxColours) {
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
        keptRgbMap[code] = codeToRgb.get(code) || [128, 128, 128];
    }

    const result = dmcGrid.map(row => row.slice());
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(result[y][x]);
            if (!keepColors.has(code)) {
                const origRgb = codeToRgb.get(code) || [128, 128, 128];
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

export function applyFilteringToGrid(dmcGrid, userEdits = null) {
    let filtered = dmcGrid;

    if (mappingConfig.reduceIsolatedStitches) {
        const rgbGrid = dmcGrid.map(row => row.map(c => codeToRgbMap[c] || [0, 0, 0]));
        filtered = removeIsolatedStitches(dmcGrid, rgbGrid);
    }

    if (mappingConfig.minOccurrence > 1) {
        console.log('[ApplyFiltering] minOccurrence:', mappingConfig.minOccurrence);
        filtered = cleanupMinOccurrence(filtered, mappingConfig.minOccurrence, codeToRgbMap, userEdits);
    }

    return filtered;
}

export function reapplyFiltering() {
    if (!state.mappedDmcGrid) return;

    let filteredDmcGrid = applyFilteringToGrid(state.mappedDmcGrid, userEditDiff);
    filteredDmcGrid = enforceMaxColors(filteredDmcGrid, mappingConfig.maxColours);
    const filteredRgbGrid = filteredDmcGrid.map(row => row.map(c => dmcCodeToRgb.get(String(c)) || [255, 255, 255]));

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

// Need to import updateSidebarFromState - will be in ui-render.js
import { updateSidebarFromState } from './ui-render.js';

export { updateSidebarFromState };

export function captureUserEdits(liveGrid) {
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
                userEditDiff.delete(key);
            }
        }
    }
}

export function applyUserEditsToBaseline(baselineGrid) {
    if (userEditDiff.size === 0) return baselineGrid;

    const merged = baselineGrid.map(row => row.map(px => [...px]));
    for (const [key, rgb] of userEditDiff) {
        const [x, y] = key.split(',').map(Number);
        if (merged[y] && merged[y][x]) {
            merged[y][x] = [...rgb];
        }
    }
    return merged;
}

export function getRgbFromCode(code) {
    return dmcCodeToRgb.get(String(code)) || [255, 255, 255];
}

// -----------------------------------------------------------------------------
// CORE PIPELINE: IMAGE -> GRID
// -----------------------------------------------------------------------------

export async function runMapping(isReset = false) {
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
            lastPaletteConfig.mergeNearest !== mappingConfig.mergeNearest;

        if (needsNewPalette) {
            const extractedColors = buildPaletteFromImage(currentImage, maxColours);

            if (mappingConfig.mergeNearest > 0) {
                const threshold = mappingConfig.mergeNearest * 2;
                const merged = mergeSimilarPaletteColors(
                    extractedColors,
                    threshold,
                    []
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
        const { mapFullWithPalette } = await import('../mapping/mappingEngine.js');
        const [rgbGrid, dmcGrid] = await mapFullWithPalette(
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

        liveDmcGrid = enforceMaxColors(liveDmcGrid, maxColours);

        let changed = true;
        let iterations = 0;
        const maxIterations = 10;
        while (changed && iterations < maxIterations) {
            const filtered = applyFilteringToGrid(liveDmcGrid, userEditDiff);
            changed = filtered !== liveDmcGrid;
            if (changed) {
                liveDmcGrid = filtered;
                liveDmcGrid = enforceMaxColors(liveDmcGrid, maxColours);
            }
            iterations++;
        }
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
            sendToCanvas('INIT', { width: newWidth, height: newHeight, dmcGrid: liveDmcGrid });
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

// Need to import mergeSimilarPaletteColors - it's in palette.js
import { mergeSimilarPaletteColors } from '../mapping/palette.js';