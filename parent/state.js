// parent/state.js
// -----------------------------------------------------------------------------
// Global state variables - must be initialized early
// -----------------------------------------------------------------------------

import { getDmcLabCache, dmcCodeToEntry, dmcCodeToRgb, codeToRgbMap } from './constants.js';

export let state;
export let events;
export let currentImage = null;
export let referenceImage = null;
export let overlayImage = null; // Manually uploaded reference image for overlay
export let bgRemoved = false; // Track if background was removed
export let pencilSize = 1;
export let eraserSize = 1;
export let lastBaselineGrid = null;
export let lastBaselineDmcGrid = null;

// Background removal mask state
export let originalMaskCanvas = null; // Raw AI mask from background removal
export let originalImageBeforeBgRemoval = null; // Original image before bg removal (for mask re-processing)

// OXS Import State
export let isOxsLoaded = false;
export let loadedOxsPalette = null; // Stores { code: { name, rgb } } from imported OXS
export let oxsBaselineDmcGrid = null; // Original DMC grid for OXS (to allow undo)
export let oxsBaselineRgbGrid = null; // Original RGB grid for OXS (to allow undo)
export let oxsBaselinePalette = null; // Original palette for OXS (to allow undo)

// Empty Canvas Drawing Mode
export let isEmptyCanvas = false; // True when user creates new canvas without image/OXS
export let hasEmptyCanvasEdits = false; // Tracks if user has drawn on empty canvas
export let hasBackstitchEdits = false; // Tracks if user has made backstitch edits

// CM Dimension Inputs
export let cmWidthInput = null;
export let cmHeightInput = null;
export let isUpdatingCmFromSlider = false;
export let isUpdatingSliderFromCm = false;

// MAPPING CONFIGURATION
export const mappingConfig = {
    maxSize: 80,
    maxColours: 30,
    mergeNearest: 1,
    brightnessInt: 0,
    saturationInt: 0,
    contrastInt: 0,
    biasGreenMagenta: 0,
    biasCyanRed: 0,
    biasBlueYellow: 0,
    reduceIsolatedStitches: false,
    antiNoise: 0,
    sharpenIntensity: 1,
    sharpenRadius: 2,
    minOccurrence: 1,
    stampedMode: false,
    stampedHue: 1,
    distanceMethod: "euclidean",
    ditherMode: "None",
    ditherStrength: 0,
    exportFabricCount: 14,
    exportMode: "filled",
    pixelArtMode: false
};

// Cache and state for mapping
export let cachedProjectPalette = null;
export let lastPaletteConfig = { maxSize: 0, maxColours: 0, image: null, distanceMethod: "" };
export let sidebarUpdateTimer = null;

// USER-EDIT DIFF LAYER
// Stores pixels the user has manually painted over the mapped baseline.
// Structure: Map< "x,y" -> [r,g,b] >
// Reset to empty on upload or explicit "Reset to original".
// Re-populated from SYNC_GRID_TO_PARENT by diffing the live canvas against
// the last known clean baseline (state.mappedRgbGrid).
export let userEditDiff = new Map();

// Save slots state
export let pendingSaveSlotId = null;
export let pendingDeleteSlotId = null;
export let fileDropdownOpen = false;

// Replace color dialog state
export let replaceColorFromRgb = null;
export let replaceColorFromCode = null;
export let replaceColorToRgb = null;
export let replaceColorToCode = null;
export let replaceDialogMode = 'pixel'; // 'pixel' or 'backstitch'

export let replaceBsFromColor = null;
export let replaceBsToColor = null;

// Context menu state
export let currentContextMenuPos = null;