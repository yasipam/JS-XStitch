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
// mapping/mappingEngine.js
// -----------------------------------------------------------------------------
// DMC mapping engine (Optimized version)
// -----------------------------------------------------------------------------

import { DMC_RGB } from "./constants.js";
import { adjustBSCBias, getDistanceFn, rgbToLab } from "./palette.js";

/**
 * Finds the nearest DMC thread color for a given RGB pixel.
 * Optimization: Now expects pre-calculated Lab values to avoid redundant conversion.
 */
export function nearestDmcColor(pixelRgb, distanceFn, dmcPaletteLab, allowedPalette) {
    let best = null;
    let bestDist = Infinity;

    const isLabMetric = distanceFn && distanceFn.name && distanceFn.name.includes("distCIE");
    const target = isLabMetric ? rgbToLab(pixelRgb) : pixelRgb;

    for (let i = 0; i < allowedPalette.length; i++) {
        const [code, name, dmcRgb] = allowedPalette[i];
        
        // Use the pre-computed Lab value if available, otherwise fallback to RGB
        const center = (isLabMetric && dmcPaletteLab) ? dmcPaletteLab[i] : dmcRgb;
        
        const dist = distanceFn([target], center)[0];

        if (dist < bestDist) {
            bestDist = dist;
            best = [code, name, dmcRgb];
        }
    }
    return best;
}

export function applyAntiNoise(imageData, strength) {
    if (strength <= 0) return imageData;
    let data = imageData;
    for (let pass = 0; pass < strength; pass++) {
        data = medianFilter3x3(data);
    }
    return data;
}

function medianFilter3x3(imageData) {
    const { width, height, data } = imageData;
    const out = new Uint8ClampedArray(data.length);
    const threshold = 90; 

    function getPixel(x, y) {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const [r, g, b, a] = getPixel(x, y);

            if (a < 128) {
                out.set([r, g, b, a], i);
                continue;
            }

            const rValues = [], gValues = [], bValues = [];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                        const p = getPixel(nx, ny);
                        if (p[3] >= 128) {
                            rValues.push(p[0]); gValues.push(p[1]); bValues.push(p[2]);
                        }
                    }
                }
            }

            const medR = rValues.sort((a, b) => a - b)[Math.floor(rValues.length / 2)];
            const medG = gValues.sort((a, b) => a - b)[Math.floor(gValues.length / 2)];
            const medB = bValues.sort((a, b) => a - b)[Math.floor(bValues.length / 2)];

            const diff = Math.abs(r - medR) + Math.abs(g - medG) + Math.abs(b - medB);
            
            if (diff > threshold) {
                out.set([medR, medG, medB, 255], i);
            } else {
                out.set([r, g, b, 255], i);
            }
        }
    }
    return new ImageData(out, width, height);
}

export function removeIsolatedStitches(dmcGrid, rgbGrid, minSame = 1, rareThreshold = 3) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const cleaned = dmcGrid.map(row => row.slice());

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
            if (center === "0") continue;

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

            if (new Set(neighbours).size >= 5) continue;

            const same = neighbours.filter(n => n === center).length;
            if (same >= minSame) continue;

            const isRare = (globalFreq[center] || 0) <= rareThreshold;
            if (!isRare && same > 0) continue;

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

export function cleanupMinOccurrence(dmcGrid, minOccurrence, codeToRgb) {
    if (minOccurrence <= 0) return dmcGrid;
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

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
                const d = (orig[0] - rgb[0]) ** 2 + (orig[1] - rgb[1]) ** 2 + (orig[2] - rgb[2]) ** 2;
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

    if (antiNoisePasses > 0) {
        const rawData = ctx.getImageData(0, 0, newW, newH);
        const smoothedData = applyAntiNoise(rawData, antiNoisePasses);
        ctx.putImageData(smoothedData, 0, 0);
    }
    
    const finalSourceData = ctx.getImageData(0, 0, newW, newH);
    const rgbFlat = [];
    const maskFlat = [];
    for (let i = 0; i < finalSourceData.data.length; i += 4) {
        rgbFlat.push([finalSourceData.data[i], finalSourceData.data[i+1], finalSourceData.data[i+2]]);
        maskFlat.push(finalSourceData.data[i+3] < 128);
    }

    const adjustedFlat = adjustBSCBias(
        rgbFlat, brightness, saturation, contrast, 
        biasGreenMagenta, biasCyanRed, biasBlueYellow
    );

    const metric = distanceMetric || "euclidean"; 
    const useLab = metric.startsWith("cie"); 
    const distFn = getDistanceFn(metric, useLab);
    
    // CACHE Lab values for the specific palette used in this map
    const dmcPaletteLab = useLab ? palette.map(d => rgbToLab(d[2])) : null;

    let dmcGrid = [];
    const codeToRgb = {};
    DMC_RGB.forEach(([code, , rgb]) => { codeToRgb[String(code)] = rgb; });
    codeToRgb["0"] = [255, 255, 255];

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

    if (doCleanupIsolated) {
        const tempRgb = dmcGrid.map(row => row.map(c => codeToRgb[c]));
        dmcGrid = removeIsolatedStitches(dmcGrid, tempRgb);
    }

    if (minOccurrence > 1) {
        dmcGrid = cleanupMinOccurrence(dmcGrid, minOccurrence, codeToRgb);
    }

    const finalRgbGrid = dmcGrid.map(row => row.map(code => codeToRgb[String(code)]));
    return [finalRgbGrid, dmcGrid];
}