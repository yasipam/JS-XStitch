// parent/index.js
// -----------------------------------------------------------------------------
// Main entry point - imports and re-exports all parent modules
// Preserves original execution order for backward compatibility
// -----------------------------------------------------------------------------

// Tier 1: Constants and imports (must execute first)
import * as constants from './constants.js';
export { constants };

// Tier 2: Global state
import * as state from './state.js';
export { state };

// Tier 3: Core functions
import * as canvas from './canvas.js';
export { sendToCanvas } from './canvas.js';

import * as tools from './tools.js';
export { switchTool } from './tools.js';

import * as mapping from './mapping.js';
export { runMapping, captureUserEdits, getRgbFromCode, buildStampedRgbGrid, enforceMaxColors, applyFilteringToGrid, patchDmcGrid, reapplyFiltering } from './mapping.js';

import * as crop from './crop.js';
export { showCropOverlay, handleCrop, clearCropBox } from './crop.js';

import * as emptyCanvas from './empty-canvas.js';
export { createEmptyCanvas, resizeEmptyCanvas, updateSidebarFromEmptyCanvas } from './empty-canvas.js';

import * as uiRender from './ui-render.js';
export { renderPalette, renderThreadsTable, renderBackstitchThreadsTable, updateSidebarFromState, updatePatternSizeDisplay } from './ui-render.js';

import * as oxs from './oxs.js';
export { loadOxsPattern, updatePaletteFromOxs, applyOxsPostProcessing, applyOxsPostProcessingWithUndo, rebuildRgbFromDmc, updateSidebarFromOxsGrid, getLiveDmcGridFromRgb, applyAntiNoiseToOxsGrid, applyMergeToOxsGrid, updatePaletteAfterPostProcess, updateThreadsTableFromGrid } from './oxs.js';

import * as exportModule from './export.js';
export { setupExportButtons, exportPixelPNG } from './export.js';

import * as saveSlots from './save-slots.js';
export { setupFileDropdown, refreshSaveSlotsList, saveCurrentProject, loadProjectFromSlot } from './save-slots.js';

import * as uiSetup from './ui-setup.js';
export {
    setupCollapsiblePanels, setupUpload, setupOxsUpload, setupMaskAdjustSlider,
    setupBgRemover, setupNewCanvas, setMappingControlsEnabled, setupToolButtons,
    setLeftSidebarDisabled, setSidebarControlsDisabled, setupModeToggle,
    setupBackstitchTools, setupEditHistory, setupResetControls
} from './ui-setup.js';

// The rest of the setup functions are in bootstrap.js
import * as bootstrap from './bootstrap.js';
export { setupMappingControls, setupZoomButtons, setupReferenceButton, setupPaletteUI, initApp, openTab } from './bootstrap.js';

// Re-export everything for convenience
export { constants, state, canvas, tools, mapping, crop, emptyCanvas, uiRender, oxs, exportModule, saveSlots, uiSetup, bootstrap };

// Log that parent modules are loaded
console.log("Parent modules loaded successfully");