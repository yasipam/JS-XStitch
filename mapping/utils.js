// processing/utils.js
// -----------------------------------------------------------------------------
// JS conversion of utils.py
// Provides:
// - resizeToWidth
// - adjustBrightnessSaturationContrastAndBias
// - applyAntiNoise
// - rgbToHex
// - sanitizePatternName
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// IMAGE RESIZING
// -----------------------------------------------------------------------------
export function resizeToWidth(image, targetWidth) {
    const w = image.width;
    const h = image.height;

    if (w === 0) return image;

    const scale = targetWidth / w;
    const newW = targetWidth;
    const newH = Math.max(1, Math.floor(h * scale));

    const canvas = document.createElement("canvas");
    canvas.width = newW;
    canvas.height = newH;

    const ctx = canvas.getContext("2d");

    // If RGBA → use NEAREST to avoid blending transparency
    if (image instanceof HTMLCanvasElement || image instanceof HTMLImageElement) {
        ctx.imageSmoothingEnabled = image.mode === "RGBA" ? false : true;
    }

    ctx.drawImage(image, 0, 0, newW, newH);

    return canvas;
}


// -----------------------------------------------------------------------------
// BRIGHTNESS / SATURATION / CONTRAST / LAB BIAS
// -----------------------------------------------------------------------------
import { rgbToLab, labToRgb } from "./palette.js";

export function adjustBrightnessSaturationContrastAndBias(
    arr,
    brightness,
    saturation,
    contrast,
    biasGreenMagenta,
    biasCyanRed,
    biasBlueYellow
) {
    // arr: flat array of [r,g,b] or 2D array
    const flat = Array.isArray(arr[0][0]) ? arr.flat() : arr;

    // Convert to float
    let out = flat.map(([r, g, b]) => [r, g, b].map(v => v * brightness));

    // Saturation
    out = out.map(([r, g, b]) => {
        const gray = (r + g + b) / 3;
        return [
            gray + (r - gray) * saturation,
            gray + (g - gray) * saturation,
            gray + (b - gray) * saturation
        ];
    });

    // Contrast (pivot around 128)
    out = out.map(([r, g, b]) => [
        (r - 128) * contrast + 128,
        (g - 128) * contrast + 128,
        (b - 128) * contrast + 128
    ]);

    // LAB bias?
    const needBias =
        Math.abs(biasGreenMagenta) > 0.001 ||
        Math.abs(biasCyanRed) > 0.001 ||
        Math.abs(biasBlueYellow) > 0.001;

    if (needBias) {
        const norm = out.map(([r, g, b]) => [
            Math.min(1, Math.max(0, r / 255)),
            Math.min(1, Math.max(0, g / 255)),
            Math.min(1, Math.max(0, b / 255))
        ]);

        const lab = rgbToLab(norm);

        const scale = 0.2;
        const biased = lab.map(([L, a, b]) => [
            L,
            a + (biasGreenMagenta + biasCyanRed) * scale,
            b + biasBlueYellow * scale
        ]);

        const rgb = biased.map(l => labToRgb(l).map(v => v * 255));

        out = rgb.map(([r, g, b]) => [
            Math.min(255, Math.max(0, r)),
            Math.min(255, Math.max(0, g)),
            Math.min(255, Math.max(0, b))
        ]);
    }

    // Restore shape
    if (Array.isArray(arr[0][0])) {
        const w = arr[0].length;
        const reshaped = [];
        for (let i = 0; i < out.length; i += w) {
            reshaped.push(out.slice(i, i + w));
        }
        return reshaped;
    }

    return out;
}


// -----------------------------------------------------------------------------
// ANTI‑NOISE (MEDIAN FILTER)
// -----------------------------------------------------------------------------
export function applyAntiNoise(imageData, strength) {
    if (strength <= 0) return imageData;

    let data = imageData;

    for (let i = 0; i < strength; i++) {
        data = medianFilter3x3(data);
    }

    return data;
}

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
// HEX CONVERSION
// -----------------------------------------------------------------------------
export function rgbToHex([r, g, b]) {
    return (
        "#" +
        r.toString(16).padStart(2, "0") +
        g.toString(16).padStart(2, "0") +
        b.toString(16).padStart(2, "0")
    );
}


// -----------------------------------------------------------------------------
// PATTERN NAME SANITISING (OXS EXPORT)
// -----------------------------------------------------------------------------
export function sanitizePatternName(name) {
    const base = name.replace(/\.[^/.]+$/, ""); // remove extension
    return base.replace(/_/g, " ").trim();
}
