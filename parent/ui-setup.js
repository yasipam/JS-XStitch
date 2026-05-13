// parent/ui-setup.js
// -----------------------------------------------------------------------------
// UI setup functions - one-time initialization of UI components
// -----------------------------------------------------------------------------

import { state, mappingConfig, currentImage, referenceImage, bgRemoved, isEmptyCanvas, isOxsLoaded, loadedOxsPalette, oxsBaselineDmcGrid, oxsBaselineRgbGrid, oxsBaselinePalette, hasEmptyCanvasEdits, hasBackstitchEdits, originalMaskCanvas, originalImageBeforeBgRemoval, pencilSize, eraserSize, userEditDiff, lastBaselineGrid, lastBaselineDmcGrid, cmWidthInput, cmHeightInput, isUpdatingCmFromSlider, isUpdatingSliderFromCm, pendingSaveSlotId, pendingDeleteSlotId, fileDropdownOpen, replaceColorFromRgb, replaceColorFromCode, replaceColorToRgb, replaceColorToCode, replaceDialogMode, replaceBsFromColor, replaceBsToColor, currentContextMenuPos } from './state.js';
import { sendToCanvas } from './canvas.js';
import { switchTool } from './tools.js';
import { runMapping, captureUserEdits, getRgbFromCode, buildStampedRgbGrid, enforceMaxColors, applyFilteringToGrid, patchDmcGrid } from './mapping.js';
import { showCropOverlay, handleCrop, clearCropBox } from './crop.js';
import { createEmptyCanvas, resizeEmptyCanvas, updateSidebarFromEmptyCanvas } from './empty-canvas.js';
import { loadOxsPattern, updatePaletteFromOxs, applyOxsPostProcessing, applyOxsPostProcessingWithUndo, rebuildRgbFromDmc, updateSidebarFromOxsGrid, getLiveDmcGridFromRgb, applyAntiNoiseToOxsGrid, applyMergeToOxsGrid, updatePaletteAfterPostProcess, updateThreadsTableFromGrid } from './oxs.js';
import { renderPalette, renderThreadsTable, renderBackstitchThreadsTable, updateSidebarFromState, updatePatternSizeDisplay } from './ui-render.js';
import { setupExportButtons } from './export.js';
import { setupFileDropdown, refreshSaveSlotsList, saveCurrentProject, loadProjectFromSlot } from './save-slots.js';
import { onnxModel } from '../core/bgRemover.js';
import { parseOxsFileFromFile } from '../import/importOXS.js';
import { getGridBounds, getColorCounts } from '../core/gridUtils.js';
import { DMC_RGB } from '../mapping/constants.js';
import { dmcCodeToEntry, dmcCodeToRgb, getDmcName, getDmcCodeFromRgb } from './constants.js';
import { findNearestDmcCode } from '../mapping/utils.js';
import { nearestDmcColor, getDistanceFn } from '../mapping/palette.js';

// -----------------------------------------------------------------------------
// UI SETUP FUNCTIONS
// -----------------------------------------------------------------------------

export function setupCollapsiblePanels() {
    const panels = document.querySelectorAll('.panel');
    panels.forEach(panel => {
        const title = panel.querySelector('.panelTitle');
        if (!title) return;

        const contentElements = [];
        let current = title.nextElementSibling;
        while (current && !current.classList.contains('panel')) {
            contentElements.push(current);
            current = current.nextElementSibling;
        }

        if (contentElements.length > 0) {
            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'panel-content';

            contentElements.forEach(el => {
                contentWrapper.appendChild(el);
            });

            panel.insertBefore(contentWrapper, title.nextSibling);
        }

        title.addEventListener('click', () => {
            const content = panel.querySelector('.panel-content');
            if (content) {
                title.classList.toggle('collapsed');
                content.classList.toggle('collapsed');
            }
        });
    });
}

export function setupUpload() {
    const input = document.getElementById("upload");
    const btn = document.getElementById("uploadBtn");
    if (!input) return;

    if (btn) {
        btn.onclick = () => input.click();
    }

    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const base64Data = event.target.result;

            state.originalImageURL = base64Data;

            const img = new Image();
            img.onload = () => {
                currentImage = img;
                referenceImage = img;
                overlayImage = null;
                isOxsLoaded = false;
                isEmptyCanvas = false;
                loadedOxsPalette = null;

                resetUIControls();

                const refOpacity = document.getElementById("referenceOpacity");
                const refOpacityVal = document.getElementById("referenceOpacityVal");
                if (refOpacity) refOpacity.value = 0;
                if (refOpacityVal) refOpacityVal.textContent = "0%";
                sendToCanvas('SET_REFERENCE_OPACITY', 0);
                sendToCanvas('TOGGLE_REFERENCE', true);

                const pixelArtToggle = document.getElementById("pixelArtMode");
                if (pixelArtToggle) {
                    const isSmallEnough = Math.max(img.width, img.height) <= 100;
                    pixelArtToggle.disabled = !isSmallEnough;
                }

                const sizeSlider = document.getElementById("maxSizeSlider");
                const sizeInput = document.getElementById("maxSizeInput");
                if (sizeSlider) sizeSlider.disabled = false;
                if (sizeInput) sizeInput.disabled = false;

                setMappingControlsEnabled(true, false);

                bgRemoved = false;
                originalMaskCanvas = null;
                originalImageBeforeBgRemoval = null;
                const maskAdjustPanel = document.getElementById("maskAdjustPanel");
                if (maskAdjustPanel) maskAdjustPanel.style.display = "none";
                const removeBgBtn = document.getElementById("removeBgBtn");
                const bgRemoveStatus = document.getElementById("bgRemoveStatus");
                if (removeBgBtn) {
                    removeBgBtn.disabled = false;
                    removeBgBtn.style.opacity = '1';
                    removeBgBtn.style.display = "inline-block";
                }
                if (bgRemoveStatus) bgRemoveStatus.style.display = "none";

                state.clear();
                userEditDiff.clear();
                lastBaselineGrid = null;
                hasBackstitchEdits = false;
                updateCropToolState();
                sendToCanvas('INIT', {
                    width: 80,
                    height: Math.floor(80 * (img.height / img.width)),
                    clearBackstitch: true
                });

                runMapping(true);
            };
            img.src = base64Data;
        };
        reader.readAsDataURL(file);
    };
}

export function setupOxsUpload() {
    const input = document.getElementById("oxsUpload");
    const btn = document.getElementById("oxsImportBtn");
    if (!input) return;

    if (btn) {
        btn.onclick = () => input.click();
    }

    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const parsed = await parseOxsFileFromFile(file);
            loadOxsPattern(parsed);

            const uploader = document.getElementById("oxsUpload");
            if (uploader) uploader.value = "";
        } catch (err) {
            alert("Failed to load OXS file: " + err.message);
            console.error(err);
        }
    };
}

export function setupMaskAdjustSlider() {
    const slider = document.getElementById('maskAdjustSlider');
    const valueDisplay = document.getElementById('maskAdjustValue');
    if (!slider) return;

    slider.addEventListener('input', () => {
        const adjustValue = parseInt(slider.value, 10);
        if (valueDisplay) {
            valueDisplay.textContent = adjustValue;
        }

        if (!originalMaskCanvas || !originalImageBeforeBgRemoval) return;

        const adjustedMask = onnxModel.applyMaskAdjust(originalMaskCanvas, adjustValue);
        currentImage = onnxModel.applyMaskAndGetImage(originalImageBeforeBgRemoval, adjustedMask);

        const canvas = document.createElement('canvas');
        canvas.width = currentImage.width;
        canvas.height = currentImage.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(currentImage, 0, 0);
        state.originalImageURL = canvas.toDataURL('image/png');

        runMapping(true);
    });
}

export function setupBgRemover() {
    const btn = document.getElementById("removeBgBtn");
    const statusEl = document.getElementById("bgRemoveStatus");
    if (!btn) return;

    btn.onclick = async () => {
        if (!currentImage || bgRemoved) return;

        btn.disabled = true;

        const statusCallback = (type, message, showProgress) => {
            if (type === 'clear') {
                if (statusEl) {
                    statusEl.style.display = 'none';
                    statusEl.innerHTML = '';
                }
            } else if (type === 'error') {
                if (statusEl) {
                    statusEl.style.display = 'inline';
                    statusEl.textContent = message;
                }
                btn.disabled = false;
            } else if (type === 'loading') {
                if (statusEl) {
                    statusEl.style.display = 'inline';
                    statusEl.textContent = message;
                }
            }
        };

        const progressCallback = (progress) => {
            if (statusEl) {
                statusEl.style.display = 'inline';
                statusEl.textContent = `Downloading model... ${progress}%`;
            }
        };

        const success = await onnxModel.init(statusCallback, progressCallback);

        if (!success) {
            btn.disabled = false;
            return;
        }

        if (statusEl) {
            statusEl.textContent = 'Removing background...';
        }

        const result = await onnxModel.run(currentImage);

        if (result && result.processedImage) {
            originalImageBeforeBgRemoval = currentImage;
            originalMaskCanvas = result.maskCanvas;

            currentImage = result.processedImage;
            bgRemoved = true;
            btn.disabled = true;
            btn.style.opacity = '0.5';

            const maskAdjustPanel = document.getElementById('maskAdjustPanel');
            if (maskAdjustPanel) {
                maskAdjustPanel.style.display = 'block';
            }

            const maskAdjustSlider = document.getElementById('maskAdjustSlider');
            const maskAdjustValue = document.getElementById('maskAdjustValue');
            if (maskAdjustSlider) maskAdjustSlider.value = 0;
            if (maskAdjustValue) maskAdjustValue.textContent = '0';

            const canvas = document.createElement('canvas');
            canvas.width = currentImage.width;
            canvas.height = currentImage.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(currentImage, 0, 0);

            const base64 = canvas.toDataURL('image/png');
            const img = new Image();
            img.onload = () => {
                currentImage = img;

                const newBase64 = canvas.toDataURL('image/png');
                state.originalImageURL = newBase64;

                runMapping(true);
            };
            img.src = base64;
        } else {
            statusCallback('error', 'Failed to process image');
        }

        btn.disabled = true;
    };
}

export function setupNewCanvas() {
    const btn = document.getElementById("newCanvasBtn");
    if (!btn) return;

    btn.onclick = () => {
        const hasEdits = hasEmptyCanvasEdits || userEditDiff.size > 0 || currentImage !== null;
        if (hasEdits) {
            if (!confirm("You have unsaved changes. Create a new blank canvas anyway?")) {
                return;
            }
        }
        createEmptyCanvas(50, 50);
    };
}

export function setMappingControlsEnabled(enabled, isOxsMode = false) {
    const mappingControls = [
        "maxSizeSlider", "maxSizeInput",
        "cmWidth", "cmHeight",
        "maxColours", "maxColoursInput",
        "brightness", "saturation", "contrast",
        "greenToMagenta", "cyanToRed", "blueToYellow"
    ];

    const postProcessingControls = [
        "mergeNearest",
        "reduceIsolatedStitches",
        "antiNoise",
        "minOccurrenceInput"
    ];

    mappingControls.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !enabled || isOxsMode;
        }
    });

    document.querySelectorAll('input[name="colorDistance"]').forEach(radio => {
        radio.disabled = !enabled || isOxsMode;
    });

    postProcessingControls.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = !(enabled || isOxsMode);
        }
    });
}

export function setupToolButtons() {
    const tools = ["pencil", "eraser", "fill", "picker", "crop"];
    const dropdownTools = ["pencil", "eraser", "backstitchPencil"];
    let pressTimer = null;
    let isLongPress = false;

    const startLongPress = (btn, e) => {
        const dropdown = btn.querySelector('.tool-dropdown');
        if (!dropdown) return;
        isLongPress = false;
        pressTimer = setTimeout(() => {
            isLongPress = true;
            document.querySelectorAll('.tool-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.add('open');
            e.stopPropagation();
        }, 500);
    };

    const cancelLongPress = () => {
        clearTimeout(pressTimer);
        pressTimer = null;
    };

    tools.forEach(id => {
        const btn = document.getElementById(id === "picker" ? "toolPicker" : id + "Btn");
        if (btn) {
            btn.addEventListener('mousedown', (e) => {
                if (dropdownTools.includes(id)) {
                    startLongPress(btn, e);
                }
            });
            btn.addEventListener('mouseup', () => {
                if (dropdownTools.includes(id)) {
                    cancelLongPress();
                }
            });
            btn.addEventListener('touchstart', (e) => {
                if (dropdownTools.includes(id)) {
                    startLongPress(btn, e);
                }
            });
            btn.addEventListener('touchend', () => {
                if (dropdownTools.includes(id)) {
                    cancelLongPress();
                }
            });

            btn.onclick = (e) => {
                if (mappingConfig.stampedMode) {
                    alert("Drawing tools are disabled in Stamped Mode. Turn off Stamped Mode to edit.");
                    return;
                }

                if (isLongPress) {
                    isLongPress = false;
                    return;
                }

                if (id === 'crop' && (hasEmptyCanvasEdits || userEditDiff.size > 0)) {
                    alert("Crop tool is disabled after edits. Reset the image or reload to use crop.");
                    return;
                }

                switchTool(id);
            };
        }
    });

    document.querySelectorAll('#pencilBtn .tool-radio input, #eraserBtn .tool-radio input').forEach(radio => {
        radio.onclick = (e) => {
            e.stopPropagation();
            const btn = radio.closest('button');
            const size = parseInt(radio.value);
            const toolName = btn.id === 'pencilBtn' ? 'pencil' : 'eraser';

            if (toolName === 'pencil') {
                pencilSize = size;
                btn.querySelector('.tool-size').textContent = size + '×' + size;
            } else {
                eraserSize = size;
                btn.querySelector('.tool-size').textContent = size + '×' + size;
            }

            sendToCanvas('SET_TOOL_SIZE', { tool: toolName, size: size });
            btn.querySelector('.tool-dropdown').classList.remove('open');
        };
    });

    document.addEventListener('click', (e) => {
        const openDropdowns = document.querySelectorAll('.tool-dropdown.open');
        if (openDropdowns.length === 0) return;

        openDropdowns.forEach(dropdown => {
            const isOutsideDropdown = !dropdown.contains(e.target);
            const parentButton = dropdown.closest('button');
            const isOutsideButton = !parentButton || !parentButton.contains(e.target);

            if (isOutsideDropdown && isOutsideButton) {
                dropdown.classList.remove('open');
            }
        });
    });

    document.addEventListener('mousedown', (e) => {
        const openDropdowns = document.querySelectorAll('.tool-dropdown.open');
        if (openDropdowns.length === 0) return;

        openDropdowns.forEach(dropdown => {
            const isOutsideDropdown = !dropdown.contains(e.target);
            const parentButton = dropdown.closest('button');
            const isOutsideButton = !parentButton || !parentButton.contains(e.target);

            if (isOutsideDropdown && isOutsideButton) {
                dropdown.classList.remove('open');
            }
        });
    });
}

export function setLeftSidebarDisabled(disabled) {
    const leftSidebar = document.getElementById('leftSidebar');

    if (disabled) {
        leftSidebar?.classList.add('sidebar-disabled');
    } else {
        leftSidebar?.classList.remove('sidebar-disabled');
    }

    const leftInputs = leftSidebar?.querySelectorAll('input, select, button, .sliderRow span');
    leftInputs?.forEach(el => {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') {
            el.disabled = disabled;
        }
    });
}

export function setSidebarControlsDisabled(disabled) {
    setLeftSidebarDisabled(disabled);
}

export function setupModeToggle() {
    const pixelModeBtn = document.getElementById('pixelModeBtn');
    const backstitchModeBtn = document.getElementById('backstitchModeBtn');
    const highlightModeBtn = document.getElementById('highlightModeBtn');
    const pixelTools = document.getElementById('pixelTools');
    const backstitchTools = document.getElementById('backstitchTools');

    const cropBtn = document.getElementById('cropBtn');
    const fillBtn = document.getElementById('fillBtn');

    if (pixelModeBtn) {
        pixelModeBtn.onclick = () => {
            state.setMode('pixel');
            sendToCanvas('SET_MODE', 'pixel');

            const highlightModeBtn = document.getElementById('highlightModeBtn');
            if (highlightModeBtn && highlightModeBtn.classList.contains('active')) {
                highlightModeBtn.classList.remove('active');
                state.toggleHighlightMode(false);
                sendToCanvas('SET_HIGHLIGHT_MODE', false);
                setSidebarControlsDisabled(false);
            }

            pixelModeBtn.classList.add('active');
            backstitchModeBtn.classList.remove('active');

            if (pixelTools) pixelTools.style.display = 'inline-block';
            if (backstitchTools) backstitchTools.style.display = 'none';
            if (cropBtn) cropBtn.style.display = 'inline-block';
            if (fillBtn) fillBtn.style.display = 'inline-block';

            document.querySelectorAll('#rightSidebar .tabs .tab-link').forEach(tab => {
                tab.style.display = 'inline-block';
            });

            const paletteTab = document.querySelector('#rightSidebar .tabs .tab-link:first-child');
            if (paletteTab) {
                paletteTab.click();
            }
        };
    }

    if (backstitchModeBtn) {
        backstitchModeBtn.onclick = () => {
            state.setMode('backstitch');
            sendToCanvas('SET_MODE', 'backstitch');

            const highlightModeBtn = document.getElementById('highlightModeBtn');
            if (highlightModeBtn && highlightModeBtn.classList.contains('active')) {
                highlightModeBtn.classList.remove('active');
                state.toggleHighlightMode(false);
                sendToCanvas('SET_HIGHLIGHT_MODE', false);
                setSidebarControlsDisabled(false);
            }

            backstitchModeBtn.classList.add('active');
            pixelModeBtn.classList.remove('active');

            if (pixelTools) pixelTools.style.display = 'none';
            if (backstitchTools) backstitchTools.style.display = 'inline-block';
            if (cropBtn) cropBtn.style.display = 'none';
            if (fillBtn) fillBtn.style.display = 'none';

            document.querySelectorAll('#rightSidebar .tabs .tab-link').forEach(tab => {
                tab.style.display = 'inline-block';
            });

            const paletteTab = document.querySelector('#rightSidebar .tabs .tab-link:first-child');
            if (paletteTab) {
                paletteTab.click();
            }
        };
    }

    if (highlightModeBtn) {
        highlightModeBtn.onclick = () => {
            const isActive = highlightModeBtn.classList.contains('active');

            if (isActive) {
                highlightModeBtn.classList.remove('active');
                state.toggleHighlightMode(false);
                sendToCanvas('SET_HIGHLIGHT_MODE', false);
                setSidebarControlsDisabled(false);
            } else {
                highlightModeBtn.classList.add('active');
                state.toggleHighlightMode(true);
                sendToCanvas('SET_HIGHLIGHT_MODE', true);
                setSidebarControlsDisabled(true);
            }
        };
    }
}

export function setupBackstitchTools() {
    const backstitchPencilBtn = document.getElementById('backstitchPencilBtn');
    const backstitchEraserBtn = document.getElementById('backstitchEraserBtn');

    let backstitchPressTimer = null;
    let backstitchLongPress = false;

    const startBackstitchLongPress = (btn, e) => {
        const dropdown = btn.querySelector('.tool-dropdown');
        if (!dropdown) return;
        backstitchLongPress = false;
        backstitchPressTimer = setTimeout(() => {
            backstitchLongPress = true;
            document.querySelectorAll('.tool-dropdown.open').forEach(d => {
                if (d !== dropdown) d.classList.remove('open');
            });
            dropdown.classList.add('open');
            e.stopPropagation();
        }, 500);
    };

    const cancelBackstitchLongPress = () => {
        clearTimeout(backstitchPressTimer);
        backstitchPressTimer = null;
    };

    if (backstitchPencilBtn) {
        backstitchPencilBtn.addEventListener('mousedown', (e) => {
            startBackstitchLongPress(backstitchPencilBtn, e);
        });
        backstitchPencilBtn.addEventListener('mouseup', () => {
            cancelBackstitchLongPress();
        });
        backstitchPencilBtn.addEventListener('touchstart', (e) => {
            startBackstitchLongPress(backstitchPencilBtn, e);
        });
        backstitchPencilBtn.addEventListener('touchend', () => {
            cancelBackstitchLongPress();
        });

        backstitchPencilBtn.onclick = (e) => {
            if (backstitchLongPress) {
                backstitchLongPress = false;
                return;
            }

            state.setBackstitchTool('backstitchPencil');
            sendToCanvas('SET_BACKSTITCH_TOOL', 'backstitchPencil');

            document.querySelectorAll("#backstitchTools button").forEach(b => b.classList.remove("active"));
            backstitchPencilBtn.classList.add("active");
        };
    }

    if (backstitchEraserBtn) {
        backstitchEraserBtn.addEventListener('mousedown', (e) => {
            startBackstitchLongPress(backstitchEraserBtn, e);
        });
        backstitchEraserBtn.addEventListener('mouseup', () => {
            cancelBackstitchLongPress();
        });
        backstitchEraserBtn.addEventListener('touchstart', (e) => {
            startBackstitchLongPress(backstitchEraserBtn, e);
        });
        backstitchEraserBtn.addEventListener('touchend', () => {
            cancelBackstitchLongPress();
        });

        backstitchEraserBtn.onclick = (e) => {
            if (backstitchLongPress) {
                backstitchLongPress = false;
                return;
            }

            state.setBackstitchTool('backstitchEraser');
            sendToCanvas('SET_BACKSTITCH_TOOL', 'backstitchEraser');

            document.querySelectorAll("#backstitchTools button").forEach(b => b.classList.remove("active"));
            backstitchEraserBtn.classList.add("active");
        };
    }

    document.querySelectorAll('#backstitchPencilBtn .tool-radio input').forEach(radio => {
        radio.onclick = (e) => {
            e.stopPropagation();
            const size = parseFloat(radio.value);
            const sizeText = radio.value === '1' ? '1×' : radio.value === '0.5' ? '0.5×' : '0.25×';

            const sizeSpan = backstitchPencilBtn.querySelector('.tool-size');
            if (sizeSpan) sizeSpan.textContent = sizeText;

            sendToCanvas('SET_BACKSTITCH_SIZE', size);
            backstitchPencilBtn.querySelector('.tool-dropdown').classList.remove('open');
        };
    });

    const backstitchEraserDropdown = document.querySelector('#backstitchEraserBtn .tool-dropdown');
    document.querySelectorAll('#backstitchEraserBtn .tool-radio input').forEach(radio => {
        radio.onclick = (e) => {
            e.stopPropagation();
            const size = parseFloat(radio.value);
            const sizeText = radio.value === '1' ? '1×' : radio.value === '0.5' ? '0.5×' : '0.25×';

            const sizeSpan = backstitchEraserBtn.querySelector('.tool-size');
            if (sizeSpan) sizeSpan.textContent = sizeText;

            sendToCanvas('SET_BACKSTITCH_ERASER_SIZE', size);
            backstitchEraserDropdown.classList.remove('open');
        };
    });

    const backstitchSnapCheckbox = document.getElementById('backstitchSnap');
    if (backstitchSnapCheckbox) {
        backstitchSnapCheckbox.addEventListener('change', (e) => {
            e.stopPropagation();
            sendToCanvas('SET_BACKSTITCH_SNAP', e.target.checked);
        });
        backstitchSnapCheckbox.parentElement.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    const backstitchStabilisationSlider = document.getElementById('backstitchStabilisation');
    const backstitchStabilisationValue = backstitchStabilisationSlider?.parentElement.querySelector('.slider-value');
    if (backstitchStabilisationSlider && backstitchStabilisationValue) {
        backstitchStabilisationSlider.addEventListener('input', (e) => {
            e.stopPropagation();
            const value = parseInt(e.target.value);
            backstitchStabilisationValue.textContent = value + '%';
            sendToCanvas('SET_BACKSTITCH_STABILISATION', value);
        });
        backstitchStabilisationSlider.parentElement.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    const backstitchStraightLineCheckbox = document.getElementById('backstitchStraightLine');
    if (backstitchStraightLineCheckbox) {
        backstitchStraightLineCheckbox.addEventListener('change', (e) => {
            e.stopPropagation();
            sendToCanvas('SET_BACKSTITCH_STRAIGHT_LINE', e.target.checked);
        });
        backstitchStraightLineCheckbox.parentElement.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
}

export function setupEditHistory() {
    const undoBtn = document.getElementById("undoBtn");
    const redoBtn = document.getElementById("redoBtn");

    if (undoBtn) undoBtn.onclick = () => sendToCanvas('CMD_UNDO');
    if (redoBtn) redoBtn.onclick = () => sendToCanvas('CMD_REDO');
}

export function setupResetControls() {
    const resetOriginalBtn = document.getElementById("resetOriginalBtn");
    if (resetOriginalBtn) {
        resetOriginalBtn.onclick = () => {
            if (isOxsLoaded) {
                alert("Cannot reset to original for imported OXS files. Use Clear All to start fresh.");
                return;
            }
            if (confirm("Restore original pattern and discard all edits?")) {
                if (referenceImage) {
                    currentImage = referenceImage;
                    bgRemoved = false;
                    originalMaskCanvas = null;
                    originalImageBeforeBgRemoval = null;
                    const removeBgBtn = document.getElementById("removeBgBtn");
                    if (removeBgBtn) {
                        removeBgBtn.disabled = false;
                        removeBgBtn.style.opacity = '1';
                    }
                    const maskAdjustPanel = document.getElementById("maskAdjustPanel");
                    if (maskAdjustPanel) maskAdjustPanel.style.display = "none";
                }
                resetUIControls();
                userEditDiff.clear();
                state.backstitchGrid.clear(false);
                sendToCanvas('CMD_CLEAR_BACKSTITCH');
                lastBaselineGrid = null;
                runMapping(true);
            }
        };
    }
}

// Note: This file is very long. Mapping controls setup continues in the bootstrap file to avoid import issues.