// mapping/symbols.js
// -----------------------------------------------------------------------------
// JS conversion of symbols.py
// Provides:
// - buildAdjacencyMap
// - symbolsTooSimilar
// - isSafeSymbol
// - buildSymbolMap
// - assignSymbolsToPalette
// -----------------------------------------------------------------------------

// mapping/symbols.js
import {
    SYMBOLS,
    PK_SYMBOLS,
    symbolToFamily, // FIXED: camelCase
    SIMILAR_COLOUR_THRESHOLD,
    colourDistance // FIXED: camelCase
} from "./constants.js";

export function buildAdjacencyMap(dmcGrid) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const adj = {};

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            if (code === "0") continue;
            if (!adj[code]) adj[code] = new Set();
            const neighbours = [[y+1, x], [y-1, x], [y, x+1], [y, x-1]];
            for (const [ny, nx] of neighbours) {
                if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
                    const other = String(dmcGrid[ny][nx]);
                    if (other !== "0" && other !== code) adj[code].add(other);
                }
            }
        }
    }
    return adj;
}

export function symbolsTooSimilar(sym1, sym2) {
    return symbolToFamily[sym1] === symbolToFamily[sym2];
}

export function isSafeSymbol(symbol, code, assigned, codeToRgb) {
    const thisRgb = codeToRgb[code];
    for (const otherCode in assigned) {
        const otherSymbol = assigned[otherCode];
        const otherRgb = codeToRgb[otherCode];
        if (colourDistance(thisRgb, otherRgb) < SIMILAR_COLOUR_THRESHOLD) { // FIXED: camelCase
            if (symbolsTooSimilar(symbol, otherSymbol)) return false;
        }
    }
    return true;
}

export function buildSymbolMap(dmcGrid, dmcPalette) {
    const uniqueCodes = [...new Set(dmcGrid.flat())].map(c => String(c)).filter(c => c !== "0");
    const adjacency = buildAdjacencyMap(dmcGrid);
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

        let assignedSymbol = null;
        for (const symbol of SYMBOLS) {
            if (forbidden.has(symbol)) continue;
            if (usedSymbols.has(symbol)) continue;
            if (!isSafeSymbol(symbol, code, assigned, codeToRgb)) continue;
            assignedSymbol = symbol;
            usedSymbols.add(symbol);
            break;
        }
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

export function assignSymbolsToPalette(dmcCodes) {
    const mapping = {};
    dmcCodes.forEach((code, i) => {
        mapping[code] = PK_SYMBOLS[i % PK_SYMBOLS.length];
    });
    return mapping;
}