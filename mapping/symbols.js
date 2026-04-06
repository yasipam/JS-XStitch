// processing/symbols.js
// -----------------------------------------------------------------------------
// JS conversion of symbols.py
// Provides:
// - buildAdjacencyMap
// - symbolsTooSimilar
// - isSafeSymbol
// - buildSymbolMap
// - assignSymbolsToPalette
// -----------------------------------------------------------------------------

import {
    SYMBOLS,
    PK_SYMBOLS,
    symbol_to_family,
    SIMILAR_COLOUR_THRESHOLD,
    colour_distance
} from "./constants.js";


// -----------------------------------------------------------------------------
// ADJACENCY MAP
// -----------------------------------------------------------------------------
export function buildAdjacencyMap(dmcGrid) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const adj = {};

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            if (code === "0") continue;

            if (!adj[code]) adj[code] = new Set();

            // 4‑neighbours
            const neighbours = [
                [y + 1, x],
                [y - 1, x],
                [y, x + 1],
                [y, x - 1]
            ];

            for (const [ny, nx] of neighbours) {
                if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                    const other = String(dmcGrid[ny][nx]);
                    if (other !== "0" && other !== code) {
                        adj[code].add(other);
                    }
                }
            }
        }
    }

    return adj;
}


// -----------------------------------------------------------------------------
// SYMBOL SAFETY
// -----------------------------------------------------------------------------
export function symbolsTooSimilar(sym1, sym2) {
    return symbol_to_family[sym1] === symbol_to_family[sym2];
}

export function isSafeSymbol(symbol, code, assigned, codeToRgb) {
    const thisRgb = codeToRgb[code];

    for (const otherCode in assigned) {
        const otherSymbol = assigned[otherCode];
        const otherRgb = codeToRgb[otherCode];

        // If colours are similar AND symbols are similar → unsafe
        if (colour_distance(thisRgb, otherRgb) < SIMILAR_COLOUR_THRESHOLD) {
            if (symbolsTooSimilar(symbol, otherSymbol)) {
                return false;
            }
        }
    }

    return true;
}


// -----------------------------------------------------------------------------
// MAIN SYMBOL ASSIGNMENT
// -----------------------------------------------------------------------------
export function buildSymbolMap(dmcGrid, dmcPalette) {
    // Unique DMC codes (excluding cloth)
    const uniqueCodes = [...new Set(dmcGrid.flat())]
        .map(c => String(c))
        .filter(c => c !== "0");

    // Build adjacency map
    const adjacency = buildAdjacencyMap(dmcGrid);

    // Build lookup for RGB
    const codeToRgb = {};
    for (const [code, name, rgb] of dmcPalette) {
        codeToRgb[String(code)] = rgb;
    }

    const assigned = {};
    const usedSymbols = new Set();

    for (const code of uniqueCodes) {
        const forbidden = new Set();

        if (adjacency[code]) {
            for (const n of adjacency[code]) {
                if (assigned[n]) forbidden.add(assigned[n]);
            }
        }

        // Try unused symbols first
        let assignedSymbol = null;

        for (const symbol of SYMBOLS) {
            if (forbidden.has(symbol)) continue;
            if (usedSymbols.has(symbol)) continue;
            if (!isSafeSymbol(symbol, code, assigned, codeToRgb)) continue;

            assignedSymbol = symbol;
            usedSymbols.add(symbol);
            break;
        }

        // If none found, reuse allowed
        if (!assignedSymbol) {
            for (const symbol of SYMBOLS) {
                if (forbidden.has(symbol)) continue;
                if (!isSafeSymbol(symbol, code, assigned, codeToRgb)) continue;

                assignedSymbol = symbol;
                break;
            }
        }

        assigned[code] = assignedSymbol;
    }

    return assigned;
}


// -----------------------------------------------------------------------------
// PK‑SAFE SYMBOL ASSIGNMENT
// -----------------------------------------------------------------------------
export function assignSymbolsToPalette(dmcCodes) {
    const mapping = {};

    dmcCodes.forEach((code, i) => {
        mapping[code] = PK_SYMBOLS[i % PK_SYMBOLS.length];
    });

    return mapping;
}
