// export/exportCSV.js
import { DMC_RGB } from "../mapping/constants.js";

function rgbHex(rgb) {
    if (!rgb || rgb.length < 3) return "";
    const hex = [rgb[0], rgb[1], rgb[2]]
        .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
        .join("");
    return `#${hex.toUpperCase()}`;
}

function escapeCsv(value) {
    const s = value == null ? "" : String(value);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

/**
 * Export the thread/palette information shown in the PDF legend (Symbol Legend
 * plus Backstitch Key) as a single CSV table, independent of the PDF.
 * Columns: Type, Symbol, DMC, Name, RGB Hex, Stamped Hex, Stitches.
 * The "Export by RGB" toggle is intentionally ignored: the CSV always carries
 * every column so it is a complete record.
 */
export function exportPaletteCSV(data, filename = "pattern_palette.csv") {
    const headers = ["Type", "Symbol", "DMC", "Name", "RGB Hex", "Stamped Hex", "Stitches"];
    const rows = [headers];

    // Reverse lookup RGB -> DMC, mirroring exportPDF's Backstitch Key.
    const rgbToDmc = {};
    DMC_RGB.forEach(([code, name, rgb]) => {
        rgbToDmc[JSON.stringify(rgb)] = { code, name };
    });
    (data.palette || []).forEach(p => {
        rgbToDmc[JSON.stringify(p.rgb)] = { code: p.code, name: p.name };
    });

    // Cross-stitch threads (already sorted by stitch count in the export data).
    (data.palette || []).forEach(p => {
        rows.push([
            "Cross Stitch",
            (data.symbolMap && data.symbolMap[p.code]) || "?",
            p.code,
            p.name,
            rgbHex(p.rgb),
            data.stampedMode && p.stampedRgb ? rgbHex(p.stampedRgb) : "",
            p.count || 0
        ]);
    });

    // Backstitch key, grouped by colour exactly like the PDF.
    const bsColorMap = {};
    (data.backstitchLines || []).forEach(line => {
        if (!line.points || line.points.length < 2) return;
        const key = JSON.stringify(line.color);
        if (!bsColorMap[key]) {
            const dmcInfo = rgbToDmc[key] || { code: "Unknown", name: `RGB(${line.color.join(",")})` };
            bsColorMap[key] = {
                code: dmcInfo.code,
                name: dmcInfo.name,
                rgb: line.color,
                count: 0
            };
        }
        bsColorMap[key].count += Math.max(0, line.points.length - 1);
    });

    Object.values(bsColorMap).forEach(bs => {
        rows.push([
            "Backstitch",
            "",
            bs.code,
            bs.name,
            rgbHex(bs.rgb),
            "",
            bs.count
        ]);
    });

    // Totals
    if (data.palette && data.palette.length) {
        rows.push(["Total", "", "", "Cross Stitch", "", "", data.totalStitches || 0]);
    }
    if (Object.keys(bsColorMap).length) {
        rows.push(["Total", "", "", "Backstitch", "", "", data.totalBackstitches || 0]);
    }

    const csv = "\uFEFF" + rows.map(r => r.map(escapeCsv).join(",")).join("\r\n") + "\r\n";

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    // Defer cleanup: revoking/removing synchronously can cancel the download
    // before the browser starts it (blob navigation is asynchronous).
    setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 0);
}
