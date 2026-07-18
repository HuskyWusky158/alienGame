function defaultDispose(resource) {
  if (resource && typeof resource.dispose === 'function') resource.dispose();
}

/**
 * Cache for shared geometries, materials, textures, and other disposable data.
 * Use getOrCreate for app-lifetime resources, or acquire when a region needs a
 * reference-counted lease that protects the resource from early eviction.
 */
export class SharedResourceCache {
  constructor({ dispose = defaultDispose, autoDisposeUnused = false } = {}) {
    if (typeof dispose !== 'function') throw new TypeError('default disposer must be a function');
    this.defaultDispose = dispose;
    this.autoDisposeUnused = autoDisposeUnused;
    this.entries = new Map();
  }

  get size() {
    return this.entries.size;
  }

  has(key) {
    return this.entries.has(key);
  }

  peek(key) {
    return this.entries.get(key)?.value;
  }

  getRefCount(key) {
    return this.entries.get(key)?.refs ?? 0;
  }

  getOrCreate(key, factory, options = {}) {
    const existing = this.entries.get(key);
    if (existing) return existing.value;
    if (typeof factory !== 'function') throw new TypeError('resource factory must be a function');
    if (options.dispose !== undefined && typeof options.dispose !== 'function') {
      throw new TypeError('resource disposer must be a function');
    }
    const value = factory();
    if (value == null) throw new TypeError('resource factory must return a value');
    this.entries.set(key, {
      value,
      refs: 0,
      dispose: options.dispose || this.defaultDispose,
      autoDispose: options.autoDispose ?? this.autoDisposeUnused,
    });
    return value;
  }

  acquire(key, factory, options = {}) {
    const value = this.getOrCreate(key, factory, options);
    const entry = this.entries.get(key);
    entry.refs += 1;
    let released = false;
    const cache = this;
    return Object.freeze({
      key,
      value,
      get released() {
        return released;
      },
      release() {
        if (released) return false;
        released = true;
        cache.releaseEntry(key, entry);
        return true;
      },
    });
  }

  releaseEntry(key, expectedEntry) {
    const entry = this.entries.get(key);
    if (!entry || entry !== expectedEntry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0 && entry.autoDispose) this.dispose(key);
  }

  dispose(key, { force = false } = {}) {
    const entry = this.entries.get(key);
    if (!entry || (!force && entry.refs > 0)) return false;
    this.entries.delete(key);
    entry.dispose(entry.value, key);
    return true;
  }

  disposeUnused() {
    let disposed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.refs === 0 && this.dispose(key)) disposed += 1;
    }
    return disposed;
  }

  disposeAll({ force = false } = {}) {
    let disposed = 0;
    for (const key of [...this.entries.keys()]) {
      if (this.dispose(key, { force })) disposed += 1;
    }
    return disposed;
  }

  getStats() {
    let referenced = 0;
    let references = 0;
    this.entries.forEach((entry) => {
      if (entry.refs > 0) referenced += 1;
      references += entry.refs;
    });
    return Object.freeze({
      resources: this.entries.size,
      referenced,
      unused: this.entries.size - referenced,
      references,
    });
  }
}

export function createResourceCache(options) {
  return new SharedResourceCache(options);
}
