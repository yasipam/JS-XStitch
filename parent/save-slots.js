// parent/save-slots.js
// -----------------------------------------------------------------------------
// Local save slots functionality
// -----------------------------------------------------------------------------

import { state, pendingSaveSlotId, pendingDeleteSlotId, fileDropdownOpen, isOxsLoaded, loadedOxsPalette, overlayImage, hasBackstitchEdits, mappingConfig, userEditDiff } from './state.js';
import { sendToCanvas } from './canvas.js';
import { getLiveDmcGridFromRgb, buildStampedRgbGrid, loadOxsPattern, updatePatternSizeDisplay, renderPalette } from './oxs.js';
import { getColorCounts } from '../core/gridUtils.js';
import { exportOXS } from '../export/exportOXS.js';
import { getAllSaveSlots, saveSaveSlot, loadSaveSlot, deleteSaveSlot } from '../localSaveSlots.js';
import { DMC_RGB } from '../mapping/constants.js';
import { dmcCodeToEntry } from './constants.js';
import { renderThreadsTable } from './ui-render.js';

export async function setupFileDropdown() {
    const fileBtn = document.getElementById('fileBtn');
    const fileDropdown = document.getElementById('fileDropdown');
    const saveSlotsDropdown = document.getElementById('saveSlotsDropdown');
    const saveBtn = document.getElementById('localSaveBtn');

    if (fileBtn && fileDropdown) {
        fileBtn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = fileDropdown.style.display === 'block';
            if (isOpen) {
                fileDropdown.style.display = 'none';
                fileDropdownOpen = false;
            } else {
                fileDropdown.style.display = 'block';
                fileDropdownOpen = true;
            }
        };
    }

    document.addEventListener('click', (e) => {
        if (fileDropdownOpen && fileDropdown && !fileDropdown.contains(e.target) && !fileBtn.contains(e.target)) {
            fileDropdown.style.display = 'none';
            fileDropdownOpen = false;
        }
    });

    document.addEventListener('click', (e) => {
        if (saveSlotsDropdown && !saveSlotsDropdown.contains(e.target)) {
            const submenuBtn = document.querySelector('.dropdown-submenu-btn');
            if (submenuBtn && !submenuBtn.contains(e.target)) {
                saveSlotsDropdown.style.display = 'none';
            }
        }
    });

    if (saveBtn) {
        saveBtn.onclick = (e) => {
            e.stopPropagation();
            fileDropdown.style.display = 'none';
            fileDropdownOpen = false;

            if (!state.mappedDmcGrid && !state.mappedRgbGrid) {
                alert('No pattern to save. Please load an image or create a canvas first.');
                return;
            }
            openSaveSlotNameDialog();
        };
    }

    const openSubmenuBtn = document.querySelector('.dropdown-submenu-btn');
    if (openSubmenuBtn && saveSlotsDropdown) {
        openSubmenuBtn.onclick = async (e) => {
            e.stopPropagation();
            await refreshSaveSlotsList();
        };

        openSubmenuBtn.onmouseenter = async () => {
            await refreshSaveSlotsList();
            saveSlotsDropdown.style.display = 'block';
        };

        const submenuContainer = openSubmenuBtn.closest('.dropdown-submenu-container');
        if (submenuContainer) {
            submenuContainer.onmouseleave = () => {
                saveSlotsDropdown.style.display = 'none';
            };
        }
    }

    const importBtn = document.getElementById('oxsImportBtn');
    if (importBtn) {
        const originalOnclick = importBtn.onclick;
        importBtn.onclick = (e) => {
            fileDropdown.style.display = 'none';
            fileDropdownOpen = false;
            if (originalOnclick) originalOnclick.call(importBtn, e);
        };
    }

    const newCanvasBtn = document.getElementById('newCanvasBtn');
    if (newCanvasBtn) {
        const originalOnclick = newCanvasBtn.onclick;
        newCanvasBtn.onclick = (e) => {
            fileDropdown.style.display = 'none';
            fileDropdownOpen = false;
            if (originalOnclick) originalOnclick.call(newCanvasBtn, e);
        };
    }

    const saveOverlay = document.getElementById('saveSlotNameOverlay');
    const saveNameInput = document.getElementById('saveSlotNameInput');
    const saveInfo = document.getElementById('saveSlotInfo');
    const saveConfirmBtn = document.getElementById('saveSlotConfirm');
    const saveCancelBtn = document.getElementById('saveSlotCancel');
    const saveCloseBtn = document.getElementById('saveSlotNameClose');

    function openSaveSlotNameDialog() {
        const dmcGrid = state.mappedDmcGrid;
        const w = dmcGrid ? dmcGrid[0]?.length : 0;
        const h = dmcGrid ? dmcGrid.length : 0;

        const counts = getColorCounts(dmcGrid);
        const colorCount = counts ? counts.size : 0;

        const date = new Date();
        const defaultName = `Project ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

        if (saveNameInput) saveNameInput.value = defaultName;
        if (saveInfo) {
            saveInfo.textContent = `Size: ${w}×${h} stitches • ${colorCount} colors`;
        }
        if (saveOverlay) saveOverlay.style.display = 'flex';
        if (saveNameInput) {
            saveNameInput.focus();
            saveNameInput.select();
        }
    }

    function closeSaveSlotDialog() {
        if (saveOverlay) saveOverlay.style.display = 'none';
        if (saveNameInput) saveNameInput.value = '';
    }

    if (saveCloseBtn) {
        saveCloseBtn.onclick = closeSaveSlotDialog;
    }
    if (saveCancelBtn) {
        saveCancelBtn.onclick = closeSaveSlotDialog;
    }
    if (saveConfirmBtn) {
        saveConfirmBtn.onclick = async () => {
            const name = saveNameInput ? saveNameInput.value.trim() : '';
            if (!name) {
                alert('Please enter a name for your project.');
                return;
            }

            await saveCurrentProject(name);
            closeSaveSlotDialog();
            alert('Project saved successfully!');
        };
    }

    const deleteOverlay = document.getElementById('deleteSlotOverlay');
    const deleteSlotName = document.getElementById('deleteSlotName');
    const deleteConfirmBtn = document.getElementById('deleteSlotConfirm');
    const deleteCancelBtn = document.getElementById('deleteSlotCancel');
    const deleteCloseBtn = document.getElementById('deleteSlotClose');

    window.showDeleteSlotDialog = function(slotId, slotName) {
        pendingDeleteSlotId = slotId;
        if (deleteSlotName) deleteSlotName.textContent = slotName;
        if (deleteOverlay) deleteOverlay.style.display = 'flex';
    };

    function closeDeleteSlotDialog() {
        pendingDeleteSlotId = null;
        if (deleteOverlay) deleteOverlay.style.display = 'none';
    }

    if (deleteCloseBtn) {
        deleteCloseBtn.onclick = closeDeleteSlotDialog;
    }
    if (deleteCancelBtn) {
        deleteCancelBtn.onclick = closeDeleteSlotDialog;
    }
    if (deleteConfirmBtn) {
        deleteConfirmBtn.onclick = async () => {
            if (pendingDeleteSlotId) {
                try {
                    await deleteSaveSlot(pendingDeleteSlotId);
                    await refreshSaveSlotsList();
                } catch (err) {
                    console.error('Failed to delete slot:', err);
                    alert('Failed to delete save slot.');
                }
            }
            closeDeleteSlotDialog();
        };
    }
}

export async function refreshSaveSlotsList() {
    const slotsList = document.getElementById('saveSlotsList');
    if (!slotsList) return;

    try {
        const slots = await getAllSaveSlots();
        slotsList.innerHTML = '';

        if (slots.length === 0) {
            slotsList.innerHTML = '<div style="padding: 16px; text-align: center; color: #666;">No saved projects yet.</div>';
            return;
        }

        slots.forEach(slot => {
            const date = new Date(slot.timestamp);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const item = document.createElement('div');
            item.className = 'save-slot-item';
            item.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--color-border, #eee);';
            item.innerHTML = `
                <div class="slot-info" style="flex: 1; min-width: 0;">
                    <div class="slot-name" style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(slot.name)}</div>
                    <div class="slot-meta" style="font-size: 0.85em; color: #666;">${slot.width}×${slot.height} • ${slot.colorCount} colors • ${dateStr}</div>
                </div>
                <button class="slot-delete" title="Delete" style="padding: 6px; background: none; border: none; cursor: pointer; color: #666; opacity: 0.6;" data-id="${slot.id}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            `;

            const infoDiv = item.querySelector('.slot-info');
            infoDiv.onclick = () => loadProjectFromSlot(slot.id);

            const deleteBtn = item.querySelector('.slot-delete');
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                showDeleteSlotDialog(slot.id, slot.name);
            };

            item.oncontextmenu = (e) => {
                e.preventDefault();
                showDeleteSlotDialog(slot.id, slot.name);
            };

            slotsList.appendChild(item);
        });
    } catch (err) {
        console.error('Failed to load save slots:', err);
        slotsList.innerHTML = '<div style="padding: 16px; text-align: center; color: #dc3545;">Error loading saved projects.</div>';
    }
}

export async function saveCurrentProject(name) {
    let exportDmcGrid = state.mappedDmcGrid;

    if (state.mappedRgbGrid) {
        exportDmcGrid = getLiveDmcGridFromRgb(state.mappedRgbGrid) || exportDmcGrid;
    }

    if (!exportDmcGrid) {
        alert('No pattern data available to save.');
        return;
    }

    const h = exportDmcGrid.length;
    const w = exportDmcGrid[0]?.length || 0;

    const counts = getColorCounts(exportDmcGrid);
    const colorCount = counts ? counts.size : 0;

    const stampedRgbGrid = mappingConfig.stampedMode ? buildStampedRgbGrid(exportDmcGrid) : null;

    const palette = loadedOxsPalette || DMC_RGB;

    const oxsData = exportOXS(
        exportDmcGrid,
        palette,
        `${name}.oxs`,
        stampedRgbGrid,
        state.backstitchGrid,
        overlayImage,
        true
    );

    const metadata = {
        width: w,
        height: h,
        colorCount: colorCount,
        palette: palette,
        referenceImageData: overlayImage
    };

    await saveSaveSlot(name, oxsData, metadata);

    await refreshSaveSlotsList();
}

export async function loadProjectFromSlot(slotId) {
    try {
        const slot = await loadSaveSlot(slotId);
        if (!slot) {
            alert('Failed to load project. The saved data may be corrupted.');
            return;
        }

        const dropdown = document.getElementById('saveSlotsDropdown');
        if (dropdown) dropdown.style.display = 'none';

        if (!slot.oxsData) {
            alert('No project data found in this save slot.');
            return;
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(slot.oxsData, 'text/xml');

        const width = parseInt(xmlDoc.querySelector('properties')?.getAttribute('chartwidth') || '50');
        const height = parseInt(xmlDoc.querySelector('properties')?.getAttribute('chartheight') || '50');

        const paletteItems = xmlDoc.querySelectorAll('palette_item');
        const dmcPalette = {};

        paletteItems.forEach(item => {
            const num = item.getAttribute('number');
            const name = item.getAttribute('name');
            const color = item.getAttribute('color');

            if (num && num.startsWith('DMC ')) {
                const code = num.replace('DMC ', '');
                const rgb = [
                    parseInt(color.substring(0, 2), 16),
                    parseInt(color.substring(2, 4), 16),
                    parseInt(color.substring(4, 6), 16)
                ];
                dmcPalette[code] = { name, rgb };
            }
        });

        const stitchElements = xmlDoc.querySelectorAll('stitch');
        const dmcGrid = Array.from({ length: height }, () => Array(width).fill('0'));

        stitchElements.forEach(stitch => {
            const x = parseInt(stitch.getAttribute('x'));
            const y = parseInt(stitch.getAttribute('y'));
            const palindex = parseInt(stitch.getAttribute('palindex'));

            if (y < height && x < width) {
                let code = '0';
                if (palindex > 0) {
                    const palItem = paletteItems[palindex];
                    if (palItem) {
                        const num = palItem.getAttribute('number');
                        if (num && num.startsWith('DMC ')) {
                            code = num.replace('DMC ', '');
                        }
                    }
                }
                dmcGrid[y][x] = code;
            }
        });

        const rgbGrid = Array.from({ length: height }, () => Array(width).fill([255, 255, 255]));
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const code = dmcGrid[y][x];
                if (code !== '0' && dmcPalette[code]) {
                    rgbGrid[y][x] = [...dmcPalette[code].rgb];
                }
            }
        }

        const backstitchElements = xmlDoc.querySelectorAll('backstitch');
        const backstitchLines = [];

        backstitchElements.forEach(bs => {
            const x1 = parseFloat(bs.getAttribute('x1'));
            const y1 = parseFloat(bs.getAttribute('y1'));
            const x2 = parseFloat(bs.getAttribute('x2'));
            const y2 = parseFloat(bs.getAttribute('y2'));
            const palindex = parseInt(bs.getAttribute('palindex'));

            let color = [0, 0, 0];
            if (palindex > 0) {
                const palItem = paletteItems[palindex];
                if (palItem) {
                    const bscolor = palItem.getAttribute('bscolor') || palItem.getAttribute('color');
                    if (bscolor && bscolor.length === 6) {
                        color = [
                            parseInt(bscolor.substring(0, 2), 16),
                            parseInt(bscolor.substring(2, 4), 16),
                            parseInt(bscolor.substring(4, 6), 16)
                        ];
                    }
                }
            }

            backstitchLines.push({
                color: color,
                points: [[x1, y1], [x2, y2]]
            });
        });

        let referenceImageData = null;
        const refImageEl = xmlDoc.querySelector('referenceImageData');
        if (refImageEl && refImageEl.textContent) {
            referenceImageData = refImageEl.textContent.trim();
        }

        isOxsLoaded = true;
        loadedOxsPalette = dmcPalette;
        currentImage = null;
        referenceImage = null;
        overlayImage = null;
        hasBackstitchEdits = false;

        state.clear();
        userEditDiff.clear();
        lastBaselineGrid = null;
        lastBaselineDmcGrid = null;

        state.originalImageURL = null;

        sendToCanvas('INIT', { width, height });

        state.mappedDmcGrid = dmcGrid;
        state.mappedRgbGrid = rgbGrid;

        sendToCanvas('UPDATE_GRID', rgbGrid);

        if (backstitchLines.length > 0) {
            sendToCanvas('LOAD_BACKSTITCH', backstitchLines);
        }

        sendToCanvas('TOGGLE_REFERENCE', false);

        if (referenceImageData) {
            const img = new Image();
            img.onload = () => {
                overlayImage = referenceImageData;
                sendToCanvas('SET_REFERENCE_IMAGE', {
                    imageData: referenceImageData,
                    width: img.width,
                    height: img.height
                });

                const refOpacity = document.getElementById('referenceOpacity');
                const refOpacityVal = document.getElementById('referenceOpacityVal');
                if (refOpacity) refOpacity.value = 0;
                if (refOpacityVal) refOpacityVal.textContent = '0%';
                sendToCanvas('SET_REFERENCE_OPACITY', 0);
                sendToCanvas('TOGGLE_REFERENCE', true);
            };
            img.src = referenceImageData;
        }

        const usedCodes = Object.keys(dmcPalette);
        renderPalette(usedCodes);

        updateThreadsTableFromGrid();
        updatePatternSizeDisplay();

    } catch (err) {
        console.error('Failed to load project:', err);
        alert('Failed to load project: ' + err.message);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

import { currentImage, referenceImage, lastBaselineGrid, lastBaselineDmcGrid, updateThreadsTableFromGrid } from './state.js';
import { getDmcName } from './constants.js';