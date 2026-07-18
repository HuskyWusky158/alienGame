const QUALITY_TIERS = Object.freeze(['low', 'medium', 'high']);

export const QUALITY_MODES = Object.freeze(['auto', ...QUALITY_TIERS]);

export const QUALITY_PRESETS = deepFreeze({
  high: {
    pixelRatioFloor: 1,
    pixelRatioCeiling: 1.75,
    pixelRatioScale: 1,
    particleScale: 1,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    shadowUpdateHz: 30,
    activeUpdateHz: 60,
    ambientUpdateHz: 30,
    distantUpdateHz: 8,
    terrainDetail: 1,
    creatureDetail: 1,
    lodDistanceScale: 1,
    materialQuality: 'high',
  },
  medium: {
    pixelRatioFloor: 0.85,
    pixelRatioCeiling: 1.3,
    pixelRatioScale: 0.9,
    particleScale: 0.65,
    shadowsEnabled: false,
    shadowMapSize: 1024,
    shadowUpdateHz: 0,
    activeUpdateHz: 45,
    ambientUpdateHz: 30,
    distantUpdateHz: 5,
    terrainDetail: 0.78,
    creatureDetail: 0.72,
    lodDistanceScale: 0.88,
    materialQuality: 'medium',
  },
  low: {
    pixelRatioFloor: 0.7,
    pixelRatioCeiling: 1,
    pixelRatioScale: 0.75,
    particleScale: 0.38,
    shadowsEnabled: false,
    shadowMapSize: 512,
    shadowUpdateHz: 0,
    activeUpdateHz: 30,
    ambientUpdateHz: 24,
    distantUpdateHz: 3,
    terrainDetail: 0.55,
    creatureDetail: 0.45,
    lodDistanceScale: 0.72,
    materialQuality: 'low',
  },
});

const DEFAULT_STORAGE_KEY = 'alien-game:quality:v1';

function deepFreeze(value) {
  Object.values(value).forEach((child) => {
    if (child && typeof child === 'object' && !Object.isFrozen(child)) deepFreeze(child);
  });
  return Object.freeze(value);
}

function isQualityMode(value) {
  return QUALITY_MODES.includes(value);
}

function isQualityTier(value) {
  return QUALITY_TIERS.includes(value);
}

function capTier(tier, ceiling) {
  return QUALITY_TIERS[Math.min(QUALITY_TIERS.indexOf(tier), QUALITY_TIERS.indexOf(ceiling))];
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function getDefaultStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readPreference(storage, key) {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Creates a browser-safe quality controller. "auto" uses sustained FPS windows
 * to move between the concrete high, medium and low settings.
 */
export function createQualityManager(options = {}) {
  return new QualityManager(options);
}

export class QualityManager {
  constructor(options = {}) {
    this.storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
    this.storage = options.storage === undefined ? getDefaultStorage() : options.storage;
    this.persist = options.persist !== false;
    this.persistAutoTier = options.persistAutoTier !== false;
    this.autoTierCeiling = isQualityTier(options.autoTierCeiling) ? options.autoTierCeiling : 'high';
    this.sampleWindowSeconds = options.sampleWindowSeconds ?? 2.25;
    // Protect frame pacing before a scene falls into visibly choppy territory.
    // Two sustained sub-50 windows still avoid reacting to one shader-compile
    // hitch, while dense 45–49 FPS scenes can move to the 60 FPS medium tier.
    this.downshiftFps = options.downshiftFps ?? 50;
    this.upshiftFps = options.upshiftFps ?? 57;
    this.downshiftSamples = options.downshiftSamples ?? 2;
    this.upshiftSamples = options.upshiftSamples ?? 4;
    this.maxFrameDelta = options.maxFrameDelta ?? 0.25;
    this.ignoreFrameAbove = options.ignoreFrameAbove ?? 0.2;

    if (!(this.sampleWindowSeconds > 0)) throw new RangeError('sampleWindowSeconds must be greater than zero');
    if (!(this.ignoreFrameAbove > 0)) throw new RangeError('ignoreFrameAbove must be greater than zero');
    if (!(this.downshiftFps < this.upshiftFps)) throw new RangeError('downshiftFps must be lower than upshiftFps');
    if (!(this.downshiftSamples >= 1) || !(this.upshiftSamples >= 1)) {
      throw new RangeError('adaptation sample counts must be at least one');
    }

    const preference = this.persist ? readPreference(this.storage, this.storageKey) : null;
    const requestedMode = preference?.mode ?? options.initialMode ?? 'auto';
    const initialAutoTier = preference?.autoTier ?? options.initialAutoTier ?? 'high';
    this.mode = isQualityMode(requestedMode) ? requestedMode : 'auto';
    this.autoTier = capTier(isQualityTier(initialAutoTier) ? initialAutoTier : 'high', this.autoTierCeiling);
    this.tier = this.mode === 'auto' ? this.autoTier : this.mode;
    this.devicePixelRatio = Math.max(0.5, options.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1);
    this.lastFps = null;
    this.lowSamples = 0;
    this.highSamples = 0;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    this.listeners = new Set();
    this.settings = this.createSettings();
  }

  createSettings() {
    const preset = QUALITY_PRESETS[this.tier];
    const pixelRatio = clamp(
      this.devicePixelRatio * preset.pixelRatioScale,
      preset.pixelRatioFloor,
      preset.pixelRatioCeiling,
    );
    return Object.freeze({
      tier: this.tier,
      ...preset,
      pixelRatio,
    });
  }

  getSnapshot() {
    return Object.freeze({
      mode: this.mode,
      tier: this.tier,
      settings: this.settings,
      lastFps: this.lastFps,
      lowSamples: this.lowSamples,
      highSamples: this.highSamples,
    });
  }

  subscribe(listener, { emitCurrent = true } = {}) {
    if (typeof listener !== 'function') throw new TypeError('quality listener must be a function');
    this.listeners.add(listener);
    if (emitCurrent) listener(this.getSnapshot(), 'subscribe');
    return () => this.listeners.delete(listener);
  }

  emit(reason) {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot, reason));
  }

  setMode(mode, { persist = true } = {}) {
    if (!isQualityMode(mode)) throw new RangeError(`unknown quality mode: ${mode}`);
    const previousMode = this.mode;
    const previousTier = this.tier;
    this.mode = mode;
    this.tier = mode === 'auto' ? this.autoTier : mode;
    this.settings = this.createSettings();
    this.resetAdaptation();
    if (persist) this.savePreference();
    if (previousMode !== this.mode || previousTier !== this.tier) this.emit('mode-change');
    return this.getSnapshot();
  }

  setAutoTier(tier, { persist = true } = {}) {
    if (!isQualityTier(tier)) throw new RangeError(`unknown quality tier: ${tier}`);
    const effectiveTier = capTier(tier, this.autoTierCeiling);
    const changed = this.autoTier !== effectiveTier || (this.mode === 'auto' && this.tier !== effectiveTier);
    this.autoTier = effectiveTier;
    if (this.mode === 'auto') {
      this.tier = effectiveTier;
      this.settings = this.createSettings();
      this.resetAdaptation();
    }
    if (persist) this.savePreference();
    if (changed && this.mode === 'auto') this.emit('auto-tier-change');
    return this.getSnapshot();
  }

  setDevicePixelRatio(devicePixelRatio) {
    if (!(devicePixelRatio > 0)) throw new RangeError('devicePixelRatio must be greater than zero');
    if (Math.abs(devicePixelRatio - this.devicePixelRatio) < 0.001) return this.getSnapshot();
    this.devicePixelRatio = devicePixelRatio;
    this.settings = this.createSettings();
    this.emit('pixel-ratio-change');
    return this.getSnapshot();
  }

  /**
   * Accumulates frame deltas and evaluates one FPS sample per configured window.
   * Returns null until a complete window is available.
   */
  recordFrame(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return null;
    // Shader compilation, tab restoration, and other isolated long tasks are
    // not sustained GPU pressure. Starting a fresh sample after those frames
    // prevents one cold path from immediately resizing the renderer.
    if (deltaSeconds > this.ignoreFrameAbove) {
      this.resetAdaptation();
      return null;
    }
    this.sampleTime += Math.min(deltaSeconds, this.maxFrameDelta);
    this.sampleFrames += 1;
    if (this.sampleTime < this.sampleWindowSeconds) return null;
    const fps = this.sampleFrames / this.sampleTime;
    this.sampleTime = 0;
    this.sampleFrames = 0;
    return this.reportFps(fps);
  }

  /**
   * Feeds an already-aggregated FPS value into the hysteresis controller.
   * Useful when a game already owns its own performance sampling loop.
   */
  reportFps(fps) {
    if (!Number.isFinite(fps) || fps <= 0) throw new RangeError('fps must be greater than zero');
    this.lastFps = fps;
    const signal = fps < this.downshiftFps
      ? 'pressure'
      : fps > this.upshiftFps ? 'headroom' : 'stable';
    let action = 'none';
    let changed = false;

    if (this.mode === 'auto') {
      if (signal === 'pressure') {
        this.lowSamples += 1;
        this.highSamples = 0;
        if (this.lowSamples >= this.downshiftSamples) {
          const index = QUALITY_TIERS.indexOf(this.tier);
          if (index > 0) {
            this.autoTier = QUALITY_TIERS[index - 1];
            this.tier = this.autoTier;
            this.settings = this.createSettings();
            action = 'downshift';
            changed = true;
          } else action = 'minimum';
          this.lowSamples = 0;
        }
      } else if (signal === 'headroom') {
        this.highSamples += 1;
        this.lowSamples = 0;
        if (this.highSamples >= this.upshiftSamples) {
          const index = QUALITY_TIERS.indexOf(this.tier);
          const ceilingIndex = QUALITY_TIERS.indexOf(this.autoTierCeiling);
          if (index < ceilingIndex) {
            this.autoTier = QUALITY_TIERS[index + 1];
            this.tier = this.autoTier;
            this.settings = this.createSettings();
            action = 'upshift';
            changed = true;
          } else action = 'maximum';
          this.highSamples = 0;
        }
      } else {
        this.lowSamples = 0;
        this.highSamples = 0;
      }
    }

    if (changed) {
      this.savePreference();
      this.emit(action);
    }
    return Object.freeze({ fps, signal, action, changed, snapshot: this.getSnapshot() });
  }

  resetAdaptation() {
    this.lowSamples = 0;
    this.highSamples = 0;
    this.sampleTime = 0;
    this.sampleFrames = 0;
  }

  savePreference() {
    if (!this.persist || !this.storage) return false;
    const preference = { version: 1, mode: this.mode };
    if (this.persistAutoTier) preference.autoTier = this.autoTier;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(preference));
      return true;
    } catch {
      return false;
    }
  }

  clearSavedPreference() {
    if (!this.storage) return false;
    try {
      this.storage.removeItem(this.storageKey);
      return true;
    } catch {
      return false;
    }
  }

  destroy() {
    this.listeners.clear();
    this.resetAdaptation();
  }
}
