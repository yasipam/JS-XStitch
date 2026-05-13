// parent/ui-render.js
// -----------------------------------------------------------------------------
// UI Rendering functions - palette, threads, pattern size display
// -----------------------------------------------------------------------------

import { state, mappingConfig } from './state.js';
import { sendToCanvas } from './canvas.js';
import { dmcCodeToEntry, dmcCodeToRgb, codeToRgbMap } from './constants.js';
import { DMC_RGB } from '../mapping/constants.js';
import { getDistanceFn, nearestDmcColor } from '../mapping/palette.js';
import { getGridBounds, getColorCounts } from '../core/gridUtils.js';

export function renderPalette(usedCodes = []) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    if (!paletteGrid || !paletteList) return;

    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    const usedSet = new Set(usedCodes.map(String));

    const usedColors = [];
    const unusedColors = [];

    DMC_RGB.forEach(([code, name, rgb]) => {
        const isUsed = usedSet.has(String(code));
        if (isUsed) {
            usedColors.push([code, name, rgb]);
        } else {
            unusedColors.push([code, name, rgb]);
        }
    });

    usedColors.sort((a, b) => Number(a[0]) - Number(b[0]));

    const renderSwatch = (item) => {
        const [code, name, rgb] = item;
        const isUsed = usedSet.has(String(code));
        const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

        const swatch = document.createElement("div");
        swatch.className = `palette-swatch ${isUsed ? 'used' : ''}`;
        swatch.dataset.code = code;
        swatch.style.backgroundColor = rgbStr;
        swatch.title = `${code}: ${name}`;

        swatch.onclick = () => {
            state.setColor(rgb);
            sendToCanvas('SET_COLOR', rgb);
            document.querySelectorAll('.palette-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');

            const highlightModeBtn = document.getElementById('highlightModeBtn');
            if (highlightModeBtn && highlightModeBtn.classList.contains('active')) {
                state.setHighlightedColor(rgb);
                sendToCanvas('SET_HIGHLIGHT_COLOR', rgb);
            }
        };
        paletteGrid.appendChild(swatch);

        const row = document.createElement("div");
        row.className = "palette-row";
        row.dataset.code = code;
        row.innerHTML = `
            <div class="swatch" style="background-color: ${rgbStr}"></div>
            <div class="palette-info">
                <strong>${code}</strong> <span>${name}</span>
                ${isUsed ? '<span class="star">★</span>' : ''}
            </div>
        `;
        row.onclick = () => {
            state.setColor(rgb);
            sendToCanvas('SET_COLOR', rgb);
            const relatedSwatch = paletteGrid.querySelector(`[data-code="${code}"]`);
            if (relatedSwatch) relatedSwatch.click();

            const highlightModeBtn = document.getElementById('highlightModeBtn');
            if (highlightModeBtn && highlightModeBtn.classList.contains('active')) {
                state.setHighlightedColor(rgb);
                sendToCanvas('SET_HIGHLIGHT_COLOR', rgb);
            }
        };
        paletteList.appendChild(row);
    };

    if (usedColors.length > 0) {
        const header = document.createElement("div");
        header.className = "palette-section-header";
        header.textContent = "IN USE";
        paletteList.appendChild(header);
    }

    usedColors.forEach(renderSwatch);

    if (unusedColors.length > 0) {
        if (usedColors.length > 0) {
            const header = document.createElement("div");
            header.className = "palette-section-header";
            header.textContent = "NOT IN USE";
            paletteList.appendChild(header);
        }
        unusedColors.forEach(renderSwatch);
    }
}

export function renderThreadsTable(threadStats) {
    const tbody = document.getElementById("threadsTableBody");
    if (!tbody) return;
    if (!threadStats || threadStats.length === 0) {
        tbody.innerHTML = "<tr><td colspan='3' style='text-align:center;padding:20px;'>No threads found</td></tr>";
        return;
    }
    tbody.innerHTML = "";

    threadStats.sort((a, b) => b.count - a.count);
    const distFn = getDistanceFn("euclidean", false);

    threadStats.forEach(stat => {
        let dmcEntry = null;
        let code = null;

        if (stat.code) {
            code = String(stat.code);
            dmcEntry = dmcCodeToEntry.get(code);
        }

        if (!dmcEntry) {
            const currentRgb = [stat.r, stat.g, stat.b];
            dmcEntry = nearestDmcColor(currentRgb, distFn, null, DMC_RGB);
            if (dmcEntry) {
                code = String(dmcEntry[0]);
            }
        }

        if (!dmcEntry) return;

        const name = dmcEntry.name || dmcEntry[1];
        const originalRgb = dmcEntry.rgb || dmcEntry[2];

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <div class="table-swatch" style="background-color: rgb(${originalRgb[0]}, ${originalRgb[1]}, ${originalRgb[2]}); border: 1px solid #ccc;"></div>
            </td>
            <td title="${name}"><strong>${code}</strong></td>
            <td>${stat.count}</td>
        `;
        tbody.appendChild(row);
    });
}

export function renderBackstitchThreadsTable(backstitchStats) {
    const tbody = document.getElementById("backstitchThreadsTableBody");
    if (!tbody) return;
    if (!backstitchStats || backstitchStats.length === 0) {
        tbody.innerHTML = "<tr><td colspan='3' style='text-align:center;padding:20px;'>No backstitch threads found</td></tr>";
        return;
    }
    tbody.innerHTML = "";

    backstitchStats.sort((a, b) => b.count - a.count);
    const distFn = getDistanceFn("euclidean", false);

    backstitchStats.forEach(stat => {
        const currentRgb = [stat.r, stat.g, stat.b];
        const dmcEntry = nearestDmcColor(currentRgb, distFn, null, DMC_RGB);
        if (!dmcEntry) return;

        const code = String(dmcEntry[0]);
        const name = dmcEntry.name || dmcEntry[1];
        const originalRgb = dmcEntry.rgb || dmcEntry[2];

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <div class="table-swatch" style="background-color: rgb(${originalRgb[0]}, ${originalRgb[1]}, ${originalRgb[2]}); border: 1px solid #ccc;"></div>
            </td>
            <td title="${name}"><strong>${code}</strong></td>
            <td>${stat.count}</td>
        `;
        tbody.appendChild(row);
    });
}

export function updateSidebarFromState() {
    if (!state || !state.mappedDmcGrid) return;

    const countDisplay = document.getElementById("actualColoursUsed");
    const counts = getColorCounts(state.mappedDmcGrid);

    const threadStats = Array.from(counts.entries()).map(([code, count]) => {
        const entry = dmcCodeToEntry.get(code);
        if (!entry) return null;

        return {
            code: code,
            r: entry.rgb[0],
            g: entry.rgb[1],
            b: entry.rgb[2],
            count: count
        };
    }).filter(s => s !== null);

    const backstitchCounts = state.backstitchGrid ? state.backstitchGrid.getColorCounts() : new Map();
    const backstitchStats = Array.from(backstitchCounts.entries()).map(([colorKey, count]) => {
        const [r, g, b] = colorKey.split(',').map(Number);
        return {
            r: r,
            g: g,
            b: b,
            count: count
        };
    });

    if (countDisplay) {
        countDisplay.innerHTML = `Actual Colours: ${threadStats.length}`;
    }
    renderThreadsTable(threadStats);
    renderBackstitchThreadsTable(backstitchStats);
    renderPalette(threadStats.map(s => s.code));
    updatePatternSizeDisplay();
}

export function updatePatternSizeDisplay() {
    const display = document.getElementById("patternSizeDisplay");
    if (!display || !state || !state.mappedDmcGrid) {
        if (display) display.innerHTML = "--";
        return;
    }

    const dmcGrid = state.mappedDmcGrid;
    const bounds = getGridBounds(dmcGrid);

    if (!bounds || !bounds.hasStitches) {
        display.innerHTML = "--";
        return;
    }

    const fabricSelect = document.getElementById("fabricCountSelect");
    const fabricCount = fabricSelect ? parseInt(fabricSelect.value) || 14 : 14;

    const cmSize = calculateCmSize(bounds.width, bounds.height, fabricCount);

    let totalStitches = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
        for (let x = bounds.minX; x <= bounds.maxX; x++) {
            if (String(dmcGrid[y][x]) !== "0") {
                totalStitches++;
            }
        }
    }

    display.innerHTML = `${bounds.width} x ${bounds.height} stitches<br>${cmSize.width} x ${cmSize.height} cm on ${fabricCount}ct<br>Total: ${totalStitches.toLocaleString()} stitches`;
}

function calculateCmSize(width, height, fabricCount) {
    return {
        width: parseFloat((width / fabricCount * 2.54).toFixed(1)),
        height: parseFloat((height / fabricCount * 2.54).toFixed(1))
    };
}