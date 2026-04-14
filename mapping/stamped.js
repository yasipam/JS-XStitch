// mapping/stamped.js
// -----------------------------------------------------------------------------
// JS conversion of stamped.py
// Provides:
// - generateStampedPalette
// - STAMPED_COLOURS
// - buildStampedGrid
// -----------------------------------------------------------------------------


// -----------------------------------------------------------------------------
// HIGH‑CONTRAST STAMPED PALETTE GENERATOR
// -----------------------------------------------------------------------------
// mapping/mappingEngine.js
// -----------------------------------------------------------------------------
// Core Mapping Pipeline: Image -> Processed RGB -> DMC Grid
// -----------------------------------------------------------------------------
// mapping/stamped.js
// -----------------------------------------------------------------------------
// Stamped palette logic. Provides high-contrast previews.
// -----------------------------------------------------------------------------

/**
 * Deterministic RNG (mulberry32) for stable palette shuffling
 */
function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Synchronous string hash for seed stability without async/await
 */
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return Math.abs(hash);
}

function shuffleArray(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

const CUSTOM_PALETTE_HEX = [
    "FF000000","FF09070a","FF0f0f0f","FF1e1e1e","FF414141","FF808080","FFc0c0c0","FFffffff",
    "FFb5f7ff","FF74c2ed","FF4486e2","FF2a57c9","FF192d8e","FF151654","FF0c0521","FF200d42",
    "FF411f70","FF6d3ba5","FFb15ae8","FFd591f2","FFf9c8c5","FFf9989b","FFfc5560","FFcc2839",
    "FF872139","FF491028","FF210718","FF28161f","FF4f2c2c","FF93584b","FFd38972","FFf9bc93",
    "FFffe5bf","FFccb790","FF967d5a","FF705038","FF563927","FF36221b","FF1c110f","FF541e1a",
    "FF7c2d1d","FFb33f1c","FFdd5e21","FFf58825","FFffb82b","FFfff89e","FFffea51","FFe0ac3c",
    "FFa87737","FF664428","FF28331b","FF495627","FF77843a","FFa7b269","FFd1d090","FFd7f759",
    "FFa7d32c","FF709b1a","FF466d0f","FF2d4213","FF18230e","FF0b3a2b","FF155433","FF1f773e",
    "FF2c9e4c","FF45c652","FF7def69","FFc1ff99","FF7efcbd","FF42d6ac","FF289b82","FF176b65",
    "FF0d3f42","FF051d21","FF0a0414","FF151421","FF29283a","FF4c4c66","FF7c7d9b","FFb6b9d8",
    "FFf7adda","FFe587b3","FFb15e74","FF853f4e","FF512330","FF3f0511","FF7f1511","FFc12c15",
    "FFef4d28","FFff8c6a","FFffc891","FF8cffa3","FF5fd783","FF36b56d","FF318765","FF275145",
    "FF101a38","FF213960","FF446a89","FF6498ad","FF8ecad1","FFd2f7f7","FFeacfc9","FFc6a5a3",
    "FF997578","FF6b4e55","FF442e38","FF2b1c2b","FF592246","FF933981","FFce69c7","FFf399ff"
];

export function buildStampedGrid(dmcGrid, options = {}) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const stampedGrid = Array.from({ length: h }, () =>
        Array.from({ length: w }, () => [255, 255, 255])
    );

    let palette = CUSTOM_PALETTE_HEX.map(hx => [
        parseInt(hx.slice(2, 4), 16),
        parseInt(hx.slice(4, 6), 16),
        parseInt(hx.slice(6, 8), 16)
    ]).filter(c => !(c[0] === 255 && c[1] === 255 && c[2] === 255));

    const seed = hashString(JSON.stringify(dmcGrid));
    const rng = mulberry32(seed);
    shuffleArray(palette, rng);

    const steps = options.hueShift || 0;
    const rotation = Math.floor((steps / 10) * palette.length);
    const rotated = palette.slice(rotation).concat(palette.slice(0, rotation));

    const uniqueCodes = [...new Set(dmcGrid.flat())].map(c => String(c)).filter(c => c !== "0");
    const stampedMap = {};
    uniqueCodes.forEach((code, i) => {
        stampedMap[code] = rotated[i % rotated.length];
    });

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            stampedGrid[y][x] = code === "0" ? [255, 255, 255] : [...stampedMap[code]];
        }
    }

    // Crucial: return the map so buildExportData doesn't have to "search" the grid
    return { grid: stampedGrid, lookup: stampedMap };
}