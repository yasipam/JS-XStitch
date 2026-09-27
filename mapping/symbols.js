// mapping/symbols.js
// -----------------------------------------------------------------------------
// JS conversion of symbols.py
// Provides:
// - buildAdjacencyMap: Maps which DMC colors touch each other
// - buildSymbolMap: The primary engine for assigning safe, cute symbols
// - assignSymbolsToPalette: Specific assignment for Pattern Keeper compatibility
// -----------------------------------------------------------------------------

import {
    SYMBOLS,
    PK_SYMBOLS,
    SYMBOLS_FALLBACK,
    symbolToFamily,
    SIMILAR_COLOUR_THRESHOLD,
    colourDistance
} from "./constants.js";

/**
 * Randomises the order of the symbol pool. Called on every export so the same
 * pattern never renders the same chart twice. Always works on a copy - the
 * pool constants are module-level and shared.
 */
function shuffle(items) {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

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
 * Collects the symbol families that `code` must avoid: for every already-assigned
 * color that is visually close to `code`, the family of that color's symbol.
 * Returned as a Set so the pool scan below is O(1) per candidate rather than
 * re-walking every assigned color for each symbol tried. [cite: 3]
 */
function forbiddenFamilies(code, assigned, codeToRgb) {
    const families = new Set();
    const thisRgb = codeToRgb[code];
    // If the current code has no RGB data, we can't do distance checks; assume safe.
    if (!thisRgb) return families;

    for (const [otherCode, otherSymbol] of Object.entries(assigned)) {
        const otherRgb = codeToRgb[otherCode];

        // CRITICAL FIX: Skip comparison if the other color data is missing
        if (!otherRgb) continue;

        // If colors are visually similar, the symbol must not be in the same family
        if (colourDistance(thisRgb, otherRgb) < SIMILAR_COLOUR_THRESHOLD) {
            const family = symbolToFamily[otherSymbol];
            if (family) families.add(family);
        }
    }
    return families;
}

/**
 * True if `symbol` is outside every family in `families`. Symbols with no
 * family (e.g. anything from the overflow pool) can never collide here.
 */
function isSafeSymbol(symbol, families) {
    const family = symbolToFamily[symbol];
    return !family || !families.has(family);
}

/**
 * The main mapping engine. Assigns unique symbols to each DMC color in the project.
 * Supports a specialized mode for Pattern Keeper (PK). [cite: 1, 5]
 *
 * Every color is guaranteed its own symbol: the pool is large enough (curated
 * set + overflow pool) to exceed the total number of DMC colors, so uniqueness
 * is never traded away. Adjacency and color-family rules are readability
 * preferences and are relaxed first.
 *
 * `overrides` is an optional { dmcCode: symbol } map of user pins from the
 * symbol picker. Pinned colors are assigned first and their symbols are reserved
 * before the random passes run, so a pin can never be handed to another color.
 * A pin is ignored - and that color falls back to automatic assignment - if it is
 * not a single character, is not in the pool, or is already held by another
 * color. When two colors pin the same symbol the first one in grid order wins.
 */
export function buildSymbolMap(dmcGrid, dmcPalette, isPK = false, overrides = null) {
    const uniqueCodes = [...new Set(dmcGrid.flat())].map(String).filter(c => c !== "0");
    const adjacency = buildAdjacencyMap(dmcGrid);

    const codeToRgb = {};
    dmcPalette.forEach(([code, name, rgb]) => {
        codeToRgb[String(code)] = rgb;
    });

    // Curated symbols are shuffled so the assignment differs each time this is
    // called. The overflow pool is appended in order (not shuffled) so the most
    // readable glyphs are spent first if a pattern exceeds the curated set. [cite: 1, 5]
    const curatedPool = shuffle(isPK ? PK_SYMBOLS : SYMBOLS);
    const symbolSet = [...curatedPool, ...SYMBOLS_FALLBACK];

    const assigned = {};
    const usedSymbols = new Set();

    // Pinned colors first. Assigning these before the random passes - and seeding
    // usedSymbols with them - is what guarantees a pin cannot be stolen.
    if (overrides) {
        const pool = new Set(symbolSet);
        for (const code of uniqueCodes) {
            const wanted = overrides[code];
            if (!wanted) continue;
            if (typeof wanted !== "string" || [...wanted].length !== 1) continue;
            if (!pool.has(wanted)) continue;
            if (usedSymbols.has(wanted)) continue;
            assigned[code] = wanted;
            usedSymbols.add(wanted);
        }
    }

    for (const code of uniqueCodes) {
        if (Object.prototype.hasOwnProperty.call(assigned, code)) continue;
        const forbidden = new Set();
        if (adjacency[code]) {
            for (const n of adjacency[code]) {
                if (assigned[n]) forbidden.add(assigned[n]);
            }
        }

        const families = forbiddenFamilies(code, assigned, codeToRgb);

        let assignedSymbol = null;

        // Pass 1: Try to find a symbol that is unused, not already used by a
        // neighbour, and visually distinct from similar colors [cite: 3]
        for (const symbol of symbolSet) {
            if (forbidden.has(symbol)) continue;
            if (usedSymbols.has(symbol)) continue;
            if (!isSafeSymbol(symbol, families)) continue;

            assignedSymbol = symbol;
            break;
        }

        // Pass 2: Drop the adjacency rule, never the uniqueness rule. Two
        // distant colors sharing a similar family is merely suboptimal; one
        // glyph meaning two colors makes the chart unreadable.
        if (!assignedSymbol) {
            for (const symbol of symbolSet) {
                if (usedSymbols.has(symbol)) continue;
                if (!isSafeSymbol(symbol, families)) continue;
                assignedSymbol = symbol;
                break;
            }
        }

        if (assignedSymbol) usedSymbols.add(assignedSymbol);

        // Unreachable in practice: the pool is larger than the DMC color table.
        // Leave the empty string so renderers fall back to '?' rather than
        // silently handing this color a glyph another color already owns.
        assigned[code] = assignedSymbol || "";
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