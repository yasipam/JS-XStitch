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
export function exportOXS(liveGrid, palette, filename = "pattern.oxs", stampedRgbGrid = null, backstitchGrid = null) {
    const h = liveGrid.length;
    const w = liveGrid[0].length;
    const title = filename.replace(/\.[^.]+$/, "");

    // 1. Collect ALL colors from both grid and backstitches
    const colorMap = new Map(); // hex color -> { code, rgb, source: 'dmc' | 'backstitch' }
    const DMC_MAP = new Map(); // code -> dmc entry

    // Build DMC lookup
    if (Array.isArray(palette)) {
        palette.forEach(p => { if (p[0]) DMC_MAP.set(String(p[0]), p); });
    } else if (typeof palette === 'object') {
        Object.entries(palette).forEach(([k, v]) => DMC_MAP.set(String(k), v));
    }

    // Collect DMC colors from grid
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(liveGrid[y][x]);
            if (code === "0") continue;
            if (!colorMap.has(code)) {
                let entry = DMC_MAP.get(code);
                let rgb = entry ? (Array.isArray(entry) ? entry[2] : entry.rgb) : DMC_RGB[code];
                if (!rgb) rgb = [0, 0, 0];
                const hex = rgbToHex(rgb);
                colorMap.set(hex, { code, rgb, source: 'dmc', name: entry ? (Array.isArray(entry) ? entry[1] : entry.name) : `DMC ${code}` });
            }
        }
    }

    // Collect backstitch colors
    const backstitchColorSet = new Set();
    if (backstitchGrid && backstitchGrid.lines) {
        backstitchGrid.lines.forEach(line => {
            if (!line.color || !line.points || line.points.length < 2) return;
            const hex = rgbToHex(line.color);
            backstitchColorSet.add(hex);
            if (!colorMap.has(hex)) {
                colorMap.set(hex, { code: null, rgb: line.color, source: 'backstitch', name: `Backstitch RGB(${line.color.join(',')})` });
            }
        });
    }

    // 2. Build palette entries and index mapping
    const colorEntries = Array.from(colorMap.entries());
    const hexToIndex = {}; // hex -> palette index string
    let xml = `<?xml version="1.0" encoding="utf-8"?>\n<chart>`;
    xml += `\n<format comments01="Exported by CrossStitchEditor" />`;
    xml += `\n<properties oxsversion="1.0" software="CrossStitchEditor" software_version="1.0" chartwidth="${w}" chartheight="${h}" charttitle="${title}" stitchesperinch="14" stitchesperinch_y="14" palettecount="${colorEntries.length + 1}" />`;

    // 3. Palette Section
    xml += `\n<palette>`;
    xml += `\n<palette_item index="0" number="cloth" name="cloth" color="FFFFFF" printcolor="FFFFFF" blendcolor="nil" comments="aida" strands="2" symbol="0" dashpattern="" misc1="" bsstrands="0" bscolor="000000" />`;

    const SYMBOLS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*".split("");

    colorEntries.forEach(([hex, info], i) => {
        const idx = i + 1;
        hexToIndex[hex] = String(idx);

        let name = info.name || `DMC ${info.code}`;
        let rgb = info.rgb;
        let displayHex = hex;

        // If in Stamped Mode, grab the color from the current stamped grid state
        if (stampedRgbGrid && info.source === 'dmc' && info.code) {
            outer: for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (String(liveGrid[y][x]) === info.code) {
                        rgb = stampedRgbGrid[y][x];
                        displayHex = rgbToHex(rgb);
                        break outer;
                    }
                }
            }
        }

        const symbol = SYMBOLS[i % SYMBOLS.length];
        xml += `\n<palette_item index="${idx}" number="${info.source === 'dmc' ? 'DMC ' + info.code : 'BS ' + idx}" name="${name}" color="${displayHex}" printcolor="${displayHex}" blendcolor="nil" comments="" strands="2" symbol="${symbol}" dashpattern="" misc1="" bsstrands="1" bscolor="${displayHex}" />`;
    });
    xml += `\n</palette>`;

    // 4. Stitches Section
    xml += `\n<fullstitches>`;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(liveGrid[y][x]);
            if (code === "0") continue;
            const entry = DMC_MAP.get(code);
            const rgb = entry ? (Array.isArray(entry) ? entry[2] : entry.rgb) : DMC_RGB[code] || [0, 0, 0];
            const hex = rgbToHex(rgb);
            const palindex = hexToIndex[hex] || "0";
            xml += `\n<stitch x="${x}" y="${y}" palindex="${palindex}" />`;
        }
    }
    xml += `\n</fullstitches>`;

    // 5. Backstitches Section
    console.log('[OXS Export] backstitchGrid:', backstitchGrid);
    console.log('[OXS Export] backstitchGrid.lines:', backstitchGrid?.lines);
    console.log('[OXS Export] Number of backstitch lines:', backstitchGrid?.lines?.length);
    xml += `\n<backstitches>`;
    if (backstitchGrid && backstitchGrid.lines && backstitchGrid.lines.length > 0) {
        let sequence = 0;
        backstitchGrid.lines.forEach(line => {
            if (!line.points || line.points.length < 2) return;
            const hex = rgbToHex(line.color);
            const palindex = hexToIndex[hex] || "0";
            for (let i = 0; i < line.points.length - 1; i++) {
                const [x1, y1] = line.points[i];
                const [x2, y2] = line.points[i + 1];
                xml += `\n<backstitch x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" palindex="${palindex}" objecttype="backstitch" sequence="${sequence}" />`;
                sequence++;
            }
        });
    }
    xml += `\n</backstitches>`;

    // 6. Required empty sections for OXS schema compatibility
    xml += `\n<partstitches>\n    <partstitch />\n</partstitches>`;
    xml += `\n<ornaments_inc_knots_and_beads>\n    <object />\n</ornaments_inc_knots_and_beads>`;
    xml += `\n<commentboxes />`;

    xml += `\n</chart>`;

    // Download
    const blob = new Blob([xml], { type: "application/octet-stream" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = stampedRgbGrid ? `${title}_stamped.oxs` : `${title}.oxs`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
