// mapping/symbols.js
// -----------------------------------------------------------------------------
// JS conversion of symbols.py
// Provides:
// - buildAdjacencyMap: Maps which DMC colors touch each other
// - symbolsTooSimilar: Checks if symbols belong to the same visual family
// - buildSymbolMap: The primary engine for assigning safe, cute symbols
// - assignSymbolsToPalette: Specific assignment for Pattern Keeper compatibility
// -----------------------------------------------------------------------------

import {
    SYMBOLS,
    PK_SYMBOLS,
    symbolToFamily,
    SIMILAR_COLOUR_THRESHOLD,
    colourDistance
} from "./constants.js";

/**
 * Creates a map of which DMC codes are adjacent in the grid.
 * Used to ensure neighboring stitches don't share the same symbol family. [cite: 1]
 */
export function buildAdjacencyMap(dmcGrid) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const adj = {};

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            if (code === "0") continue;

            if (!adj[code]) adj[code] = new Set();
            const neighbours = [[y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]];

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

/**
 * Returns true if two symbols are in the same visual family (e.g., both are stars). [cite: 3]
 */
export function symbolsTooSimilar(sym1, sym2) {
    if (!sym1 || !sym2) return false;
    return symbolToFamily[sym1] && symbolToFamily[sym1] === symbolToFamily[sym2];
}

/**
 * Checks if a symbol is safe to use for a specific color code based on 
 * already assigned neighboring or similar colors. [cite: 1, 3]
 */
export function isSafeSymbol(symbol, code, assigned, codeToRgb) {
    const thisRgb = codeToRgb[code];
    if (!thisRgb) return true;

    for (const [otherCode, otherSymbol] of Object.entries(assigned)) {
        const otherRgb = codeToRgb[otherCode];
        // If colors are visually similar, ensure symbols are NOT in the same family [cite: 3]
        if (colourDistance(thisRgb, otherRgb) < SIMILAR_COLOUR_THRESHOLD) {
            if (symbolsTooSimilar(symbol, otherSymbol)) return false;
        }
    }
    return true;
}

/**
 * The main mapping engine. Assigns unique symbols to each DMC color in the project.
 * Supports a specialized mode for Pattern Keeper (PK). [cite: 1, 5]
 */
export function buildSymbolMap(dmcGrid, dmcPalette, isPK = false) {
    const uniqueCodes = [...new Set(dmcGrid.flat())].map(String).filter(c => c !== "0");
    const adjacency = buildAdjacencyMap(dmcGrid);

    const codeToRgb = {};
    dmcPalette.forEach(([code, name, rgb]) => {
        codeToRgb[String(code)] = rgb;
    });

    const symbolSet = isPK ? PK_SYMBOLS : SYMBOLS; // Use specific PK set if requested [cite: 5]
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

        // Pass 1: Try to find a symbol that is unused and visually distinct from similar colors [cite: 3]
        for (const symbol of symbolSet) {
            if (forbidden.has(symbol)) continue;
            if (usedSymbols.has(symbol)) continue;
            if (!isSafeSymbol(symbol, code, assigned, codeToRgb)) continue;

            assignedSymbol = symbol;
            usedSymbols.add(symbol);
            break;
        }

        // Pass 2: Fallback to any symbol that is at least safe color-wise if all unique ones are gone
        if (!assignedSymbol) {
            for (const symbol of symbolSet) {
                if (forbidden.has(symbol)) continue;
                if (!isSafeSymbol(symbol, code, assigned, codeToRgb)) continue;
                assignedSymbol = symbol;
                break;
            }
        }

        // Pass 3: Ultimate fallback (circular assignment)
        assigned[code] = assignedSymbol || symbolSet[Object.keys(assigned).length % symbolSet.length];
    }
    return assigned;
}

/**
 * Specialized assignment for Pattern Keeper to ensure font compatibility. [cite: 5]
 */
export function assignSymbolsToPalette(dmcCodes) {
    const mapping = {};
    dmcCodes.forEach((code, i) => {
        mapping[code] = PK_SYMBOLS[i % PK_SYMBOLS.length];
    });
    return mapping;
}