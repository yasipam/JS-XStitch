
// mapping/stamped.js

/**
 * Generates a high-contrast RGB color using HSL.
 * Uses the Golden Ratio for even hue distribution.
 */
function getHighContrastColor(index, seedOffset = 0) {
    const goldenRatioConjugate = 0.618033988749895;
    let h = (seedOffset / 1000) + (index * goldenRatioConjugate);
    h %= 1;

    // Alternating lightness (50% and 70%) for better neighbor distinction
    const l = index % 2 === 0 ? 0.5 : 0.7;
    const s = 0.9; // High saturation

    return hslToRgb(h, s, l);
}

function hslToRgb(h, s, l) {
    let r, g, b;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };

    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function buildStampedGrid(dmcGrid, options = {}) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const stampedGrid = Array.from({ length: h }, () => Array.from({ length: w }));

    // Extract unique codes (excluding "0" for cloth)
    const uniqueCodes = [...new Set(dmcGrid.flat())]
        .map(String)
        .filter(c => c !== "0")
        .sort();

    // Use a stable seed based on the pattern content
    const seed = hashString(JSON.stringify(uniqueCodes));
    const hueRotation = (options.hueShift || 0) / 360;

    const stampedMap = {};
    uniqueCodes.forEach((code, i) => {
        // Assign a generated high-contrast color
        stampedMap[code] = getHighContrastColor(i, seed * 1000 + hueRotation);
    });

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            stampedGrid[y][x] = code === "0" ? [255, 255, 255] : [...stampedMap[code]];
        }
    }

    return { grid: stampedGrid, lookup: stampedMap };
}

// Keep hashString and mulberry32 if still needed for other logic

function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}
