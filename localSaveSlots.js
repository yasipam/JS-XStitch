const DB_NAME = 'KrissKrossSaves';
const DB_VERSION = 1;
const STORE_NAME = 'saveSlots';

let db = null;

async function openDB() {
    return new Promise((resolve, reject) => {
        if (db) {
            resolve(db);
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

export async function getAllSaveSlots() {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const slots = request.result.map(slot => ({
                id: slot.id,
                name: slot.name,
                timestamp: slot.timestamp,
                width: slot.width,
                height: slot.height,
                colorCount: slot.colorCount
            })).sort((a, b) => b.timestamp - a.timestamp);
            resolve(slots);
        };

        request.onerror = () => reject(request.error);
    });
}

export async function saveSaveSlot(name, oxsData, metadata) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        const slot = {
            name: name,
            timestamp: Date.now(),
            oxsData: oxsData,
            width: metadata.width,
            height: metadata.height,
            colorCount: metadata.colorCount,
            palette: metadata.palette,
            referenceImageData: metadata.referenceImageData || null
        };

        const request = store.add(slot);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function loadSaveSlot(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result);
            } else {
                resolve(null);
            }
        };

        request.onerror = () => reject(request.error);
    });
}

export async function deleteSaveSlot(id) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
    });
}

export async function updateSaveSlotName(id, newName) {
    const database = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const slot = getRequest.result;
            if (!slot) {
                resolve(false);
                return;
            }
            slot.name = newName;
            const putRequest = store.put(slot);
            putRequest.onsuccess = () => resolve(true);
            putRequest.onerror = () => reject(putRequest.error);
        };

        getRequest.onerror = () => reject(getRequest.error);
    });
}