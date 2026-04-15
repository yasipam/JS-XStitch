// app.js
import { EditorState } from "./core/state.js";
import { EditorEvents } from "./core/events.js";
import { ToolRegistry } from "./core/tools.js";

// Mapping Logic
import { mergeSimilarPaletteColors, buildPaletteFromImage, getDistanceFn, rgbToLab } from "./mapping/palette.js";
import { mapFullWithPalette, nearestDmcColor } from "./mapping/mappingEngine.js";
import { buildStampedGrid } from "./mapping/stamped.js";
import { DMC_RGB } from "./mapping/constants.js";
import { exportOXS } from "./export/exportOXS.js";

// Export Logic
import { buildExportData } from "./export/buildExportData.js";
import { exportPDF } from "./export/exportPDF.js";

// Global Instances
let state;
let events;
let currentImage = null;
let lastBaselineGrid = null;    // Existing: stores RGB baseline
let lastBaselineDmcGrid = null; // NEW: stores pure DMC baseline mapping

// -----------------------------------------------------------------------------
// MAPPING CONFIGURATION
// -----------------------------------------------------------------------------
const mappingConfig = {
    maxSize: 80,
    maxColours: 30,
    brightnessInt: 0,
    saturationInt: 0,
    contrastInt: 0,
    biasGreenMagenta: 0,
    biasCyanRed: 0,
    biasBlueYellow: 0,
    reduceIsolatedStitches: false,
    antiNoise: 0,
    minOccurrence: 1,
    stampedMode: false,
    stampedHue: 0,
    distanceMethod: "euclidean",
    exportFabricCount: 14,
    exportMode: "cross"
};

// -----------------------------------------------------------------------------
// IFRAME BRIDGE (Global Scope)
// -----------------------------------------------------------------------------
function sendToCanvas(type, payload) {
    const canvasFrame = document.getElementById('canvasFrame');
    if (canvasFrame && canvasFrame.contentWindow) {
        canvasFrame.contentWindow.postMessage({ type, payload }, '*');
    }
}

// -----------------------------------------------------------------------------
// CORE PIPELINE: IMAGE -> GRID
// -----------------------------------------------------------------------------
let cachedProjectPalette = null;
let lastPaletteConfig = { maxSize: 0, maxColours: 0, image: null, distanceMethod: "" };

// -----------------------------------------------------------------------------
// USER-EDIT DIFF LAYER
// -----------------------------------------------------------------------------
// Stores pixels the user has manually painted over the mapped baseline.
// Structure: Map< "x,y" -> [r,g,b] >
// Reset to empty on upload or explicit "Reset to original".
// Re-populated from SYNC_GRID_TO_PARENT by diffing the live canvas against
// the last known clean baseline (state.mappedRgbGrid).
let userEditDiff = new Map();

/**
 * Capture any pixels that differ between the live canvas grid and the
 * current baseline into userEditDiff.  Called from SYNC_GRID_TO_PARENT.
 */
function captureUserEdits(liveGrid) {
    if (!lastBaselineGrid) return;
    const h = liveGrid.length;
    const w = liveGrid[0].length;
    if (h !== lastBaselineGrid.length || w !== lastBaselineGrid[0].length) return;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const [lr, lg, lb] = liveGrid[y][x];
            const [br, bg, bb] = lastBaselineGrid[y][x];
            const key = `${x},${y}`;
            if (lr !== br || lg !== bg || lb !== bb) {
                userEditDiff.set(key, [lr, lg, lb]);
            } else {
                // Pixel matches baseline — no longer a custom edit
                userEditDiff.delete(key);
            }
        }
    }
}

/**
 * Composite: take a fresh baseline grid and re-apply all stored user edits
 * on top of it, returning the merged grid to send to the canvas.
 */
function applyUserEditsToBaseline(baselineGrid) {
    if (userEditDiff.size === 0) return baselineGrid;

    // Deep-clone so we don't mutate the baseline reference
    const merged = baselineGrid.map(row => row.map(px => [...px]));
    for (const [key, rgb] of userEditDiff) {
        const [x, y] = key.split(',').map(Number);
        if (merged[y] && merged[y][x]) {
            merged[y][x] = [...rgb];
        }
    }
    return merged;
}

async function runMapping(isReset = false) {
    if (!currentImage) return;

    try {
        // 1. Calculate Target Size
        let targetSize;
        if (mappingConfig.pixelArtMode) {
            targetSize = Math.max(currentImage.width, currentImage.height);
        } else {
            targetSize = parseInt(mappingConfig.maxSize, 10);
        }

        const maxColours = parseInt(mappingConfig.maxColours, 10);
        const distanceMethod = mappingConfig.distanceMethod;

        // 2. Setup Distance Functions
        const useLab = distanceMethod.startsWith("cie");
        const distFn = getDistanceFn(distanceMethod, useLab);
        const dmcLibraryLab = useLab ? DMC_RGB.map(d => rgbToLab([d[2]])[0]) : null;

        // 3. Palette Cache Logic
        const needsNewPalette =
            cachedProjectPalette === null ||
            lastPaletteConfig.maxSize !== targetSize ||
            lastPaletteConfig.maxColours !== maxColours ||
            lastPaletteConfig.image !== currentImage ||
            lastPaletteConfig.distanceMethod !== distanceMethod;

        if (needsNewPalette) {
            const extractedColors = buildPaletteFromImage(currentImage, maxColours);
            cachedProjectPalette = extractedColors.map(rgb =>
                nearestDmcColor(rgb, distFn, dmcLibraryLab, DMC_RGB)
            );
            lastPaletteConfig = { maxSize: targetSize, maxColours, image: currentImage, distanceMethod };
        }

        // 4. Generate fresh baseline
        const [rgbGrid, dmcGrid] = mapFullWithPalette(
            currentImage, targetSize, cachedProjectPalette,
            1.0 + (mappingConfig.brightnessInt / 10),
            1.0 + (mappingConfig.saturationInt / 10),
            1.0 + (mappingConfig.contrastInt / 10),
            mappingConfig.reduceIsolatedStitches,
            mappingConfig.minOccurrence,
            mappingConfig.biasGreenMagenta,
            mappingConfig.biasCyanRed,
            mappingConfig.biasBlueYellow,
            distanceMethod,
            mappingConfig.antiNoise
        );

        if (isReset) userEditDiff.clear();

        // 6. Store Clean Baseline
        lastBaselineGrid = rgbGrid;
        lastBaselineDmcGrid = dmcGrid;
        state.setMappingResults(rgbGrid, dmcGrid);

        // 7. Build Unified DMC Grid (Baseline + User Edits)
        let liveDmcGrid;
        if (userEditDiff.size > 0) {
            const useLab = mappingConfig.distanceMethod.startsWith("cie");
            const distFn = getDistanceFn(mappingConfig.distanceMethod, useLab);
            // FIX: Wrap RGB in array for lab conversion
            const labCache = useLab ? DMC_RGB.map(d => rgbToLab([d[2]])[0]) : null;

            // FIX: Clone strings correctly (do NOT use [...c])
            liveDmcGrid = dmcGrid.map(row => row.map(c => String(c)));

            for (const [key, rgb] of userEditDiff) {
                const [x, y] = key.split(',').map(Number);
                if (liveDmcGrid[y] && liveDmcGrid[y][x] !== undefined) {
                    if (rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255) {
                        liveDmcGrid[y][x] = "0";
                    } else {
                        const match = nearestDmcColor(rgb, distFn, labCache, DMC_RGB);
                        liveDmcGrid[y][x] = match ? String(match[0]) : "0";
                    }
                }
            }
        } else {
            liveDmcGrid = dmcGrid;
        }

        state.mappedDmcGrid = liveDmcGrid;

        // 8. Build Display Grid
        let displayGrid;
        if (mappingConfig.stampedMode) {
            const stampedResult = buildStampedGrid(liveDmcGrid, { hueShift: mappingConfig.stampedHue });
            displayGrid = stampedResult.grid;
        } else {
            displayGrid = applyUserEditsToBaseline(rgbGrid);
        }

        sendToCanvas('UPDATE_GRID', displayGrid);
        renderPalette(cachedProjectPalette);
        updatePaletteHighlights();

    } catch (error) {
        console.error("Mapping failed:", error);
    }
}

// -----------------------------------------------------------------------------
// UI RENDERING: PALETTE & THREADS
// -----------------------------------------------------------------------------
function renderPalette(projectPalette = []) {
    const paletteGrid = document.getElementById("paletteGrid");
    const paletteList = document.getElementById("paletteList");
    if (!paletteGrid || !paletteList) return;

    // Clear previous entries
    paletteGrid.innerHTML = "";
    paletteList.innerHTML = "";

    const projectCodes = new Set(projectPalette.map(p => String(p[0])));

    DMC_RGB.forEach(([code, name, rgb]) => {
        const isUsed = projectCodes.has(String(code));
        const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;

        // 1. Grid Swatch (Only if used in project, or show all - usually show all for picker)
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
        };
        paletteGrid.appendChild(swatch);

        // 2. Full List Row (Searchable section)
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
            // Also select in grid if visible
            const relatedSwatch = paletteGrid.querySelector(`[data-code="${code}"]`);
            if (relatedSwatch) relatedSwatch.click();
        };
        paletteList.appendChild(row);
    });
}


function setupPaletteUI() {
    const toggleBtn = document.getElementById("toggleList");
    const listContainer = document.getElementById("paletteListContainer");
    const searchInput = document.getElementById("paletteSearch");

    if (toggleBtn && listContainer) {
        toggleBtn.onclick = () => {
            const isHidden = listContainer.style.display === "none";
            listContainer.style.display = isHidden ? "block" : "none";
            toggleBtn.textContent = isHidden ? "CLose list ▲" : "Click to search ▼";

            // Focus search automatically when opening
            if (isHidden && searchInput) searchInput.focus();
        };
    }

    if (searchInput) {
        searchInput.oninput = () => {
            const query = searchInput.value.toLowerCase();
            const rows = document.querySelectorAll(".palette-row");

            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                // Filter rows based on search text
                row.style.display = text.includes(query) ? "flex" : "none";
            });
        };
    }
}

function updatePaletteHighlights() {
    // CRITICAL: Always use the DMC grid for highlighting used colors, 
    // never the RGB grid (which may be stamped)
    const dmcGrid = state.mappedDmcGrid;
    if (!dmcGrid) return;

    const usedCodes = new Set(dmcGrid.flat().map(String));

    document.querySelectorAll('.palette-swatch').forEach(swatch => {
        const code = swatch.dataset.code;
        // Highlight based on the presence of the DMC code, not the displayed color
        if (usedCodes.has(code)) {
            swatch.classList.add('used');
        } else {
            swatch.classList.remove('used');
        }
    });
}

function renderThreadsTable(threadStats) {
    const tbody = document.getElementById("threadsTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    threadStats.sort((a, b) => b.count - a.count);
    const distFn = getDistanceFn("euclidean", false);

    threadStats.forEach(stat => {
        let dmcEntry = null;

        // USE CODE IF PROVIDED: Avoids redundant distance math on every draw
        if (stat.code) {
            dmcEntry = DMC_RGB.find(d => String(d[0]) === String(stat.code));
        }

        // Fallback for non-stamped legacy stats
        if (!dmcEntry) {
            const currentRgb = [stat.r, stat.g, stat.b];
            dmcEntry = nearestDmcColor(currentRgb, distFn, null, DMC_RGB);
        }

        if (!dmcEntry) return;

        const [code, name, originalRgb] = dmcEntry;
        const skeins = Math.ceil(stat.count / 1600);

        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <div class="table-swatch" style="background-color: rgb(${originalRgb[0]}, ${originalRgb[1]}, ${originalRgb[2]}); border: 1px solid #ccc;"></div>
            </td>
            <td title="${name}"><strong>${code}</strong></td>
            <td>${stat.count}</td>
            <td>${skeins}</td>
        `;
        tbody.appendChild(row);
    });
}

function updateSidebarFromState() {
    if (!state || !state.mappedDmcGrid) return;

    const countDisplay = document.getElementById("actualColoursUsed");
    const counts = {};

    state.mappedDmcGrid.flat().forEach(code => {
        const sCode = String(code);
        if (sCode === "0") return; // Skip cloth
        counts[sCode] = (counts[sCode] || 0) + 1;
    });

    const threadStats = Object.entries(counts).map(([code, count]) => {
        const dmcEntry = DMC_RGB.find(d => String(d[0]) === code);
        if (!dmcEntry) return null;

        return {
            code: code,
            r: dmcEntry[2][0],
            g: dmcEntry[2][1],
            b: dmcEntry[2][2],
            count: count
        };
    }).filter(s => s !== null);

    if (countDisplay) {
        countDisplay.innerHTML = `Actual Colours: ${threadStats.length}`;
    }
    renderThreadsTable(threadStats);
}


// -----------------------------------------------------------------------------
// UI SETUP
// -----------------------------------------------------------------------------
window.openTab = function (evt, tabName) {
    const contents = document.getElementsByClassName("tab-content");
    for (let i = 0; i < contents.length; i++) contents[i].style.display = "none";

    const links = document.getElementsByClassName("tab-link");
    for (let i = 0; i < links.length; i++) links[i].className = links[i].className.replace(" active", "");

    document.getElementById(tabName).style.display = "block";
    evt.currentTarget.className += " active";
};

// app.js

function setupUpload() {
    const input = document.getElementById("upload");
    if (!input) return;

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Use FileReader to get a persistent Base64 string for the PDF export
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Data = event.target.result;

            // CRITICAL: Save to state so the PDF cover page can access it
            state.originalImageURL = base64Data;

            const img = new Image();
            img.onload = () => {
                currentImage = img;

                // 1. FORCE RESET: Always start new uploads in standard mode
                const pixelArtToggle = document.getElementById("pixelArtMode");
                const sizeSlider = document.getElementById("maxSizeSlider");
                const sizeInput = document.getElementById("maxSizeInput");

                if (pixelArtToggle) pixelArtToggle.checked = false;
                mappingConfig.pixelArtMode = false;

                // 2. Restore slider functionality and default size
                if (sizeSlider) {
                    sizeSlider.disabled = false;
                    sizeSlider.value = 80;
                    mappingConfig.maxSize = 80;
                }
                if (sizeInput) {
                    sizeInput.value = 80;
                    sizeInput.disabled = false;
                }

                state.clear();
                userEditDiff.clear();   // Fresh upload — no prior edits to keep
                lastBaselineGrid = null;
                // Tell the iframe to prepare for an 80px grid
                sendToCanvas('INIT', {
                    width: 80,
                    height: Math.floor(80 * (img.height / img.width))
                });

                runMapping(true); // isReset=true so view resets to best-fit
            };
            img.src = base64Data;
        };
        reader.readAsDataURL(file);
    };
}

function setupToolButtons() {
    const tools = ["pencil", "eraser", "fill", "picker"];
    tools.forEach(id => {
        const btn = document.getElementById(id === "picker" ? "toolPicker" : id + "Btn");
        if (btn) {
            btn.onclick = () => {
                // Prevent tool switching if Stamped Mode is ON
                if (mappingConfig.stampedMode) {
                    alert("Drawing tools are disabled in Stamped Mode. Turn off Stamped Mode to edit.");
                    return;
                }
                state.setTool(id);
                sendToCanvas('SET_TOOL', id);
                document.querySelectorAll("#topToolbar button").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            };
        }
    });
}

function setupEditHistory() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");
    const clearBtn = document.getElementById("clearAllBtn");

    if (undoBtn) undoBtn.onclick = () => sendToCanvas('CMD_UNDO');
    if (redoBtn) redoBtn.onclick = () => sendToCanvas('CMD_REDO');

    if (clearBtn) {
        clearBtn.onclick = () => {
            if (confirm("Are you sure you want to clear the canvas?")) {
                sendToCanvas('CMD_CLEAR');
                currentImage = null;
                const uploader = document.getElementById("upload");
                if (uploader) uploader.value = "";
                resetUIControls();
            }
        };
    }
}

function setupResetControls() {
    const resetOriginalBtn = document.getElementById("resetOriginalBtn");
    if (resetOriginalBtn) {
        resetOriginalBtn.onclick = () => {
            if (confirm("Restore original pattern and discard all edits?")) {
                resetUIControls();
                userEditDiff.clear();   // Discard all pencil edits
                lastBaselineGrid = null;
                runMapping(true); // isReset=true so view and grid both reset
            }
        };
    }
}

// app.js
function setupMappingControls() {
    // 1. Size & Color Pairs
    const controlPairs = [
        ["maxSizeSlider", "maxSizeInput", "maxSize"],
        ["maxColours", "maxColoursInput", "maxColours"]
    ];

    controlPairs.forEach(([sliderId, inputId, configKey]) => {
        const slider = document.getElementById(sliderId);
        const input = document.getElementById(inputId);
        if (slider && input) {
            slider.oninput = () => {
                input.value = slider.value;
                mappingConfig[configKey] = parseInt(slider.value, 10);
                runMapping();
            };
            input.oninput = () => {
                slider.value = input.value;
                mappingConfig[configKey] = parseInt(input.value, 10);
                runMapping();
            };
        }
    });

    const pixelArtToggle = document.getElementById("pixelArtMode");
    const sizeSlider = document.getElementById("maxSizeSlider");
    const sizeInput = document.getElementById("maxSizeInput");

    if (pixelArtToggle) {
        pixelArtToggle.onchange = () => {
            const isPixelMode = pixelArtToggle.checked;
            mappingConfig.pixelArtMode = isPixelMode;

            if (isPixelMode && currentImage) {
                // Switch to 1:1 mapping
                mappingConfig.maxSize = Math.max(currentImage.width, currentImage.height);
                sizeSlider.disabled = true;
                sizeInput.disabled = true;
            } else {
                // Switch back to the SLIDER value
                sizeSlider.disabled = false;
                sizeInput.disabled = false;
                mappingConfig.maxSize = parseInt(sizeSlider.value, 10);
            }

            runMapping();
        };
    }

    // 3. Distance Radios
    const distanceRadios = document.querySelectorAll("input[name='colorDistance']");
    distanceRadios.forEach(radio => {
        radio.onchange = () => {
            if (radio.checked) {
                mappingConfig.distanceMethod = radio.value;
                runMapping();
            }
        };
    });

    // 4. Levels (Brightness/Sat/Contrast)
    const levels = ["brightness", "saturation", "contrast"];
    levels.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.oninput = () => {
                mappingConfig[id + "Int"] = parseInt(el.value, 10);
                runMapping();
            };
        }
    });

    // 5. Bias Controls
    const biasControls = [
        ["greenToMagenta", "biasGreenMagenta"],
        ["cyanToRed", "biasCyanRed"],
        ["blueToYellow", "biasBlueYellow"]
    ];

    biasControls.forEach(([id, configKey]) => {
        const el = document.getElementById(id);
        if (el) {
            el.oninput = () => {
                mappingConfig[configKey] = parseInt(el.value, 10);
                runMapping();
            };
        }
    });

    // 6. Toggles & Smoothers
    const isolatedToggle = document.getElementById("reduceIsolatedStitches");
    if (isolatedToggle) {
        isolatedToggle.onchange = () => {
            mappingConfig.reduceIsolatedStitches = isolatedToggle.checked;
            runMapping();
        };
    }

    const antiNoiseSlider = document.getElementById("antiNoise");
    const antiNoiseVal = document.getElementById("antiNoiseVal");
    if (antiNoiseSlider) {
        antiNoiseSlider.oninput = () => {
            const val = parseInt(antiNoiseSlider.value, 10);
            antiNoiseVal.textContent = val;
            mappingConfig.antiNoise = val;
            runMapping();
        };
    }

    const stampedToggle = document.getElementById("stampedMode");
    const stampedHue = document.getElementById("stampedHue");
    const stampedHueVal = document.getElementById("stampedHueVal");
    const stampedControls = document.getElementById("stampedControls");

    if (stampedToggle) {
        // Ensure initial UI state matches configuration
        stampedToggle.checked = mappingConfig.stampedMode;
        if (stampedControls) {
            stampedControls.style.display = mappingConfig.stampedMode ? "block" : "none";
        }

        stampedToggle.onchange = () => {
            mappingConfig.stampedMode = stampedToggle.checked;

            if (stampedControls) {
                stampedControls.style.display = mappingConfig.stampedMode ? "block" : "none";
            }

            // DISABLING TOOLS
            const drawingTools = ["pencil", "eraser", "fill", "picker"];
            drawingTools.forEach(id => {
                const btn = document.getElementById(id === "picker" ? "toolPicker" : id + "Btn");
                if (btn) {
                    btn.disabled = mappingConfig.stampedMode;
                    btn.classList.remove("active");
                }
            });

            if (mappingConfig.stampedMode) {
                // Force switch to Pan tool so the user can't draw
                state.setTool("pan");
                sendToCanvas('SET_TOOL', "pan");
                const panBtn = document.getElementById("panBtn"); // Ensure you have this ID in HTML
                if (panBtn) panBtn.classList.add("active");
            }

            runMapping();
        };
    }

    if (stampedHue) {
        // Ensure initial UI state matches configuration
        stampedHue.value = mappingConfig.stampedHue;
        if (stampedHueVal) {
            stampedHueVal.textContent = `${mappingConfig.stampedHue}°`;
        }

        // Use oninput for immediate, smooth feedback as the user slides
        stampedHue.oninput = () => {
            // A. Update the master configuration object
            mappingConfig.stampedHue = parseInt(stampedHue.value, 10);

            // B. Update the text display (e.g., "180°")
            if (stampedHueVal) {
                stampedHueVal.textContent = `${stampedHue.value}°`;
            }

            // C. CRITICAL: Trigger runMapping immediately.
            // This causes the visual neon colors to rotate smoothly in the canvas.
            runMapping();
        };
    }

    // 8. Min Occurrence
    const minOccurrenceInput = document.getElementById("minOccurrenceInput");
    if (minOccurrenceInput) {
        minOccurrenceInput.onchange = () => {
            mappingConfig.minOccurrence = parseInt(minOccurrenceInput.value, 10) || 1;
            runMapping();
        };
    }
} // <--- Properly closing setupMappingControls here

function setupExportButtons() {
    const exportPdfBtn = document.getElementById("exportPDFBtn");
    const exportPngBtn = document.getElementById("exportPngBtn");
    const exportOxsBtn = document.getElementById("exportOxsBtn");

    // Selectors for PDF configuration
    const fabricSelect = document.getElementById("fabricCountSelect");
    const modeSelect = document.getElementById("exportModeSelect"); // crosses, symbol, filled
    const pdfTypeSelect = document.getElementById("pdfTypeSelect"); // Printable vs Standard
    const pkCheckbox = document.getElementById("addPatternKeeper");
    const stampedToggle = document.getElementById("stampedMode");

    if (exportPdfBtn) {
        exportPdfBtn.onclick = async () => {
            try {
                const data = buildExportData(state, mappingConfig, {
                    fabricCount: fabricSelect.value,
                    mode: modeSelect.value
                });

                const exportType = pdfTypeSelect ? pdfTypeSelect.value : 'PRINTABLE';
                await exportPDF(data, exportType);

                if (pkCheckbox && pkCheckbox.checked) {
                    await exportPDF(data, 'PK');
                }
            } catch (error) {
                console.error("PDF Export failed:", error);
            }
        };
    }
    
    // --- PNG EXPORT ---
    if (exportPngBtn) {
        exportPngBtn.onclick = () => {
            // Use LIVE grid from canvas (includes user edits)
            let rgbGrid = state.mappedRgbGrid;

            if (!rgbGrid) {
                console.error("No grid data available to export.");
                return;
            }

            // Apply stamped mode if active
            if (mappingConfig.stampedMode && state.mappedDmcGrid) {
                const stampedResult = buildStampedGrid(state.mappedDmcGrid, {
                    hueShift: mappingConfig.stampedHue
                });
                rgbGrid = stampedResult.grid;
            }

            exportPixelPNG(rgbGrid, "pattern_1x1.png");
        };
    }

    // --- OXS EXPORT ---
    if (exportOxsBtn) {
        exportOxsBtn.onclick = () => {
            if (!state.mappedDmcGrid) {
                console.error("No grid data available to export.");
                return;
            }

            // Regenerate stamped grid if needed
            let stampedRgbGrid = null;
            if (mappingConfig.stampedMode) {
                const stampedResult = buildStampedGrid(state.mappedDmcGrid, {
                    hueShift: mappingConfig.stampedHue
                });
                stampedRgbGrid = stampedResult.grid;
            }

            const isStamped = stampedToggle ? stampedToggle.checked : false;
            exportOXS(
                state.mappedDmcGrid,
                DMC_RGB,
                "kriss_kross_pattern.oxs",
                stampedRgbGrid  // Pass the regenerated grid
            );
        };
    }
}

function setupZoomButtons() {
    document.getElementById("zoomInBtn").onclick = () => sendToCanvas('CMD_ZOOM', 1);
    document.getElementById("zoomOutBtn").onclick = () => sendToCanvas('CMD_ZOOM', -1);
    document.getElementById("resetViewBtn").onclick = () => sendToCanvas('CMD_RESET_VIEW');
}

/**
 * Generates a PNG where 1 pixel = 1 stitch
 */
function exportPixelPNG(rgbGrid, filename) {
    const height = rgbGrid.length;
    const width = rgbGrid[0].length;

    // 1. Create a "hidden" canvas at the exact grid dimensions
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const ctx = offscreenCanvas.getContext('2d');

    // 2. Create ImageData to manipulate raw pixels
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = (y * width + x) * 4;
            const rgb = rgbGrid[y][x];

            // Handle transparency (cloth/0)
            // If your cloth is 255,255,255 and you want it transparent:
            if (rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255) {
                data[index] = 255;
                data[index + 1] = 255;
                data[index + 2] = 255;
                data[index + 3] = 0; // Transparent Alpha
            } else {
                data[index] = rgb[0];     // R
                data[index + 1] = rgb[1]; // G
                data[index + 2] = rgb[2]; // B
                data[index + 3] = 255;    // Opaque Alpha
            }
        }
    }

    // 3. Put the pixels on the canvas and trigger download
    ctx.putImageData(imageData, 0, 0);

    const link = document.createElement('a');
    link.download = filename;
    link.href = offscreenCanvas.toDataURL("image/png");
    link.click();
}

function resetUIControls() {
    mappingConfig.maxSize = 80;
    mappingConfig.maxColours = 30;
    mappingConfig.pixelArtMode = false;
    mappingConfig.brightnessInt = 0;
    mappingConfig.saturationInt = 0;
    mappingConfig.contrastInt = 0;
    mappingConfig.biasGreenMagenta = 0;
    mappingConfig.biasCyanRed = 0;
    mappingConfig.biasBlueYellow = 0;
    mappingConfig.antiNoise = 0;
    mappingConfig.reduceIsolatedStitches = false;

    const ids = ["brightness", "saturation", "contrast", "greenToMagenta", "cyanToRed", "blueToYellow", "antiNoise"];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 0;
    });

    const sizeSlider = document.getElementById("maxSizeSlider");
    const sizeInput = document.getElementById("maxSizeInput");
    if (sizeSlider) sizeSlider.value = 80;
    if (sizeInput) sizeInput.value = 80;

    const antiNoiseVal = document.getElementById("antiNoiseVal");
    if (antiNoiseVal) antiNoiseVal.textContent = "0";

    const isolatedToggle = document.getElementById("reduceIsolatedStitches");
    if (isolatedToggle) isolatedToggle.checked = false;
}

// -----------------------------------------------------------------------------
// BOOTSTRAP
// -----------------------------------------------------------------------------
window.addEventListener("load", () => {
    state = new EditorState(null);
    const canvasFrame = document.getElementById('canvasFrame');

    const initializeCanvas = () => {
        console.log("Sending INIT to iframe...");
        sendToCanvas('INIT', {
            width: state.pixelGrid.width,
            height: state.pixelGrid.height
        });

        if (state.pixelGrid.grid) {
            sendToCanvas('UPDATE_GRID', state.pixelGrid.grid);
        }

        canvasFrame.contentWindow.focus();
    };

    if (canvasFrame.contentDocument && canvasFrame.contentDocument.readyState === 'complete') {
        initializeCanvas();
    } else {
        canvasFrame.onload = initializeCanvas;
    }

    setupUpload();
    setupToolButtons();
    setupEditHistory();
    setupResetControls();
    setupMappingControls();
    setupExportButtons();
    setupZoomButtons();
    setupPaletteUI();

    // GLOBAL KEYBOARD BRIDGE
    window.addEventListener("keydown", (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            if (activeEl.type !== 'range' && activeEl.type !== 'checkbox') {
                return;
            }
        }

        const isZ = e.key.toLowerCase() === "z";
        const isY = e.key.toLowerCase() === "y";
        const hasMod = e.ctrlKey || e.metaKey;

        if (hasMod && (isZ || isY)) {
            e.preventDefault();
            let cmd = 'CMD_UNDO';
            if (isY || (isZ && e.shiftKey)) {
                cmd = 'CMD_REDO';
            }
            sendToCanvas(cmd);
        }
    });

    window.addEventListener('message', (e) => {
        const { type, payload } = e.data;

        if (type === 'REPORT_GRID_STATS') {
            // Use the Parent's unified source of truth for counts
            updateSidebarFromState();
        }

        if (type === 'SYNC_GRID_TO_PARENT') {
            // CRITICAL: If Stamped Mode is ON, drawing is disabled and the canvas 
            // is showing neon colors. We MUST NOT process these as edits.
            if (mappingConfig.stampedMode) return;

            state.mappedRgbGrid = payload;
            captureUserEdits(payload);

            // PATCH THE DMC GRID (Instead of destructive full re-mapping)
            Promise.resolve().then(() => {
                if (!lastBaselineDmcGrid) return;

                const useLab = mappingConfig.distanceMethod.startsWith("cie");
                const distFn = getDistanceFn(mappingConfig.distanceMethod, useLab);
                const labCache = useLab ? DMC_RGB.map(d => rgbToLab([d[2]])[0]) : null;

                // 1. Start with the original baseline DMC codes
                // Use String() cloning to prevent the character-splitting bug
                const liveDmcGrid = lastBaselineDmcGrid.map(row => row.map(c => String(c)));

                // 2. Patch ONLY the pixels that the user has manually edited
                for (const [key, rgb] of userEditDiff) {
                    const [x, y] = key.split(',').map(Number);
                    if (liveDmcGrid[y] && liveDmcGrid[y][x] !== undefined) {
                        if (rgb[0] === 255 && rgb[1] === 255 && rgb[2] === 255) {
                            liveDmcGrid[y][x] = "0"; // Handle manual erasures
                        } else {
                            // Only map the specific edited pixel to its nearest DMC code
                            const match = nearestDmcColor(rgb, distFn, labCache, DMC_RGB);
                            liveDmcGrid[y][x] = match ? String(match[0]) : "0";
                        }
                    }
                }

                // 3. Update the state for the export logic to use
                state.mappedDmcGrid = liveDmcGrid;
                state.setMappingResults(state.mappedRgbGrid, state.mappedDmcGrid);

                // 4. CRITICAL FIX: Refresh the sidebar counts now that patching is finished
                updateSidebarFromState();
            });
        }
    });

    renderPalette([]);
    state.setColor([0, 0, 0]);

    console.log("Cross Stitch Editor Parent Shell Initialized.");
});