// mapping/mappingEngine.js
// -----------------------------------------------------------------------------
// DMC mapping engine (JS conversion of mapping.py)
// -----------------------------------------------------------------------------
//
// Provides:
// - Nearest‑DMC lookup
// - Anti‑noise median filtering
// - Isolated‑stitch cleanup
// - Minimum‑occurrence cleanup
// - Full mapping pipeline (palette → DMC grid)
// -----------------------------------------------------------------------------

import { DMC_RGB } from "./constants.js";
import { adjustBSCBias } from "./palette.js";

/**
 * Finds the nearest DMC thread color for a given RGB pixel.
 */
export function nearestDmcColor([r, g, b]) {
    let best = null;
    let bestDist = Infinity;
    for (const [code, name, [dr, dg, db]] of DMC_RGB) {
        const d = (r - dr) ** 2 + (g - dg) ** 2 + (b - db) ** 2;
        if (d < bestDist) {
            bestDist = d;
            best = [code, name, [dr, dg, db]];
        }
    }
    return best;
}

// -----------------------------------------------------------------------------
// ANTI‑NOISE (MEDIAN FILTER)
// -----------------------------------------------------------------------------
// JS has no PIL, so we use Canvas-based median filtering.
// This is a direct functional equivalent, not a new feature.
export function applyAntiNoise(imageData, strength) {
    if (strength <= 0) return imageData;

    let data = imageData;

    for (let pass = 0; pass < strength; pass++) {
        data = medianFilter3x3(data);
    }

    return data;
}

// Simple 3×3 median filter for RGB
function medianFilter3x3(imageData) {
    const { width, height, data } = imageData;
    const out = new Uint8ClampedArray(data.length);

    function getPixel(x, y) {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
    }

    function setPixel(x, y, [r, g, b]) {
        const i = (y * width + x) * 4;
        out[i] = r;
        out[i + 1] = g;
        out[i + 2] = b;
        out[i + 3] = 255;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const neighbours = [];

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        neighbours.push(getPixel(nx, ny));
                    }
                }
            }

            const r = neighbours.map(p => p[0]).sort((a, b) => a - b)[Math.floor(neighbours.length / 2)];
            const g = neighbours.map(p => p[1]).sort((a, b) => a - b)[Math.floor(neighbours.length / 2)];
            const b = neighbours.map(p => p[2]).sort((a, b) => a - b)[Math.floor(neighbours.length / 2)];

            setPixel(x, y, [r, g, b]);
        }
    }

    return new ImageData(out, width, height);
}

// -----------------------------------------------------------------------------
// REMOVE ISOLATED STITCHES
// -----------------------------------------------------------------------------
export function removeIsolatedStitches(dmcGrid, rgbGrid, minSame = 1, rareThreshold = 3) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const cleaned = dmcGrid.map(row => row.slice());

    // Count global occurrences
    const globalFreq = {};
    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            const code = String(dmcGrid[i][j]);
            globalFreq[code] = (globalFreq[code] || 0) + 1;
        }
    }

    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            const center = String(dmcGrid[i][j]);

            // Never modify cloth
            if (center === "0") continue;

            // Gather neighbours
            const neighbours = [];
            for (let di = -1; di <= 1; di++) {
                for (let dj = -1; dj <= 1; dj++) {
                    if (di === 0 && dj === 0) continue;
                    const ni = i + di;
                    const nj = j + dj;
                    if (ni >= 0 && ni < h && nj >= 0 && nj < w) {
                        neighbours.push(String(dmcGrid[ni][nj]));
                    }
                }
            }

            // Edge‑aware protection
            if (new Set(neighbours).size >= 5) continue;

            // Count matching neighbours
            const same = neighbours.filter(n => n === center).length;
            if (same >= minSame) continue;

            // Rare colour handling
            const isRare = (globalFreq[center] || 0) <= rareThreshold;
            if (!isRare && same > 0) continue;

            // Replace with most common neighbour
            const freq = {};
            for (const n of neighbours) {
                if (n === "0") continue;
                freq[n] = (freq[n] || 0) + 1;
            }

            if (Object.keys(freq).length > 0) {
                const bestColour = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
                cleaned[i][j] = bestColour;
            }
        }
    }

    return cleaned;
}

// -----------------------------------------------------------------------------
// CLEANUP: MINIMUM OCCURRENCE
// -----------------------------------------------------------------------------
export function cleanupMinOccurrence(dmcGrid, minOccurrence, codeToRgb) {
    if (minOccurrence <= 0) return dmcGrid;

    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    // Count occurrences
    const countMap = {};
    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            const code = dmcGrid[i][j];
            countMap[code] = (countMap[code] || 0) + 1;
        }
    }

    const toRemove = new Set(
        Object.entries(countMap)
            .filter(([code, count]) => count < minOccurrence)
            .map(([code]) => code)
    );

    if (toRemove.size === 0) return dmcGrid;

    const remaining = Object.keys(countMap).filter(code => !toRemove.has(code));
    if (remaining.length === 0) return dmcGrid;

    const remainingRGBs = remaining.map(code => codeToRgb[code]);

    const newGrid = dmcGrid.map(row => row.slice());

    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            const code = dmcGrid[i][j];
            if (!toRemove.has(code)) continue;

            const orig = codeToRgb[code];
            let best = null;
            let bestDist = Infinity;

            for (let k = 0; k < remaining.length; k++) {
                const rgb = remainingRGBs[k];
                const d =
                    (orig[0] - rgb[0]) ** 2 +
                    (orig[1] - rgb[1]) ** 2 +
                    (orig[2] - rgb[2]) ** 2;

                if (d < bestDist) {
                    bestDist = d;
                    best = remaining[k];
                }
            }

            newGrid[i][j] = best;
        }
    }

    return newGrid;
}

// -----------------------------------------------------------------------------
// FULL MAPPING PIPELINE
// -----------------------------------------------------------------------------
export function mapFullWithPalette(
    image,
    stitchWidth,
    palette,
    brightness,
    saturation,
    contrast,
    doCleanupIsolated,
    minOccurrence,
    biasGreenMagenta, // Match app.js exactly
    biasCyanRed,      // Match app.js exactly
    biasBlueYellow    // Match app.js exactly
) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    
    const scale = stitchWidth / image.width;
    const newW = stitchWidth;
    const newH = Math.max(1, Math.floor(image.height * scale));
    canvas.width = newW;
    canvas.height = newH;
    
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, newW, newH);
    const smallData = ctx.getImageData(0, 0, newW, newH);

    const rgbFlat = [];
    const maskFlat = [];
    for (let i = 0; i < smallData.data.length; i += 4) {
        rgbFlat.push([smallData.data[i], smallData.data[i+1], smallData.data[i+2]]);
        maskFlat.push(smallData.data[i+3] < 128);
    }

    // Apply adjustments with scaled-down bias to prevent color collapse
    const adjustedFlat = adjustBSCBias(
        rgbFlat, 
        brightness, 
        saturation, 
        contrast, 
        (biasGreenMagenta || 0) / 10, 
        (biasCyanRed || 0) / 10, 
        (biasBlueYellow || 0) / 10
    );

    const dmcGrid = [];
    const finalRgbGrid = [];
    const codeToRgb = {};
    DMC_RGB.forEach(([code, , rgb]) => { codeToRgb[String(code)] = rgb; });
    codeToRgb["0"] = [255, 255, 255];

    for (let y = 0; y < newH; y++) {
        const dmcRow = [];
        const rgbRow = [];
        for (let x = 0; x < newW; x++) {
            const idx = y * newW + x;
            if (maskFlat[idx]) {
                dmcRow.push("0");
                rgbRow.push([255, 255, 255]);
            } else {
                const [code, , dmcRgb] = nearestDmcColor(adjustedFlat[idx]);
                dmcRow.push(String(code));
                rgbRow.push(dmcRgb);
            }
        }
        dmcGrid.push(dmcRow);
        finalRgbGrid.push(rgbRow);
    }

    return [finalRgbGrid, dmcGrid];
}