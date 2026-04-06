// export/exportPDF.js
// @ts-nocheck
// -----------------------------------------------------------------------------
// PDF Exporter — A4, Cross/Filled/Symbol modes, multi‑page tiling, legend.
// This is a faithful JS port of your Streamlit ReportLab renderer.
// -----------------------------------------------------------------------------

import jsPDF from "jspdf";

/**
 * Convert RGB array [r,g,b] → jsPDF color (0–1)
 */
function rgbNorm([r, g, b]) {
    return [r / 255, g / 255, b / 255];
}

/**
 * Draw a single page in CROSS / FILLED / SYMBOL mode.
 * Equivalent to draw_cross_pattern_page() in Python.
 */
function drawPatternPage(pdf, tile, palette, symbolMap, options) {
    const {
        fabricCount,
        mode,
        stampedMode,
        stampedHueShift,
        rgbGrid,
        pageNum,
        totalPages
    } = options;

    const A4_W = 210; // mm
    const A4_H = 297; // mm
    const margin = 10; // mm

    const grid = tile.grid;
    const h = grid.length;
    const w = grid[0].length;

    // Header
    pdf.setFont("courier", "normal");
    pdf.setFontSize(12);
    let header = `Cross Pattern (${fabricCount}-count)`;
    if (pageNum && totalPages) header += ` — Page ${pageNum}/${totalPages}`;
    pdf.text(header, margin, margin);

    // Cell size (mm)
    const cellSize = 25.4 / fabricCount; // 1 inch = 25.4 mm

    const gridW = w * cellSize;
    const gridH = h * cellSize;

    // Center grid
    const x0 = (A4_W - gridW) / 2;
    const y0 = (A4_H - gridH) / 2;

    // Build lookup for palette
    const codeToRgb = {};
    palette.forEach(([code, name, rgb]) => {
        codeToRgb[String(code)] = rgb;
    });

    // ------------------------------------------------------------
    // 1) Draw grid lines
    // ------------------------------------------------------------
    for (let x = 0; x <= w; x++) {
        const cx = x0 + x * cellSize;
        pdf.setLineWidth(x % 10 === 0 ? 0.4 : 0.2);
        pdf.line(cx, y0, cx, y0 + gridH);
    }

    for (let y = 0; y <= h; y++) {
        const cy = y0 + y * cellSize;
        pdf.setLineWidth(y % 10 === 0 ? 0.4 : 0.2);
        pdf.line(x0, cy, x0 + gridW, cy);
    }

    // ------------------------------------------------------------
    // 2) Draw cells (cross / filled / symbol)
    // ------------------------------------------------------------
    pdf.setFontSize(cellSize * 1.2);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const code = String(grid[y][x]);
            if (code === "0") continue;

            let rgb = codeToRgb[code];

            // Stamped mode overrides colour
            if (stampedMode && rgbGrid) {
                rgb = rgbGrid[y][x];
            }

            const [rN, gN, bN] = rgbNorm(rgb);

            const cx = x0 + x * cellSize;
            const cy = y0 + (h - y - 1) * cellSize;

            // Filled mode
            if (mode === "filled" || mode === "symbol") {
                pdf.setFillColor(rN, gN, bN);
                pdf.rect(cx, cy, cellSize, cellSize, "F");
            }

            // Cross mode
            if (mode === "cross") {
                pdf.setDrawColor(rN, gN, bN);
                pdf.setLineWidth(cellSize * 0.18);
                const inset = cellSize * 0.15;
                const x1 = cx + inset;
                const y1 = cy + inset;
                const x2 = cx + cellSize - inset;
                const y2 = cy + cellSize - inset;
                pdf.line(x1, y1, x2, y2);
                pdf.line(x1, y2, x2, y1);
            }

            // Symbol mode
            if (mode === "symbol") {
                const symbol = symbolMap[code] || "?";

                // Choose text colour based on brightness
                const brightness = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
                if (brightness < 128) pdf.setTextColor(255, 255, 255);
                else pdf.setTextColor(0, 0, 0);

                pdf.text(
                    symbol,
                    cx + cellSize / 2,
                    cy + cellSize / 2 + cellSize * 0.15,
                    { align: "center" }
                );
            }
        }
    }

    // ------------------------------------------------------------
    // 3) Corner dots (same logic as Python)
    // ------------------------------------------------------------
    const dotR = cellSize * 0.18;

    pdf.setFillColor(1, 1, 1);
    pdf.setDrawColor(0, 0, 0);
    pdf.setLineWidth(0.2);

    for (let y = 0; y <= h; y++) {
        for (let x = 0; x <= w; x++) {
            let hasStitch = false;

            for (let dy of [-1, 0]) {
                for (let dx of [-1, 0]) {
                    const cy = y + dy;
                    const cx = x + dx;
                    if (cy >= 0 && cy < h && cx >= 0 && cx < w) {
                        if (String(grid[cy][cx]) !== "0") {
                            hasStitch = true;
                            break;
                        }
                    }
                }
                if (hasStitch) break;
            }

            if (!hasStitch) continue;

            const px = x0 + x * cellSize;
            const py = y0 + (h - y) * cellSize;

            pdf.rect(px - dotR, py - dotR, dotR * 2, dotR * 2, "FD");
        }
    }

    pdf.addPage();
}

/**
 * Draw legend page (DMC code, name, symbol)
 */
function drawLegendPage(pdf, palette, symbolMap) {
    const A4_W = 210;
    const A4_H = 297;
    const margin = 10;

    pdf.setFont("courier", "normal");
    pdf.setFontSize(18);
    pdf.text("Legend", margin, margin);

    pdf.setFontSize(12);
    let y = margin + 20;

    pdf.text("Symbol", margin, y);
    pdf.text("DMC", margin + 40, y);
    pdf.text("Name", margin + 80, y);

    y += 10;
    pdf.line(margin, y, A4_W - margin, y);
    y += 10;

    pdf.setFontSize(14);

    for (const [code, name, rgb] of palette) {
        const symbol = symbolMap[code] || "?";

        pdf.text(symbol, margin, y);
        pdf.text(String(code), margin + 40, y);
        pdf.text(name, margin + 80, y);

        y += 8;

        if (y > A4_H - margin - 20) {
            pdf.addPage();
            y = margin + 20;
        }
    }

    pdf.addPage();
}

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
    const totalPages = tiles.length * modesToRender.length + 1; // +1 for legend

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
