function getHighContrastColor(index, hueOffset = 0) {
    const goldenRatioConjugate = 0.618033988749895;
    let h = (index * goldenRatioConjugate) + (hueOffset / 360);
    h %= 1;
    const l = index % 2 === 0 ? 0.5 : 0.7; // Alternating brightness
    return hslToRgb(h, 0.9, l);
}

function hslToRgb(h, s, l) {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    return [
        Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
        Math.round(hue2rgb(p, q, h) * 255),
        Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
}

export function buildStampedGrid(dmcGrid, options = {}) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const stampedGrid = Array.from({ length: h }, () => Array.from({ length: w }));

    const uniqueCodes = [...new Set(dmcGrid.flat())].map(String).filter(c => c !== "0").sort();
    const stampedMap = {};

    uniqueCodes.forEach((code, i) => {
        stampedMap[code] = getHighContrastColor(i, options.hueShift || 0);
    });

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            stampedGrid[y][x] = code === "0" ? [255, 255, 255] : [...stampedMap[code]];
        }
    }

    return { grid: stampedGrid, lookup: stampedMap };
}