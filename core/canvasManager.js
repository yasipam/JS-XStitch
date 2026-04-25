import { EditorState } from "./state.js";
import { EditorEvents } from "./events.js";
import { ToolRegistry } from "./tools.js";
let state;
let events;
let syncTimeout;

/**
 * Recalculates the camera view to center the grid.
 * Prevents "ghost zooms" when switching modes.
 */
function resetToBestFit() {
    if (!state) return;
    const grid = state.pixelGrid;
    const bestZoom = Math.min(
        (window.innerWidth - 40) / grid.width,
        (window.innerHeight - 40) / grid.height,
        20
    );
    state.setZoom(bestZoom);
    state.setPan(
        (window.innerWidth - grid.width * bestZoom) / 2,
        (window.innerHeight - grid.height * bestZoom) / 2
    );
}

window.addEventListener('message', (e) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'INIT':
            if (!state) {
                const canvases = {
                    ref: document.getElementById('refLayer'),
                    bg: document.getElementById('bgLayer'),
                    grid: document.getElementById('gridLayer'),
                    refOverlay: document.getElementById('refOverlayLayer'),
                    ui: document.getElementById('uiLayer')
                };
                state = new EditorState(canvases);
                events = new EditorEvents(canvases.ui, state);

                state.on("gridChanged", () => {
                    // Immediate UI update for the iframe itself
                    window.parent.postMessage({
                        type: 'REPORT_GRID_STATS',
                        payload: { count: state.getUniqueColorCount(), threadStats: state.getThreadStats() }
                    }, '*');

                    // Debounced heavy sync to parent
                    clearTimeout(syncTimeout);
                    syncTimeout = setTimeout(() => {
                        window.parent.postMessage({
                            type: 'SYNC_GRID_TO_PARENT',
                            payload: state.pixelGrid.grid
                        }, '*');
                    }, 250); // Delay sync until drawing pauses
                });
            }
            const newW = payload.width;
            const newH = payload.height;
            const needsResize = !state.pixelGrid || state.pixelGrid.width !== newW || state.pixelGrid.height !== newH;
            if (needsResize) {
                state.pixelGrid.resize(newW, newH, [255, 255, 255], false);
            }

            // If DMC grid included, load it
            if (payload.dmcGrid) {
                state.mappedDmcGrid = payload.dmcGrid;
            }

            resetToBestFit();
            break;

        case 'UPDATE_GRID':
            if (state && payload) {
                state.loadGrid(payload);

                Object.values(ToolRegistry).forEach(tool => {
                    tool.lastGx = undefined;
                    tool.lastGy = undefined;
                });

                if (events) events.state = state;
            }
            break;

        case 'CMD_UNDO': if (state) state.undo(); break;
        case 'CMD_REDO': if (state) state.redo(); break;
        case 'CMD_CLEAR': if (state) state.clearCanvasAction(); break;
        case 'SET_TOOL': if (state) state.setTool(payload); break;
        case 'SET_COLOR': if (state) state.setColor(payload); break;
        case 'CMD_RESET_VIEW': if (state) resetToBestFit(); break;

        case 'CMD_ZOOM':
            if (state) {
                const cx = window.innerWidth / 2;
                const cy = window.innerHeight / 2;
                ToolRegistry.zoom.applyZoom(state, payload > 0 ? 1 : -1, cx, cy);
            }
            break;

        case 'CMD_KEYDOWN':
            if (events) {
                events.onKeyDown({
                    ctrlKey: payload.ctrlKey, metaKey: payload.metaKey,
                    shiftKey: payload.shiftKey, key: payload.key,
                    preventDefault: () => { }
                });
            }
            break;

        case 'SET_REFERENCE_IMAGE':
            if (state && payload) {
                state.setReferenceImage(payload.imageData, payload.width, payload.height);
            }
            break;

        case 'TOGGLE_REFERENCE':
            if (state) {
                state.toggleReference(payload);
            }
            break;

        case 'SET_REFERENCE_OPACITY':
            if (state) {
                state.setReferenceOpacity(payload);
            }
            break;

        case 'SET_REFERENCE_POSITION':
            if (state) {
                state.setReferencePosition(payload);
            }
            break;

        case 'SET_TOOL_SIZE':
            if (state && payload) {
                state.setToolSize(payload.tool, payload.size);
                const tool = ToolRegistry[payload.tool];
                if (tool) {
                    tool.size = payload.size;
                }
            }
            break;

        case 'SET_DMC_GRID':
            if (state && payload) {
                state.mappedDmcGrid = payload;
            }
            break;
    }
});