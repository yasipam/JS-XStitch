const ort = window.ort;

const modelCache = {
    dbName: 'toolthump-model-cache',
    storeName: 'onnx-models',
    db: null,
    version: 1,

    openDB: function() {
        return new Promise((resolve, reject) => {
            if (this.db) return resolve(this.db);

            const request = indexedDB.open(this.dbName, this.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName);
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error("IndexedDB error:", event.target.error);
                reject(event.target.error);
            };
        });
    },

    get: async function(key) {
        try {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(key);
                request.onsuccess = () => resolve(request.result);
                request.onerror = (event) => reject(event.target.error);
            });
        } catch (error) {
            console.error("Failed to get model from cache:", error);
            return null;
        }
    },

    set: async function(key, value) {
        try {
            const db = await this.openDB();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.put(value, key);
                request.onsuccess = () => resolve();
                request.onerror = (event) => reject(event.target.error);
            });
        } catch (error) {
            console.error("Failed to set model in cache:", error);
        }
    }
};

const onnxModel = {
    ortSession: null,
    modelPath: 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/main/onnx/model.onnx',
    modelInputSize: 320,
    isInitialized: false,
    inputName: 'input.1',
    outputName: 'sigmoid.0',

    init: async function(statusCallback, progressCallback) {
        if (this.isInitialized) return true;

        try {
            if (!ort || !ort.InferenceSession) {
                throw new Error('ONNX Runtime not loaded. ort=' + typeof ort);
            }
            
            statusCallback('loading', 'Initializing AI model...');
            
            let modelBuffer = await modelCache.get(this.modelPath);

            if (modelBuffer) {
                statusCallback('loading', 'Loading model from cache...');
            } else {
                statusCallback('loading', 'Downloading AI model (4.5 MB)...', true);
                const response = await fetch(this.modelPath);
                if (!response.ok) throw new Error(`Failed to fetch model: ${response.statusText}`);

                const reader = response.body.getReader();
                const contentLength = +response.headers.get('content-length');
                const chunks = [];
                let loadedSize = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    loadedSize += value.length;
                    if (contentLength && progressCallback) {
                        const progress = Math.round((loadedSize / contentLength) * 100);
                        progressCallback(progress);
                    }
                }

                const blob = new Blob(chunks);
                modelBuffer = await blob.arrayBuffer();

                modelCache.set(this.modelPath, modelBuffer.slice(0));
            }

            statusCallback('loading', 'Creating ONNX session...');
            console.log("Creating session with modelBuffer size:", modelBuffer.byteLength);
            
            this.ortSession = await ort.InferenceSession.create(modelBuffer);

            this.inputName = this.ortSession.inputNames[0];
            this.outputName = this.ortSession.outputNames[0];
            console.log("ONNX session initialized. Input:", this.inputName, "Output:", this.outputName);

            statusCallback('clear');
            const warningEl = document.getElementById('tool-warning');
            if (warningEl) warningEl.style.display = 'none';

            console.log("ONNX session initialized successfully.");
            this.isInitialized = true;
            return true;

        } catch (error) {
            console.error("Failed to initialize ONNX session:", error);
            statusCallback('error', 'Failed to load the AI model. Please refresh and try again.');
            this.isInitialized = false;
            modelCache.set(this.modelPath, undefined);
            return false;
        }
    },

    run: async function(image) {
        if (!this.isInitialized || !image) return null;

        const inputTensor = this._preprocess(image);
        const results = await this.ortSession.run({
            [this.inputName]: inputTensor
        });
        const outputTensor = results[this.outputName];
        return this._postprocess(outputTensor, image.naturalWidth || image.width, image.naturalHeight || image.height, image);
    },

    _preprocess: function(image) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const size = this.modelInputSize;
        canvas.width = size;
        canvas.height = size;
        ctx.drawImage(image, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        const float32Data = new Float32Array(3 * size * size);
        const mean = [0.485, 0.456, 0.406];
        const std = [0.229, 0.224, 0.225];

        for (let i = 0; i < size * size; i++) {
            for (let j = 0; j < 3; j++) {
                float32Data[i + j * size * size] = (data[i * 4 + j] / 255 - mean[j]) / std[j];
            }
        }
        return new ort.Tensor('float32', float32Data, [1, 3, size, size]);
    },

    _normPRED: function(d) {
        const mi = Math.min(...d);
        const ma = Math.max(...d);
        const range = ma - mi;
        return range === 0 ? d.map(() => 0) : d.map(i => (i - mi) / range);
    },

    _postprocess: function(tensor, originalWidth, originalHeight, originalImage) {
        const pred = this._normPRED(tensor.data);
        const size = this.modelInputSize;

        const tempMaskCanvas = document.createElement('canvas');
        tempMaskCanvas.width = size;
        tempMaskCanvas.height = size;
        const tempMaskCtx = tempMaskCanvas.getContext('2d');
        const maskImageData = tempMaskCtx.createImageData(size, size);

        for (let i = 0; i < size * size; i++) {
            maskImageData.data[i * 4 + 3] = pred[i] * 255;
        }
        tempMaskCtx.putImageData(maskImageData, 0, 0);

        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = originalWidth;
        maskCanvas.height = originalHeight;
        const storedMaskCtx = maskCanvas.getContext('2d');
        storedMaskCtx.imageSmoothingEnabled = true;
        storedMaskCtx.imageSmoothingQuality = 'high';
        storedMaskCtx.drawImage(tempMaskCanvas, 0, 0, originalWidth, originalHeight);

        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = originalWidth;
        resultCanvas.height = originalHeight;
        const ctx = resultCanvas.getContext('2d');
        ctx.drawImage(originalImage, 0, 0, originalWidth, originalHeight);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskCanvas, 0, 0, originalWidth, originalHeight);

        return {
            processedImage: resultCanvas,
            maskCanvas: maskCanvas
        };
    },

    applyMaskAdjust: function(originalMaskCanvas, adjustValue) {
        const srcWidth = originalMaskCanvas.width;
        const srcHeight = originalMaskCanvas.height;

        const adjustedMask = document.createElement('canvas');
        adjustedMask.width = srcWidth;
        adjustedMask.height = srcHeight;
        const adjustedMaskCtx = adjustedMask.getContext('2d');

        const baseRadius = Math.round(Math.abs(adjustValue) / 100 * 30);

        if (baseRadius <= 0) {
            adjustedMaskCtx.drawImage(originalMaskCanvas, 0, 0);
            return adjustedMask;
        }

        const MAX_DIM = 480;
        let scale = 1.0;
        let procWidth = srcWidth;
        let procHeight = srcHeight;

        if (procWidth > MAX_DIM || procHeight > MAX_DIM) {
            scale = (procWidth > procHeight) ? (MAX_DIM / procWidth) : (MAX_DIM / procHeight);
            procWidth = Math.round(srcWidth * scale);
            procHeight = Math.round(srcHeight * scale);
        }

        const radius = Math.max(1, Math.round(baseRadius * scale));
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = procWidth;
        tempCanvas.height = procHeight;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });

        tempCtx.drawImage(originalMaskCanvas, 0, 0, procWidth, procHeight);
        const srcData = tempCtx.getImageData(0, 0, procWidth, procHeight);
        const tempAlpha = new Uint8ClampedArray(procWidth * procHeight);
        const destData = new ImageData(procWidth, procHeight);
        const isErode = adjustValue < 0;

        for (let y = 0; y < procHeight; y++) {
            for (let x = 0; x < procWidth; x++) {
                let bestAlpha = isErode ? 255 : 0;
                for (let i = -radius; i <= radius; i++) {
                    const nx = Math.max(0, Math.min(procWidth - 1, x + i));
                    const alpha = srcData.data[(y * procWidth + nx) * 4 + 3];
                    if (isErode) {
                        bestAlpha = Math.min(bestAlpha, alpha);
                    } else {
                        bestAlpha = Math.max(bestAlpha, alpha);
                    }
                }
                tempAlpha[y * procWidth + x] = bestAlpha;
            }
        }

        for (let y = 0; y < procHeight; y++) {
            for (let x = 0; x < procWidth; x++) {
                let bestAlpha = isErode ? 255 : 0;
                for (let j = -radius; j <= radius; j++) {
                    const ny = Math.max(0, Math.min(procHeight - 1, y + j));
                    const alpha = tempAlpha[ny * procWidth + x];
                    if (isErode) {
                        bestAlpha = Math.min(bestAlpha, alpha);
                    } else {
                        bestAlpha = Math.max(bestAlpha, alpha);
                    }
                }
                destData.data[(y * procWidth + x) * 4 + 3] = bestAlpha;
            }
        }
        tempCtx.putImageData(destData, 0, 0);

        adjustedMaskCtx.imageSmoothingEnabled = true;
        adjustedMaskCtx.imageSmoothingQuality = 'high';
        adjustedMaskCtx.drawImage(tempCanvas, 0, 0, srcWidth, srcHeight);

        return adjustedMask;
    },

    applyMaskAndGetImage: function(originalImage, maskCanvas) {
        const originalWidth = originalImage.width;
        const originalHeight = originalImage.height;

        const resultCanvas = document.createElement('canvas');
        resultCanvas.width = originalWidth;
        resultCanvas.height = originalHeight;
        const ctx = resultCanvas.getContext('2d');
        ctx.drawImage(originalImage, 0, 0, originalWidth, originalHeight);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(maskCanvas, 0, 0, originalWidth, originalHeight);

        return resultCanvas;
    }
};

export { modelCache, onnxModel };