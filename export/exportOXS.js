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
 * Valid OXS Export: Captures live edits and matches Streamlit schema.
 */
export function exportOXS(liveGrid, palette, filename = "pattern.oxs", stampedRgbGrid = null) {
    // liveGrid must be the current 2D array of the editor after drawing
    const h = liveGrid.length;
    const w = liveGrid[0].length;
    const title = filename.replace(/\.[^.]+$/, "");

    // 1. Build palette from LIVE colors present on the canvas
    const seen = new Set();
    const orderedCodes = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(liveGrid[y][x]);
            if (code !== "0" && !seen.has(code)) {
                seen.add(code);
                orderedCodes.push(code);
            }
        }
    }

    // 2. Build XML string manually to avoid namespace/black-screen issues
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<chart>`;
    xml += `\n<format comments01="Exported by CrossStitchEditor" />`;
    xml += `\n<properties oxsversion="1.0" software="CrossStitchEditor" software_version="1.0" chartwidth="${w}" chartheight="${h}" charttitle="${title}" stitchesperinch="14" stitchesperinch_y="14" palettecount="${orderedCodes.length + 1}" />`;

    // 3. Palette Section
    xml += `\n<palette>`;
    xml += `\n<palette_item index="0" number="cloth" name="cloth" color="FFFFFF" printcolor="FFFFFF" blendcolor="nil" comments="aida" strands="2" symbol="0" dashpattern="" misc1="" bsstrands="0" bscolor="000000" />`;

    const paletteIndexMap = { "0": "0" };
    const SYMBOLS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*".split("");

    orderedCodes.forEach((code, i) => {
        const idx = i + 1;

        // Handle both object-style and array-style palettes
        let entry = Array.isArray(palette) ? palette.find(p => String(p[0]) === code) : palette[code];

        let name = entry ? (Array.isArray(entry) ? entry[1] : (entry.name || `DMC ${code}`)) : `DMC ${code}`;
        let rgb = (entry && !Array.isArray(entry)) ? entry.rgb : (Array.isArray(entry) ? entry[2] : DMC_RGB[code] || [0, 0, 0]);

        // If in Stamped Mode, grab the color from the current stamped grid state
        if (stampedRgbGrid) {
            outer: for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (String(liveGrid[y][x]) === code) {
                        rgb = stampedRgbGrid[y][x];
                        break outer;
                    }
                }
            }
        }

        const hex = rgbToHex(rgb);
        xml += `\n<palette_item index="${idx}" number="DMC ${code}" name="${name}" color="${hex}" printcolor="${hex}" blendcolor="nil" comments="" strands="2" symbol="${SYMBOLS[i % SYMBOLS.length]}" dashpattern="" misc1="" bsstrands="1" bscolor="${hex}" />`;
        paletteIndexMap[code] = String(idx);
    });
    xml += `\n</palette>`;

    // 4. Stitches Section: Iterates through the LIVE edited grid
    xml += `\n<fullstitches>`;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(liveGrid[y][x]);
            const palindex = paletteIndexMap[code] || "0";
            xml += `\n<stitch x="${x}" y="${y}" palindex="${palindex}" />`;
        }
    }
    xml += `\n</fullstitches>\n</chart>`;

    // 5. Download
    const blob = new Blob([xml], { type: "application/octet-stream" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = stampedRgbGrid ? `${title}_stamped.oxs` : `${title}.oxs`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}