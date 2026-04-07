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
import { adjustBSCBias, getDistanceFn, rgbToLab } from "./palette.js";

/**
 * Finds the nearest DMC thread color for a given RGB pixel.
 */
export function nearestDmcColor(pixelRgb, distanceFn, dmcPaletteLab, allowedPalette) {
    let best = null;
    let bestDist = Infinity;

    const isLabMetric = distanceFn && distanceFn.name && distanceFn.name.includes("CIE");
    const target = isLabMetric ? rgbToLab([pixelRgb])[0] : pixelRgb;

    // Use the distance function to get a batch of distances for all colors in the palette
    // This is much faster and ensures the selected metric is actually used
    const distances = distanceFn([target], isLabMetric ? dmcPaletteLab : allowedPalette.map(p => p[2]));

    // Find the index of the smallest distance
    // Note: distanceFn returns an array of distances for each 'center' provided
    // but our distanceFn logic in palette.js is designed for: dist(pixels, single_center)
    // So we must loop the palette and call the function correctly:
    
    for (let i = 0; i < allowedPalette.length; i++) {
        const [code, name, dmcRgb] = allowedPalette[i];
        const center = isLabMetric ? dmcPaletteLab[i] : dmcRgb;
        
        // Correct usage: distanceFn([pixel], center) returns [distance]
        const dist = distanceFn([target], center)[0];

        if (dist < bestDist) {
            bestDist = dist;
            best = [code, name, dmcRgb];
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
        // Return R, G, B, and A
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const centerPixel = getPixel(x, y);

            // If the pixel is fully transparent, preserve it and skip smoothing
            if (centerPixel[3] < 128) {
                out[i] = centerPixel[0];
                out[i + 1] = centerPixel[1];
                out[i + 2] = centerPixel[2];
                out[i + 3] = centerPixel[3];
                continue;
            }

            const rValues = [];
            const gValues = [];
            const bValues = [];

            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const p = getPixel(nx, ny);
                        // Only include non-transparent neighbors in the smoothing math
                        if (p[3] >= 128) {
                            rValues.push(p[0]);
                            gValues.push(p[1]);
                            bValues.push(p[2]);
                        }
                    }
                }
            }

            // Fallback to center pixel if no solid neighbors found
            out[i] = rValues.length > 0 ? rValues.sort((a, b) => a - b)[Math.floor(rValues.length / 2)] : centerPixel[0];
            out[i + 1] = gValues.length > 0 ? gValues.sort((a, b) => a - b)[Math.floor(gValues.length / 2)] : centerPixel[1];
            out[i + 2] = bValues.length > 0 ? bValues.sort((a, b) => a - b)[Math.floor(bValues.length / 2)] : centerPixel[2];
            out[i + 3] = 255; // Keep the smoothed pixel solid
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
    biasGreenMagenta,
    biasCyanRed,
    biasBlueYellow,
    distanceMetric,
    antiNoisePasses
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

    // 1. Anti-Noise Smoothing
    // We must grab the data AFTER smoothing it on the canvas
    if (antiNoisePasses > 0) {
        const rawData = ctx.getImageData(0, 0, newW, newH);
        const smoothedData = applyAntiNoise(rawData, antiNoisePasses);
        ctx.putImageData(smoothedData, 0, 0);
    }
    
    // Grab the final source data (smoothed or original)
    const finalSourceData = ctx.getImageData(0, 0, newW, newH);

    const rgbFlat = [];
    const maskFlat = [];
    for (let i = 0; i < finalSourceData.data.length; i += 4) {
        rgbFlat.push([finalSourceData.data[i], finalSourceData.data[i+1], finalSourceData.data[i+2]]);
        maskFlat.push(finalSourceData.data[i+3] < 128);
    }

    const adjustedFlat = adjustBSCBias(
        rgbFlat, brightness, saturation, contrast, 
        (biasGreenMagenta || 0) / 10, (biasCyanRed || 0) / 10, (biasBlueYellow || 0) / 10
    );

    const metric = distanceMetric || "euclidean"; 
    const useLab = metric.startsWith("cie"); 
    const distFn = getDistanceFn(metric, useLab);
    const dmcPaletteLab = useLab ? DMC_RGB.map(d => rgbToLab([d[2]])[0]) : null;

    let dmcGrid = [];
    const codeToRgb = {};
    DMC_RGB.forEach(([code, , rgb]) => { codeToRgb[String(code)] = rgb; });
    codeToRgb["0"] = [255, 255, 255];

    // Initial Mapping Pass
    for (let y = 0; y < newH; y++) {
        const dmcRow = [];
        for (let x = 0; x < newW; x++) {
            const idx = y * newW + x;
            if (maskFlat[idx]) {
                dmcRow.push("0");
            } else {
                const [code] = nearestDmcColor(adjustedFlat[idx], distFn, dmcPaletteLab, palette);
                dmcRow.push(String(code));
            }
        }
        dmcGrid.push(dmcRow);
    }

    // 2. Reduce Isolated Stitches
    // We use a temporary RGB grid just for the calculation
    if (doCleanupIsolated) {
        const tempRgb = dmcGrid.map(row => row.map(c => codeToRgb[c]));
        dmcGrid = removeIsolatedStitches(dmcGrid, tempRgb);
    }

    // 3. Cleanup Rare Colors
    if (minOccurrence > 1) {
        dmcGrid = cleanupMinOccurrence(dmcGrid, minOccurrence, codeToRgb);
    }

    // FINAL SYNC: Rebuild the RGB grid so the canvas actually shows the cleaned version
    const finalRgbGrid = dmcGrid.map(row => 
        row.map(code => codeToRgb[String(code)])
    );

    // RETURN THE CLEANED DATA
    return [finalRgbGrid, dmcGrid];
}