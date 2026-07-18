import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityManager, QUALITY_MODES } from '../src/core/qualityManager.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('supports fixed and automatic quality modes', () => {
  assert.deepEqual(QUALITY_MODES, ['auto', 'low', 'medium', 'high']);
  const manager = createQualityManager({ initialMode: 'medium', persist: false, devicePixelRatio: 2 });

  assert.equal(manager.mode, 'medium');
  assert.equal(manager.settings.tier, 'medium');
  assert.equal(manager.settings.pixelRatio, 1.3);
  assert.equal(manager.settings.particleScale, 0.65);
  assert.equal(manager.settings.shadowMapSize, 1024);
  assert.equal(manager.settings.shadowsEnabled, false);
  assert.equal(manager.settings.ambientUpdateHz, 30);
});

test('persists the selected mode and restores it safely', () => {
  const storage = createStorage();
  const first = createQualityManager({ storage, initialMode: 'auto' });
  first.setMode('low');

  const restored = createQualityManager({ storage, initialMode: 'high' });
  assert.equal(restored.mode, 'low');
  assert.equal(restored.tier, 'low');
});

test('auto mode downshifts quickly and recovers with slower hysteresis', () => {
  const manager = createQualityManager({
    initialMode: 'auto',
    initialAutoTier: 'high',
    persist: false,
    downshiftSamples: 2,
    upshiftSamples: 4,
  });

  assert.equal(manager.reportFps(35).changed, false);
  assert.equal(manager.reportFps(35).action, 'downshift');
  assert.equal(manager.tier, 'medium');

  manager.reportFps(60);
  manager.reportFps(60);
  manager.reportFps(60);
  assert.equal(manager.tier, 'medium');
  assert.equal(manager.reportFps(60).action, 'upshift');
  assert.equal(manager.tier, 'high');
});

test('auto tier ceiling prevents high-quality oscillation', () => {
  const manager = createQualityManager({
    initialMode: 'auto',
    initialAutoTier: 'high',
    autoTierCeiling: 'medium',
    persist: false,
    upshiftSamples: 2,
  });

  assert.equal(manager.tier, 'medium');
  assert.equal(manager.reportFps(60).action, 'none');
  assert.equal(manager.reportFps(60).action, 'maximum');
  assert.equal(manager.tier, 'medium');
  manager.setAutoTier('high');
  assert.equal(manager.tier, 'medium');
});

test('stable samples reset adaptation streaks', () => {
  const manager = createQualityManager({
    initialMode: 'auto',
    initialAutoTier: 'high',
    persist: false,
    downshiftSamples: 2,
  });

  manager.reportFps(30);
  manager.reportFps(50);
  manager.reportFps(30);
  assert.equal(manager.tier, 'high');
  assert.equal(manager.lowSamples, 1);
});

test('recordFrame reports only after a complete sampling window', () => {
  const manager = createQualityManager({
    initialMode: 'auto',
    persist: false,
    sampleWindowSeconds: 1,
  });

  for (let index = 0; index < 59; index += 1) {
    assert.equal(manager.recordFrame(1 / 60), null);
  }
  const result = manager.recordFrame(1 / 60);
  assert.ok(result);
  assert.ok(Math.abs(result.fps - 60) < 0.01);
  assert.equal(result.signal, 'headroom');
});

test('isolated long tasks reset adaptation instead of forcing a downshift', () => {
  const manager = createQualityManager({
    initialMode: 'auto',
    initialAutoTier: 'medium',
    persist: false,
    sampleWindowSeconds: 0.1,
    downshiftSamples: 1,
    ignoreFrameAbove: 0.2,
  });

  for (let index = 0; index < 5; index += 1) manager.recordFrame(1 / 60);
  assert.equal(manager.recordFrame(0.65), null);
  assert.equal(manager.tier, 'medium');
  assert.equal(manager.sampleFrames, 0);
  assert.equal(manager.lowSamples, 0);
});

test('subscribers are notified only when applicable settings change', () => {
  const manager = createQualityManager({ initialMode: 'high', persist: false });
  const reasons = [];
  const unsubscribe = manager.subscribe((_snapshot, reason) => reasons.push(reason));

  assert.equal(manager.reportFps(20).signal, 'pressure');
  manager.setMode('medium');
  manager.setDevicePixelRatio(2);
  unsubscribe();
  manager.setMode('low');

  assert.deepEqual(reasons, ['subscribe', 'mode-change', 'pixel-ratio-change']);
});
