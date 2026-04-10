const GLOBAL_MEMORY_STORES_KEY = '__owbMemoryStores';

function getGlobalMemoryStores() {
    if (!globalThis[GLOBAL_MEMORY_STORES_KEY]) {
        globalThis[GLOBAL_MEMORY_STORES_KEY] = new Map();
    }

    return globalThis[GLOBAL_MEMORY_STORES_KEY];
}

function getScopedMemoryStore(namespace) {
    const stores = getGlobalMemoryStores();
    if (!stores.has(namespace)) {
        stores.set(namespace, new Map());
    }

    return stores.get(namespace);
}

export function createInMemoryStateStore(namespace = 'default') {
    const store = getScopedMemoryStore(namespace);

    return {
        kind: 'memory',
        persistent: false,
        async get(key) {
            return store.has(key) ? store.get(key) : null;
        },
        async set(key, value) {
            store.set(key, value);
        },
        async delete(key) {
            store.delete(key);
        }
    };
}

export function createCloudflareKvStateStore(kv) {
    return {
        kind: 'cloudflare-kv',
        persistent: true,
        async get(key) {
            const value = await kv.get(key);
            return value ?? null;
        },
        async set(key, value) {
            await kv.put(key, value);
        },
        async delete(key) {
            await kv.delete(key);
        }
    };
}

export function createDenoKvStateStore(kv) {
    return {
        kind: 'deno-kv',
        persistent: true,
        async get(key) {
            const result = await kv.get([key]);
            return result.value ?? null;
        },
        async set(key, value) {
            await kv.set([key], value);
        },
        async delete(key) {
            await kv.delete([key]);
        }
    };
}

export function createStateStore(options = {}) {
    if (options.stateStore) {
        return options.stateStore;
    }

    if (options.cloudflareKv && typeof options.cloudflareKv.get === 'function') {
        return createCloudflareKvStateStore(options.cloudflareKv);
    }

    if (options.denoKv && typeof options.denoKv.get === 'function') {
        return createDenoKvStateStore(options.denoKv);
    }

    return createInMemoryStateStore(options.namespace || 'default');
}
