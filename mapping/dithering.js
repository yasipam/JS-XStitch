// mapping/dithering.js
// -----------------------------------------------------------------------------
// Dithering utilities for the Cross Stitch Editor (JS conversion of dithering.py)
// -----------------------------------------------------------------------------
//
// Provides:
// - Luminance calculation
// - Ordered Bayer dithering (8×8)
// - Error diffusion dithering (Floyd–Steinberg, Atkinson, etc.)
// - Unified applyDitherRGB() entry point
//
// Dithering is applied BEFORE palette quantisation to preserve detail.
// -----------------------------------------------------------------------------

import { BAYER_8x8, KERNELS } from "./constants.js";

// -----------------------------------------------------------------------------
// LUMINANCE (Rec. 709)
// -----------------------------------------------------------------------------
function luminance(rgbFloat) {
    // rgbFloat: [r,g,b] in 0–1
    return (
        0.2126 * rgbFloat[0] +
        0.7152 * rgbFloat[1] +
        0.0722 * rgbFloat[2]
    );
}

// -----------------------------------------------------------------------------
// ORDERED DITHERING (BAYER 8×8)
// -----------------------------------------------------------------------------
function orderedBayerDither(rgb, strength) {
    // rgb: 2D array [[r,g,b], ...] shaped as (H,W,3)
    // strength: float in [0, 0.2]

    if (strength <= 0) return rgb;

    const h = rgb.length;
    const w = rgb[0].length;

    // Convert to float 0–1
    const rgbF = rgb.map(row =>
        row.map(([r, g, b]) => [r / 255, g / 255, b / 255])
    );

    // Compute luminance
    const Y = rgbF.map(row => row.map(px => luminance(px)));

    // Copy luminance
    const dY = Y.map(row => row.slice());

    // Scale factor (matches Python)
    const delta = 0.12 * (strength / 0.2);

    // Apply Bayer thresholding
    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            const t = BAYER_8x8[i % 8][j % 8];
            if (Y[i][j] < t) {
                dY[i][j] -= delta;
            } else {
                dY[i][j] += delta;
            }
        }
    }

    // Clamp
    for (let i = 0; i < h; i++) {
        for (let j = 0; j < w; j++) {
            dY[i][j] = Math.min(1, Math.max(0, dY[i][j]));
        }
    }

    // Reapply luminance ratio
    const out = [];
    for (let i = 0; i < h; i++) {
        const row = [];
        for (let j = 0; j < w; j++) {
            const ratio = dY[i][j] / (Y[i][j] + 1e-6);
            const [r, g, b] = rgbF[i][j];
            row.push([r * ratio, g * ratio, b * ratio]);
        }
        out.push(row);
    }

    // Blend to preserve detail
    const blend = Math.min(strength / 0.2, 1.0) * 0.4;
    const blended = [];

    for (let i = 0; i < h; i++) {
        const row = [];
        for (let j = 0; j < w; j++) {
            const [r0, g0, b0] = rgbF[i][j];
            const [r1, g1, b1] = out[i][j];
            row.push([
                (r0 * (1 - blend) + r1 * blend) * 255,
                (g0 * (1 - blend) + g1 * blend) * 255,
                (b0 * (1 - blend) + b1 * blend) * 255
            ].map(v => Math.round(Math.min(255, Math.max(0, v)))));
        }
        blended.push(row);
    }

    return blended;
}

// -----------------------------------------------------------------------------
// HELPER: Find nearest palette color
// -----------------------------------------------------------------------------
function findNearestPaletteColor(rgb, palette) {
    const [r, g, b] = rgb;
    let minDist = Infinity;
    let nearest = palette[0];

    for (const color of palette) {
        const dr = r - color[0];
        const dg = g - color[1];
        const db = b - color[2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < minDist) {
            minDist = dist;
            nearest = color;
        }
    }

    return nearest;
}

// -----------------------------------------------------------------------------
// ERROR DIFFUSION DITHERING
// -----------------------------------------------------------------------------
function errorDiffusionDither(rgb, strength, kernel, palette, intensity = 1.0) {
    if (strength <= 0) return rgb;
    if (!palette || palette.length === 0) return rgb;

    const h = rgb.length;
    const w = rgb[0].length;

    const buffer = rgb.map(row => row.map(pixel => [...pixel]));

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const oldPixel = buffer[y][x];
            const quantized = findNearestPaletteColor(oldPixel, palette);

            const err = [
                (oldPixel[0] - quantized[0]) * intensity,
                (oldPixel[1] - quantized[1]) * intensity,
                (oldPixel[2] - quantized[2]) * intensity
            ];

            buffer[y][x] = quantized;

            for (const [dx, dy, weight] of kernel) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    buffer[ny][nx][0] = Math.min(255, Math.max(0, buffer[ny][nx][0] + err[0] * weight));
                    buffer[ny][nx][1] = Math.min(255, Math.max(0, buffer[ny][nx][1] + err[1] * weight));
                    buffer[ny][nx][2] = Math.min(255, Math.max(0, buffer[ny][nx][2] + err[2] * weight));
                }
            }
        }
    }

    const blend = Math.min(strength / 0.2, 1.0) * 0.4;
    const blended = [];

    for (let i = 0; i < h; i++) {
        const row = [];
        for (let j = 0; j < w; j++) {
            const [r0, g0, b0] = rgb[i][j];
            const [r1, g1, b1] = buffer[i][j];
            row.push([
                Math.round(r0 * (1 - blend) + r1 * blend),
                Math.round(g0 * (1 - blend) + g1 * blend),
                Math.round(b0 * (1 - blend) + b1 * blend)
            ]);
        }
        blended.push(row);
    }

    return blended;
}

// -----------------------------------------------------------------------------
// PUBLIC ENTRY POINT
// -----------------------------------------------------------------------------
export function applyDitherRGB(arr, mode, strength, palette = null, intensity = 1.0) {
    // arr: 2D array (H,W,3) uint8
    // mode: "None", "Ordered", "FloydSteinberg", etc.
    // strength: float in [0, 0.2]
    // palette: array of [r,g,b] colors for quantization (optional)
    // intensity: float in [0, 1] to scale error propagation (optional)

    if (!mode || mode === "None" || strength <= 0) {
        return arr;
    }

    if (mode === "Ordered") {
        return orderedBayerDither(arr, strength);
    }

    if (KERNELS[mode]) {
        return errorDiffusionDither(arr, strength, KERNELS[mode], palette, intensity);
    }

    // Unknown mode → no dithering
    return arr;
}
