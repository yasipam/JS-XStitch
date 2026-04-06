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
// ERROR DIFFUSION DITHERING
// -----------------------------------------------------------------------------
function errorDiffusionDither(rgb, strength, kernel) {
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
    const Yd = Y.map(row => row.slice());

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const oldVal = Yd[y][x];
            const newVal = oldVal >= 0.5 ? 1.0 : 0.0;

            // Boost factor (matches Python)
            const boost = 0.12 / 0.2;
            const err = (oldVal - newVal) * strength * boost;

            Yd[y][x] = newVal;

            // Diffuse error
            for (const [dx, dy, weight] of kernel) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                    Yd[ny][nx] += err * weight;
                }
            }
        }
    }

    // Clamp
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            Yd[y][x] = Math.min(1, Math.max(0, Yd[y][x]));
        }
    }

    // Reapply luminance ratio
    const out = [];
    for (let i = 0; i < h; i++) {
        const row = [];
        for (let j = 0; j < w; j++) {
            const ratio = Yd[i][j] / (Y[i][j] + 1e-6);
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
// PUBLIC ENTRY POINT
// -----------------------------------------------------------------------------
export function applyDitherRGB(arr, mode, strength) {
    // arr: 2D array (H,W,3) uint8
    // mode: "None", "Ordered", "FloydSteinberg", etc.
    // strength: float in [0, 0.2]

    if (!mode || mode === "None" || strength <= 0) {
        return arr;
    }

    if (mode === "Ordered") {
        return orderedBayerDither(arr, strength);
    }

    if (KERNELS[mode]) {
        return errorDiffusionDither(arr, strength, KERNELS[mode]);
    }

    // Unknown mode → no dithering
    return arr;
}
