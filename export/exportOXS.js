// export/exportOXS.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// Cross Stitch Saga OXS Exporter (JS version of export_oxs.py)
// Produces:
//   • Normal OXS (real DMC colours)
//   • Stamped OXS (stamped RGB but real DMC codes)
// -----------------------------------------------------------------------------

import { DMC_RGB } from "../mapping/constants.js";

/**
 * Convert [r,g,b] → uppercase hex "RRGGBB"
 */
function rgbToHex([r, g, b]) {
    return (
        r.toString(16).padStart(2, "0") +
        g.toString(16).padStart(2, "0") +
        b.toString(16).padStart(2, "0")
    ).toUpperCase();
}

/**
 * Sanitize pattern name (remove illegal filename chars)
 */
function sanitizePatternName(name) {
    return name.replace(/[^a-zA-Z0-9 _-]/g, "_");
}

/**
 * Build ordered palette based on FIRST appearance in the grid.
 */
function buildOrderedCodes(dmcGrid) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const ordered = [];
    const seen = new Set();

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            if (code === "0") continue;
            if (!seen.has(code)) {
                seen.add(code);
                ordered.push(code);
            }
        }
    }
    return ordered;
}

/**
 * Build XML element helper
 */
function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, v);
    }
    children.forEach(child => node.appendChild(child));
    return node;
}

/**
 * Convert an XML element to a UTF‑8 string
 */
function xmlToString(xmlNode) {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(xmlNode);
}

/**
 * ---------------------------------------------------------------------------
 * NORMAL OXS EXPORT (real DMC colours)
 * ---------------------------------------------------------------------------
 */
export function exportOXS(dmcGrid, palette, filename = "pattern.oxs") {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const title = sanitizePatternName(filename.replace(/\.[^.]+$/, ""));

    // 1. Ordered palette
    const orderedCodes = buildOrderedCodes(dmcGrid);

    // 2. Lookup maps
    const codeToName = {};
    const codeToRgb = {};
    palette.forEach(([code, name, rgb]) => {
        codeToName[String(code)] = name;
        codeToRgb[String(code)] = rgb;
    });

    // 3. Root <chart>
    const chart = el("chart");

    const fmt = el("format", { comments01: "Exported by CrossStitchEditor" });
    chart.appendChild(fmt);

    const props = el("properties", {
        oxsversion: "1.0",
        software: "CrossStitchEditor",
        software_version: "1.0",
        chartwidth: String(w),
        chartheight: String(h),
        charttitle: title,
        stitchesperinch: "14",
        stitchesperinch_y: "14",
        palettecount: String(1 + orderedCodes.length)
    });
    chart.appendChild(props);

    // 4. Palette
    const pal = el("palette");
    chart.appendChild(pal);

    // Cloth at index 0
    pal.appendChild(
        el("palette_item", {
            index: "0",
            number: "cloth",
            name: "cloth",
            color: "FFFFFF",
            printcolor: "FFFFFF",
            blendcolor: "nil",
            comments: "aida",
            strands: "2",
            symbol: "0",
            dashpattern: "",
            misc1: "",
            bsstrands: "0",
            bscolor: "000000"
        })
    );

    const SYMBOLS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const paletteIndex = {};

    // Real palette items
    orderedCodes.forEach((code, i) => {
        const idx = i + 1;
        const name = codeToName[code] || `DMC ${code}`;
        const rgb = codeToRgb[code];
        const hex = rgbToHex(rgb);

        pal.appendChild(
            el("palette_item", {
                index: String(idx),
                number: `DMC ${code}`,
                name,
                color: hex,
                printcolor: hex,
                blendcolor: "nil",
                comments: "",
                strands: "2",
                symbol: SYMBOLS[(idx - 1) % SYMBOLS.length],
                dashpattern: "",
                misc1: "",
                bsstrands: "1",
                bscolor: hex
            })
        );

        paletteIndex[code] = idx;
    });

    // 5. Stitches
    const stitches = el("fullstitches");
    chart.appendChild(stitches);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            const idx = code === "0" ? 0 : paletteIndex[code];

            stitches.appendChild(
                el("stitch", {
                    x: String(x),
                    y: String(y),
                    palindex: String(idx)
                })
            );
        }
    }

    // Convert to XML string
    const xml = xmlToString(chart);

    // Trigger download
    const blob = new Blob([xml], { type: "application/xml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

/**
 * ---------------------------------------------------------------------------
 * STAMPED OXS EXPORT (stamped RGB but real DMC codes)
 * ---------------------------------------------------------------------------
 */
export function exportOXSStamped(rgbGrid, dmcGrid, filename = "pattern_stamped.oxs") {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;

    const title = sanitizePatternName(filename.replace(/\.[^.]+$/, ""));

    // 1. Ordered palette
    const orderedCodes = buildOrderedCodes(dmcGrid);

    // 2. Lookup DMC names
    const codeToName = {};
    DMC_RGB.forEach(([code, name]) => {
        codeToName[String(code)] = name;
    });

    // 3. Root <chart>
    const chart = el("chart");

    const fmt = el("format", { comments01: "Exported by CrossStitchEditor" });
    chart.appendChild(fmt);

    const props = el("properties", {
        oxsversion: "1.0",
        software: "CrossStitchEditor",
        software_version: "1.0",
        chartwidth: String(w),
        chartheight: String(h),
        charttitle: title,
        stitchesperinch: "14",
        stitchesperinch_y: "14",
        palettecount: String(1 + orderedCodes.length)
    });
    chart.appendChild(props);

    // 4. Palette
    const pal = el("palette");
    chart.appendChild(pal);

    // Cloth at index 0
    pal.appendChild(
        el("palette_item", {
            index: "0",
            number: "cloth",
            name: "cloth",
            color: "FFFFFF",
            printcolor: "FFFFFF",
            blendcolor: "nil",
            comments: "aida",
            strands: "2",
            symbol: "0",
            dashpattern: "",
            misc1: "",
            bsstrands: "0",
            bscolor: "000000"
        })
    );

    const SYMBOLS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const paletteIndex = {};

    // Real palette items but stamped RGB
    orderedCodes.forEach((code, i) => {
        const idx = i + 1;
        const name = codeToName[code] || `DMC ${code}`;

        // Find first occurrence of this code to get stamped RGB
        let hex = "000000";
        outer: for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (String(dmcGrid[y][x]) === code) {
                    hex = rgbToHex(rgbGrid[y][x]);
                    break outer;
                }
            }
        }

        pal.appendChild(
            el("palette_item", {
                index: String(idx),
                number: `DMC ${code}`,
                name,
                color: hex,
                printcolor: hex,
                blendcolor: "nil",
                comments: "",
                strands: "2",
                symbol: SYMBOLS[(idx - 1) % SYMBOLS.length],
                dashpattern: "",
                misc1: "",
                bsstrands: "1",
                bscolor: hex
            })
        );

        paletteIndex[code] = idx;
    });

    // 5. Stitches
    const stitches = el("fullstitches");
    chart.appendChild(stitches);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            const idx = code === "0" ? 0 : paletteIndex[code];

            stitches.appendChild(
                el("stitch", {
                    x: String(x),
                    y: String(y),
                    palindex: String(idx)
                })
            );
        }
    }

    // Convert to XML string
    const xml = xmlToString(chart);

    // Trigger download
    const blob = new Blob([xml], { type: "application/xml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}
