// export/exportOXS.js
import { DMC_RGB } from "../mapping/constants.js";

function rgbToHex([r, g, b]) {
    return (
        r.toString(16).padStart(2, "0") +
        g.toString(16).padStart(2, "0") +
        b.toString(16).padStart(2, "0")
    ).toUpperCase();
}

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, v);
    }
    children.forEach(child => node.appendChild(child));
    return node;
}

/**
 * Enhanced OXS Export supporting Normal and Stamped modes
 */
export function exportOXS(dmcGrid, palette, filename = "pattern.oxs", stampedRgbGrid = null) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const title = filename.replace(/\.[^.]+$/, "");

    // 1. Build Ordered Codes based on first appearance
    const seen = new Set();
    const orderedCodes = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            if (code !== "0" && !seen.has(code)) {
                seen.add(code);
                orderedCodes.push(code);
            }
        }
    }

    // 2. Root <chart>
    const chart = el("chart");
    chart.appendChild(el("format", { comments01: "Exported by Kriss Kross Editor" }));
    chart.appendChild(el("properties", {
        oxsversion: "1.0",
        software: "CrossStitchEditor",
        software_version: "1.0",
        chartwidth: String(w),
        chartheight: String(h),
        charttitle: title,
        stitchesperinch: "14",
        stitchesperinch_y: "14",
        palettecount: String(orderedCodes.length + 1)
    }));

    // 3. Palette Section
    const pal = el("palette");
    chart.appendChild(pal);

    // Cloth index 0
    pal.appendChild(el("palette_item", {
        index: "0", number: "cloth", name: "cloth", color: "FFFFFF",
        printcolor: "FFFFFF", blendcolor: "nil", comments: "aida",
        strands: "2", symbol: "0", dashpattern: "", misc1: "",
        bsstrands: "0", bscolor: "000000"
    }));

    const SYMBOLS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const paletteIndexMap = {};

    orderedCodes.forEach((code, i) => {
        const idx = i + 1;
        const entry = palette.find(p => String(p[0]) === code);
        const name = entry ? entry[1] : `DMC ${code}`;
        
        // STAMPED LOGIC: If stampedRgbGrid is provided, find the FIRST color used for this DMC code
        let rgb = entry ? entry[2] : [0, 0, 0];
        if (stampedRgbGrid) {
            outer: for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (String(dmcGrid[y][x]) === code) {
                        rgb = stampedRgbGrid[y][x];
                        break outer;
                    }
                }
            }
        }

        const hex = rgbToHex(rgb);
        pal.appendChild(el("palette_item", {
            index: String(idx),
            number: `DMC ${code}`,
            name: name,
            color: hex,
            printcolor: hex,
            blendcolor: "nil",
            comments: "",
            strands: "2",
            symbol: SYMBOLS[i % SYMBOLS.length],
            dashpattern: "",
            misc1: "",
            bsstrands: "1",
            bscolor: hex
        }));
        paletteIndexMap[code] = idx;
    });

    // 4. Stitches Section
    const stitchesContainer = el("fullstitches");
    chart.appendChild(stitchesContainer);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            const palindex = code === "0" ? "0" : String(paletteIndexMap[code]);
            
            stitchesContainer.appendChild(el("stitch", {
                x: String(x),
                y: String(y),
                palindex: palindex
            }));
        }
    }

    // 5. Download
    const serializer = new XMLSerializer();
    const xmlStr = '<?xml version="1.0" encoding="utf-8"?>\n' + serializer.serializeToString(chart);
    const blob = new Blob([xmlStr], { type: "application/xml" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = stampedRgbGrid ? `${title}_stamped.oxs` : `${title}.oxs`;
    link.click();
}