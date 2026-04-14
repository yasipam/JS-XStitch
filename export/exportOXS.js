// export/exportOXS.js
import { DMC_RGB } from "../mapping/constants.js";

function rgbToHex(rgb) {
    if (!rgb) return "000000";
    const [r, g, b] = rgb;
    return (
        Math.round(r).toString(16).padStart(2, "0") +
        Math.round(g).toString(16).padStart(2, "0") +
        Math.round(b).toString(16).padStart(2, "0")
    ).toUpperCase();
}

/**
 * Replicates the logic of export_oxs.py to ensure compatibility with Cross Stitch Saga.
 */
export function exportOXS(dmcGrid, palette, filename = "pattern.oxs", stampedRgbGrid = null) {
    const h = dmcGrid.length;
    const w = dmcGrid[0].length;
    const title = filename.replace(/\.[^.]+$/, "");

    // 1. Build ordered codes based on first appearance
    const orderedCodes = [];
    const seen = new Set();
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            if (code !== "0" && !seen.has(code)) {
                seen.add(code);
                orderedCodes.push(code);
            }
        }
    }

    // 2. Start building XML string manually to avoid namespace issues
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<chart>`;
    xml += `\n<format comments01="Exported by CrossStitchEditor" />`;
    xml += `\n<properties oxsversion="1.0" software="CrossStitchEditor" software_version="1.0" chartwidth="${w}" chartheight="${h}" charttitle="${title}" stitchesperinch="14" stitchesperinch_y="14" palettecount="${orderedCodes.length + 1}" />`;

    // 3. Palette Section
    xml += `\n<palette>`;
    // Cloth at index 0
    xml += `\n<palette_item index="0" number="cloth" name="cloth" color="FFFFFF" printcolor="FFFFFF" blendcolor="nil" comments="aida" strands="2" symbol="0" dashpattern="" misc1="" bsstrands="0" bscolor="000000" />`;

    const paletteIndexMap = { "0": "0" };
    const SYMBOLS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".split("");

    orderedCodes.forEach((code, i) => {
        const idx = i + 1; // Palette items start at 1

        // Find entry in palette (supporting both Array and Object structures)
        let entry = Array.isArray(palette) ? palette.find(p => String(p[0]) === code) : palette[code];
        const name = Array.isArray(entry) ? entry[1] : (entry?.name || `DMC ${code}`);

        // Logic for Stamped vs Normal mode colors
        let rgb = [0, 0, 0];
        if (stampedRgbGrid) {
            outer: for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (String(dmcGrid[y][x]) === code) {
                        rgb = stampedRgbGrid[y][x];
                        break outer;
                    }
                }
            }
        } else {
            rgb = Array.isArray(entry) ? entry[2] : (entry?.rgb || DMC_RGB[code] || [0, 0, 0]);
        }

        const hex = rgbToHex(rgb);
        const symbol = SYMBOLS[i % SYMBOLS.length];

        xml += `\n<palette_item index="${idx}" number="DMC ${code}" name="${name}" color="${hex}" printcolor="${hex}" blendcolor="nil" comments="" strands="2" symbol="${symbol}" dashpattern="" misc1="" bsstrands="1" bscolor="${hex}" />`;
        paletteIndexMap[code] = String(idx);
    });
    xml += `\n</palette>`;

    // 4. Stitches Section
    xml += `\n<fullstitches>`;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(dmcGrid[y][x]);
            const palindex = paletteIndexMap[code] || "0";
            // Use self-closing tags to match streamlit output
            xml += `\n<stitch x="${x}" y="${y}" palindex="${palindex}" />`;
        }
    }
    xml += `\n</fullstitches>`;
    xml += `\n</chart>`;

    // 5. Download Trigger
    const blob = new Blob([xml], { type: "application/octet-stream" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = stampedRgbGrid ? `${title}_stamped.oxs` : `${title}.oxs`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}