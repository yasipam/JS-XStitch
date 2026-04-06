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
export function generateStampedPalette(n = 300) {
    const colours = [];

    for (let i = 0; i < n; i++) {
        const h = (i * 137.508) % 360; // golden angle
        const s = 0.85;
        const v = 0.95;

        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;

        let r, g, b;

        if (h < 60) {
            r = c; g = x; b = 0;
        } else if (h < 120) {
            r = x; g = c; b = 0;
        } else if (h < 180) {
            r = 0; g = c; b = x;
        } else if (h < 240) {
            r = 0; g = x; b = c;
        } else if (h < 300) {
            r = x; g = 0; b = c;
        } else {
            r = c; g = 0; b = x;
        }

        const R = Math.round((r + m) * 255);
        const G = Math.round((g + m) * 255);
        const B = Math.round((b + m) * 255);

        colours.push([R, G, B]);
    }

    return colours;
}

// Pre‑generated palette (300 colours)
export const STAMPED_COLOURS = generateStampedPalette(300);


// -----------------------------------------------------------------------------
// INTERNAL STATE (replaces Streamlit session_state)
// -----------------------------------------------------------------------------
const stampedState = {
    stamped_lock_palette: false,
    locked_stamped_palette: null,
    stamped_hue_shift: 0
};


// -----------------------------------------------------------------------------
// BUILD STAMPED GRID
// -----------------------------------------------------------------------------
export function buildStampedGrid(dmcGrid) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const stampedGrid = Array.from({ length: h }, () =>
        Array.from({ length: w }, () => [0, 0, 0])
    );

    // ------------------------------------------------------------------
    // 1. Convert custom palette hex → RGB
    // ------------------------------------------------------------------
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

    let CUSTOM_PALETTE = CUSTOM_PALETTE_HEX.map(hx => [
        parseInt(hx.slice(2, 4), 16),
        parseInt(hx.slice(4, 6), 16),
        parseInt(hx.slice(6, 8), 16)
    ]);

    // Remove white (cloth)
    CUSTOM_PALETTE = CUSTOM_PALETTE.filter(c => !(c[0] === 255 && c[1] === 255 && c[2] === 255));

    // ------------------------------------------------------------------
    // 2. Stable seed per image (MD5 of grid)
    // ------------------------------------------------------------------
    const flatBytes = new TextEncoder().encode(JSON.stringify(dmcGrid));
    const hashBuffer = crypto.subtle.digest("MD5", flatBytes);

    // MD5 is async in JS → wrap in sync-like flow
    return hashBuffer.then(buf => {
        const hashArray = Array.from(new Uint8Array(buf));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        const seedValue = parseInt(hashHex.slice(0, 8), 16);

        // Deterministic RNG
        const rng = mulberry32(seedValue);

        // Shuffle palette
        const palette = CUSTOM_PALETTE.slice();
        shuffleArray(palette, rng);

        // ------------------------------------------------------------------
        // 3. Palette locking
        // ------------------------------------------------------------------
        if (stampedState.stamped_lock_palette) {
            if (stampedState.locked_stamped_palette) {
                palette.splice(0, palette.length, ...stampedState.locked_stamped_palette);
            } else {
                stampedState.locked_stamped_palette = palette.slice();
            }
        } else {
            stampedState.locked_stamped_palette = null;
        }

        // ------------------------------------------------------------------
        // 4. Hue rotation
        // ------------------------------------------------------------------
        const hueShift = stampedState.stamped_hue_shift || 0;
        const rotation = Math.floor((hueShift / 360) * palette.length);
        const rotated = palette.slice(rotation).concat(palette.slice(0, rotation));

        // ------------------------------------------------------------------
        // 5. Map DMC codes → stamped colours
        // ------------------------------------------------------------------
        const uniqueCodes = [...new Set(dmcGrid.flat())]
            .map(c => String(c))
            .filter(c => c !== "0");

        const stampedMap = {};
        uniqueCodes.forEach((code, i) => {
            stampedMap[code] = rotated[i % rotated.length];
        });

        // ------------------------------------------------------------------
        // 6. Build stamped grid
        // ------------------------------------------------------------------
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const code = String(dmcGrid[y][x]);
                if (code === "0") {
                    stampedGrid[y][x] = [255, 255, 255];
                } else {
                    stampedGrid[y][x] = stampedMap[code];
                }
            }
        }

        return stampedGrid;
    });
}


// -----------------------------------------------------------------------------
// HELPERS (minimal, only what Python required)
// -----------------------------------------------------------------------------

// Deterministic RNG (mulberry32)
function mulberry32(a) {
    return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Fisher–Yates shuffle with custom RNG
function shuffleArray(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}
