// mapping/palette.js
// -----------------------------------------------------------------------------
// Colour‑space utilities: RGB → XYZ → LAB
// Pure, dependency‑free implementations.
// -----------------------------------------------------------------------------

// Convert sRGB (0–255) to linear RGB (0–1)
function srgbToLinear(v) {
    v = v / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

// Convert linear RGB → XYZ
function rgbToXyz([r, g, b]) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);

    // sRGB → XYZ (D65)
    return [
        R * 0.4124 + G * 0.3576 + B * 0.1805,
        R * 0.2126 + G * 0.7152 + B * 0.0722,
        R * 0.0193 + G * 0.1192 + B * 0.9505,
    ];
}

// Helper for XYZ → LAB
function f(t) {
    const eps = 216 / 24389;
    const kappa = 24389 / 27;
    return t > eps ? Math.cbrt(t) : (kappa * t + 16) / 116;
}

// Convert XYZ → LAB
function xyzToLab([x, y, z]) {
    // Reference white (D65)
    const Xn = 0.95047;
    const Yn = 1.00000;
    const Zn = 1.08883;

    const fx = f(x / Xn);
    const fy = f(y / Yn);
    const fz = f(z / Zn);

    const L = 116 * fy - 16;
    const a = 500 * (fx - fy);
    const b = 200 * (fy - fz);

    return [L, a, b];
}

// Public: Convert RGB array → LAB array
// Accepts either a single pixel [r,g,b] or an array of pixels.
// mapping/palette.js

export function rgbToLab(input) {
    // If input is a single pixel [r, g, b] (length 3, and first element is a number)
    if (typeof input[0] === 'number') {
        return xyzToLab(rgbToXyz(input));
    }
    // If input is an array of pixels [[r,g,b], ...]
    return input.map(rgb => xyzToLab(rgbToXyz(rgb)));
}

export function buildPaletteFromImage(image, k) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const sampleWidth = 100;
    const scale = sampleWidth / image.width;
    canvas.width = sampleWidth;
    canvas.height = Math.max(1, Math.floor(image.height * scale));
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const pixels = [];
    for (let i = 0; i < imgData.length; i += 4) {
        if (imgData[i + 3] > 128)
            pixels.push([imgData[i], imgData[i + 1], imgData[i + 2]]);
    }

    // Create seeded random from pixel data for deterministic results
    let seed = 12345;
    for (let i = 0; i < Math.min(pixels.length, 1000); i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    }
    function seededRandom() {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x7fffffff;
    }

    if (pixels.length === 0) return [[255, 255, 255]];

    console.log(`[K-Means] Starting with ${pixels.length} pixels, k=${k}`);

    // K-means++ initialization
    function kMeansPlusPlus(pixels, k) {
        const centroids = [];
        // First centroid: seeded random pixel
        const firstIdx = Math.floor(seededRandom() * pixels.length);
        centroids.push([...pixels[firstIdx]]);

        // Remaining centroids: weighted by distance squared
        while (centroids.length < k) {
            const distances = pixels.map(p => {
                let minDist = Infinity;
                for (const c of centroids) {
                    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
                    if (d < minDist) minDist = d;
                }
                return minDist;
            });

            const totalDist = distances.reduce((a, b) => a + b, 0);
            let r = seededRandom() * totalDist;
            for (let i = 0; i < distances.length; i++) {
                r -= distances[i];
                if (r <= 0) {
                    centroids.push([...pixels[i]]);
                    break;
                }
            }
            // Fallback if rounding error
            if (centroids.length < k) {
                const lastIdx = Math.floor(seededRandom() * pixels.length);
                centroids.push([...pixels[lastIdx]]);
            }
        }

        return centroids;
    }

    // K-means clustering
    function kMeans(pixels, k, maxIterations = 15) {
        let centroids = kMeansPlusPlus(pixels, k);
        console.log(`[K-Means] Initialized ${centroids.length} centroids`);

        for (let iter = 0; iter < maxIterations; iter++) {
            // Assign pixels to nearest centroid
            const clusters = Array.from({ length: k }, () => []);

            for (const p of pixels) {
                let minDist = Infinity;
                let closest = 0;
                for (let i = 0; i < centroids.length; i++) {
                    const d = (p[0] - centroids[i][0]) ** 2 +
                            (p[1] - centroids[i][1]) ** 2 +
                            (p[2] - centroids[i][2]) ** 2;
                    if (d < minDist) {
                        minDist = d;
                        closest = i;
                    }
                }
                clusters[closest].push(p);
            }

            // Update centroids
            let moved = 0;
            for (let i = 0; i < k; i++) {
                if (clusters[i].length === 0) continue;

                const newCentroid = [0, 0, 0];
                for (const p of clusters[i]) {
                    newCentroid[0] += p[0];
                    newCentroid[1] += p[1];
                    newCentroid[2] += p[2];
                }
                newCentroid[0] = Math.round(newCentroid[0] / clusters[i].length);
                newCentroid[1] = Math.round(newCentroid[1] / clusters[i].length);
                newCentroid[2] = Math.round(newCentroid[2] / clusters[i].length);

                moved += (centroids[i][0] - newCentroid[0]) ** 2 +
                         (centroids[i][1] - newCentroid[1]) ** 2 +
                         (centroids[i][2] - newCentroid[2]) ** 2;
                centroids[i] = newCentroid;
            }

            console.log(`[K-Means] Iteration ${iter + 1}, movement=${Math.sqrt(moved).toFixed(2)}`);
        }

        return centroids;
    }

    const raw = kMeans(pixels, k);

    // Deduplicate
    const seen = new Set();
    const unique = raw.filter(c => {
        const key = c.join(',');
        if (seen.has(key)) return false;
        seen.add(key); return true;
    });

    console.log(`[K-Means] Finished with ${unique.length} unique colors`);

    // Pad with nearest color if needed (rare case)
    while (unique.length < k) {
        unique.push([...unique[unique.length - 1] || [255, 255, 255]]);
    }

    return unique.slice(0, k);
}

// -----------------------------------------------------------------------------
// COLOUR DISTANCE METRICS
// -----------------------------------------------------------------------------
// These functions operate on *single pixels* or *arrays of pixels*.
// Input format: [r,g,b] or [L,a,b] depending on metric.
// -----------------------------------------------------------------------------

// Utility: squared Euclidean distance
function sqr(x) {
    return x * x;
}

// -----------------------------------------------------------------------------
// 1. Euclidean RGB distance
// -----------------------------------------------------------------------------
export function distEuclidean(pixels, center) {
    // pixels: array of [r,g,b]
    // center: [r,g,b]
    return pixels.map(([r, g, b]) => {
        const dr = r - center[0];
        const dg = g - center[1];
        const db = b - center[2];
        return dr * dr + dg * dg + db * db;
    });
}

// -----------------------------------------------------------------------------
// 2. BT.709 weighted RGB distance
// -----------------------------------------------------------------------------
export function distBT709(pixels, center) {
    const wr = 0.2126, wg = 0.7152, wb = 0.0722;

    return pixels.map(([r, g, b]) => {
        const dr = r - center[0];
        const dg = g - center[1];
        const db = b - center[2];
        return wr * dr * dr + wg * dg * dg + wb * db * db;
    });
}

// -----------------------------------------------------------------------------
// 3. CIE76 (with warm‑colour correction)
// -----------------------------------------------------------------------------
export function distCIE76(pixelsLab, centerLab) {
    return pixelsLab.map(([L1, a1, b1]) => {
        const dL = L1 - centerLab[0];
        let da = a1 - centerLab[1];
        let db = b1 - centerLab[2];

        // Apply warmth correction to the difference if the target is "warm"
        if (a1 > 20) {
            da *= 0.65;
            db *= 0.65;
        }

        return dL * dL + da * da + db * db;
    });
}

// -----------------------------------------------------------------------------
// 4. CIE94
// -----------------------------------------------------------------------------
export function distCIE94(pixelsLab, centerLab) {
    const [L2, a2, b2] = centerLab;

    return pixelsLab.map(([L1, a1, b1]) => {
        const dL = L1 - L2;

        const C1 = Math.sqrt(a1 * a1 + b1 * b1);
        const C2 = Math.sqrt(a2 * a2 + b2 * b2);
        const dC = C1 - C2;

        const dA = a1 - a2;
        const dB = b1 - b2;
        let dH2 = dA * dA + dB * dB - dC * dC;
        dH2 = Math.max(dH2, 0);
        const dH = Math.sqrt(dH2);

        const K1 = 0.045;
        const K2 = 0.015;

        const sL = 1;
        const sC = 1 + K1 * C1;
        const sH = 1 + K2 * C1;

        return (
            sqr(dL / sL) +
            sqr(dC / sC) +
            sqr(dH / sH)
        );
    });
}

// -----------------------------------------------------------------------------
// 5. CIEDE2000 (vectorised)
// -----------------------------------------------------------------------------
export function distCIEDE2000(pixelsLab, centerLab) {
    const [L2, a2, b2] = centerLab;

    return pixelsLab.map(([L1, a1, b1]) => {
        const L_bar = (L1 + L2) / 2;

        const C1 = Math.sqrt(a1 * a1 + b1 * b1);
        const C2 = Math.sqrt(a2 * a2 + b2 * b2);
        const C_bar = (C1 + C2) / 2;

        const G = 0.5 * (1 - Math.sqrt((Math.pow(C_bar, 7)) /
            (Math.pow(C_bar, 7) + Math.pow(25, 7) + 1e-8)));

        const a1p = (1 + G) * a1;
        const a2p = (1 + G) * a2;

        const C1p = Math.sqrt(a1p * a1p + b1 * b1);
        const C2p = Math.sqrt(a2p * a2p + b2 * b2);
        const C_bar_p = (C1p + C2p) / 2;

        const h1p = (Math.atan2(b1, a1p) * 180 / Math.PI + 360) % 360;
        const h2p = (Math.atan2(b2, a2p) * 180 / Math.PI + 360) % 360;

        const dLp = L2 - L1;
        const dCp = C2p - C1p;

        let dhp = h2p - h1p;
        if (dhp > 180) dhp -= 360;
        if (dhp < -180) dhp += 360;

        const dHp = 2 * Math.sqrt(C1p * C2p) *
            Math.sin((dhp * Math.PI / 180) / 2);

        let h_bar_p = (h1p + h2p) / 2;
        if (Math.abs(h1p - h2p) > 180) h_bar_p += 180;
        h_bar_p %= 360;

        const T =
            1 -
            0.17 * Math.cos((h_bar_p - 30) * Math.PI / 180) +
            0.24 * Math.cos((2 * h_bar_p) * Math.PI / 180) +
            0.32 * Math.cos((3 * h_bar_p + 6) * Math.PI / 180) -
            0.20 * Math.cos((4 * h_bar_p - 63) * Math.PI / 180);

        const dRo = 30 * Math.exp(-Math.pow((h_bar_p - 275) / 25, 2));
        const Rc = 2 * Math.sqrt(
            Math.pow(C_bar_p, 7) /
            (Math.pow(C_bar_p, 7) + Math.pow(25, 7) + 1e-8)
        );

        const Sl = 1 + (0.015 * Math.pow(L_bar - 50, 2)) /
            Math.sqrt(20 + Math.pow(L_bar - 50, 2));
        const Sc = 1 + 0.045 * C_bar_p;
        const Sh = 1 + 0.015 * C_bar_p * T;

        const Rt = -Math.sin(2 * dRo * Math.PI / 180) * Rc;

        return Math.sqrt(
            sqr(dLp / Sl) +
            sqr(dCp / Sc) +
            sqr(dHp / Sh) +
            Rt * (dCp / Sc) * (dHp / Sh)
        );
    });
}

// -----------------------------------------------------------------------------
// 6. Distance function selector
// -----------------------------------------------------------------------------
// mapping/palette.js

// mapping/palette.js

export function getDistanceFn(metric, useLab) {
    switch (metric) {
        case "cie76":
            return (pixels, center) => distCIE76(pixels, center);
        case "cie94":
            return (pixels, center) => distCIE94(pixels, center);
        case "ciede2000":
            return (pixels, center) => distCIEDE2000(pixels, center);
        case "bt709":
            // Perceptual Euclidean weights for RGB
            return (pixels, center) => distBT709(pixels, center);
        case "euclidean":
        default:
            return (pixels, center) => distEuclidean(pixels, center);
    }
}


// -----------------------------------------------------------------------------
// IMAGE ADJUSTMENTS (BRIGHTNESS / SATURATION / CONTRAST / LAB BIAS)
// -----------------------------------------------------------------------------
// Input: 2D array of pixels OR flat array of [r,g,b] pixels
// Output: same shape, adjusted
// -----------------------------------------------------------------------------

// Helper: clamp 0–255
function clamp(v) {
    return Math.min(255, Math.max(0, v));
}

// mapping/palette.js

export function adjustBSCBias(pixels, brightness=0, saturation=0, contrast=0, bGM=0, bCR=0, bBY=0) {
    return pixels.map(([r, g, b]) => {
        // 1. Levels (brightness: -1 to 1, default 0 = no change)
        let R = r + (r * brightness);
        let G = g + (g * brightness);
        let B = b + (b * brightness);

        // 2. Saturation (saturation: -1 to 1, default 0 = no change)
        const gray = 0.299 * R + 0.587 * G + 0.114 * B;
        R = gray + (R - gray) * (1 + saturation);
        G = gray + (G - gray) * (1 + saturation);
        B = gray + (B - gray) * (1 + saturation);

        // 3. Contrast (contrast: -1 to 1, default 0 = no change)
        R = (R - 128) * (1 + contrast) + 128;
        G = (G - 128) * (1 + contrast) + 128;
        B = (B - 128) * (1 + contrast) + 128;

// Increase the multiplier so that a value of 10 creates a massive shift
        const factor = 8.0; 
        
        // Apply the shifts directly to the channels
        let R_final = R + (bCR * factor) - (bBY * (factor / 2)) + (bGM * (factor / 2));
        let G_final = G - (bGM * factor) - (bCR * (factor / 2)) - (bBY * (factor / 2));
        let B_final = B + (bBY * factor) - (bCR * (factor / 2)) + (bGM * (factor / 2));

        return [
            Math.max(0, Math.min(255, Math.round(R_final))),
            Math.max(0, Math.min(255, Math.round(G_final))),
            Math.max(0, Math.min(255, Math.round(B_final)))
        ];
    });
}

// Restore original 2D shape if needed
function reshape(original, flat) {
    if (!Array.isArray(original[0][0])) return flat;
    const width = original[0].length;
    const out = [];
    for (let i = 0; i < flat.length; i += width) {
        out.push(flat.slice(i, i + width));
    }
    return out;
}

// -----------------------------------------------------------------------------
// LAB → RGB conversion (inverse of rgbToLab)
// Returns RGB in 0–1 range
// -----------------------------------------------------------------------------

function labToXyz([L, a, b]) {
    // Reference white (D65)
    const Xn = 0.95047;
    const Yn = 1.00000;
    const Zn = 1.08883;

    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;

    const eps = 216 / 24389;
    const kappa = 24389 / 27;

    const fx3 = fx * fx * fx;
    const fy3 = fy * fy * fy;
    const fz3 = fz * fz * fz;

    const xr = fx3 > eps ? fx3 : (116 * fx - 16) / kappa;
    const yr = L > (kappa * eps) ? fy3 : L / kappa;
    const zr = fz3 > eps ? fz3 : (116 * fz - 16) / kappa;

    return [
        xr * Xn,
        yr * Yn,
        zr * Zn
    ];
}

function xyzToRgb([x, y, z]) {
    // XYZ → linear RGB
    let r =  3.2406 * x - 1.5372 * y - 0.4986 * z;
    let g = -0.9689 * x + 1.8758 * y + 0.0415 * z;
    let b =  0.0557 * x - 0.2040 * y + 1.0570 * z;

    // Linear → sRGB
    function linearToSrgb(v) {
        return v <= 0.0031308
            ? 12.92 * v
            : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    }

    return [
        linearToSrgb(r),
        linearToSrgb(g),
        linearToSrgb(b)
    ];
}

// Public: LAB → RGB (0–1 range)
export function labToRgb(lab) {
    return xyzToRgb(labToXyz(lab));
}

// -----------------------------------------------------------------------------
// Merge perceptually similar palette colours using CIEDE2000
// -----------------------------------------------------------------------------
import { DMC_RGB } from "./constants.js";

export function mergeSimilarPaletteColors(palette, threshold, lockedCodes) {
    if (threshold <= 0 || palette.length <= 1) return palette;

    const paletteLab = palette.map(p => rgbToLab([p])[0]);
    const paletteRGB = palette.map(p => [...p]);

    // Locked colours
    const lockedRGBs = DMC_RGB
        .filter(([code]) => lockedCodes.includes(code))
        .map(([, , rgb]) => rgb);

    const merged = [];
    const used = new Array(palette.length).fill(false);

    for (let i = 0; i < palette.length; i++) {
        if (used[i]) continue;

        const baseLab = paletteLab[i];
        const baseRGB = paletteRGB[i];

        const group = [i];
        used[i] = true;

        for (let j = i + 1; j < palette.length; j++) {
            if (used[j]) continue;

            const dist = Math.sqrt(
                (baseLab[0] - paletteLab[j][0]) ** 2 +
                (baseLab[1] - paletteLab[j][1]) ** 2 +
                (baseLab[2] - paletteLab[j][2]) ** 2
            );

            if (dist < threshold) {
                const isLocked = lockedRGBs.some(
                    lr => lr[0] === paletteRGB[j][0] &&
                          lr[1] === paletteRGB[j][1] &&
                          lr[2] === paletteRGB[j][2]
                );
                if (isLocked) continue;

                group.push(j);
                used[j] = true;
            }
        }

        if (group.length === 1) {
            merged.push(baseRGB);
        } else {
            const dists = group.map(idx => {
                const d = Math.sqrt(
                    (baseLab[0] - paletteLab[idx][0]) ** 2 +
                    (baseLab[1] - paletteLab[idx][1]) ** 2 +
                    (baseLab[2] - paletteLab[idx][2]) ** 2
                );
                return Math.max(1e-6, d);
            });

            const weights = dists.map(d => 1 / d);
            const sum = weights.reduce((a, b) => a + b, 0);
            const norm = weights.map(w => w / sum);

            const mergedRGB = [0, 0, 0];
            for (let k = 0; k < group.length; k++) {
                const idx = group[k];
                mergedRGB[0] += paletteRGB[idx][0] * norm[k];
                mergedRGB[1] += paletteRGB[idx][1] * norm[k];
                mergedRGB[2] += paletteRGB[idx][2] * norm[k];
            }

            merged.push(mergedRGB.map(v => Math.round(v)));
        }
    }

    return merged;
}
