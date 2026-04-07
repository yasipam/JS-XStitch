// export/exportPDF.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// PDF Exporter — A4, Cross/Filled/Symbol modes, multi‑page tiling, legend.
// This is a faithful JS port of your Streamlit ReportLab renderer.
// -----------------------------------------------------------------------------

// export/exportPDF.js
// -----------------------------------------------------------------------------
// PDF Exporter — A4, Cross/Filled/Symbol modes, multi‑page tiling, legend.
// -----------------------------------------------------------------------------

// We import the side-effect to ensure the script is loaded, 
// then access the constructor via the global window object.
import "jspdf";

/**
 * Main export function.
 * @param {Object} data - from buildExportData()
 */
export function exportPDF(data) {
    const {
        tiles,
        palette,
        symbolMap,
        rgbGrid,
        fabricCount,
        exportMode
    } = data;

    // Fix: Access jsPDF from the window object provided by the UMD bundle
    const { jsPDF } = window.jspdf;

    const pdf = new jsPDF({
        unit: "mm",
        format: "a4",
        compress: true
    });

    // Remove the blank first page jsPDF creates
    pdf.deletePage(1);

    const modesToRender =
        exportMode === "all"
            ? ["cross", "filled", "symbol"]
            : [exportMode];

    let pageNum = 1;
    const totalPages = tiles.length * modesToRender.length + 1;

    for (const mode of modesToRender) {
        for (const tile of tiles) {
            drawPatternPage(pdf, tile, palette, symbolMap, {
                fabricCount,
                mode,
                stampedMode: data.stampedMode,
                stampedHueShift: data.stampedHueShift,
                rgbGrid,
                pageNum,
                totalPages
            });
            pageNum++;
        }
    }

    // Legend page
    drawLegendPage(pdf, palette, symbolMap);

    pdf.save("pattern.pdf");
}

// --- Internal Helpers ---

function rgbNorm([r, g, b]) {
    return [r / 255, g / 255, b / 255];
}

function drawPatternPage(pdf, tile, palette, symbolMap, options) {
    const { fabricCount, mode, stampedMode, rgbGrid, pageNum, totalPages } = options;
    const A4_W = 210; const A4_H = 297; const margin = 10;
    const grid = tile.grid;
    const h = grid.length; const w = grid[0].length;

    pdf.addPage();
    pdf.setFont("courier", "normal");
    pdf.setFontSize(10);
    pdf.text(`Page ${pageNum}/${totalPages}`, margin, margin);

    const cellSize = 25.4 / fabricCount;
    const gridW = w * cellSize; const gridH = h * cellSize;
    const x0 = (A4_W - gridW) / 2; const y0 = (A4_H - gridH) / 2;

    const codeToRgb = {};
    palette.forEach(([code, , rgb]) => { codeToRgb[String(code)] = rgb; });

    // Draw Grid Lines
    pdf.setDrawColor(200, 200, 200);
    for (let x = 0; x <= w; x++) pdf.line(x0 + x * cellSize, y0, x0 + x * cellSize, y0 + gridH);
    for (let y = 0; y <= h; y++) pdf.line(x0, y0 + y * cellSize, x0 + gridW, y0 + y * cellSize);

    // Draw Stitches
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(grid[y][x]);
            if (code === "0") continue;
            const rgb = (stampedMode && rgbGrid) ? rgbGrid[y][x] : codeToRgb[code];
            const [rN, gN, bN] = rgbNorm(rgb);
            const cx = x0 + x * cellSize;
            const cy = y0 + y * cellSize;

            if (mode === "filled" || mode === "symbol") {
                pdf.setFillColor(rN, gN, bN);
                pdf.rect(cx, cy, cellSize, cellSize, "F");
            }
            if (mode === "symbol") {
                const sym = symbolMap[code] || "?";
                const bright = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
                pdf.setTextColor(bright < 128 ? 255 : 0);
                pdf.setFontSize(cellSize * 2.5);
                pdf.text(sym, cx + cellSize / 2, cy + cellSize / 0.75, { align: "center" });
            }
        }
    }
}

function drawLegendPage(pdf, palette, symbolMap) {
    pdf.addPage();
    pdf.setFontSize(16);
    pdf.text("Legend", 20, 20);
    // ... basic legend drawing logic ...
}