import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceCache } from '../src/core/resourceCache.js';

test('getOrCreate shares a resource by key', () => {
  const cache = createResourceCache();
  let builds = 0;
  const first = cache.getOrCreate('sphere', () => ({ id: ++builds }));
  const second = cache.getOrCreate('sphere', () => ({ id: ++builds }));

  assert.equal(first, second);
  assert.equal(builds, 1);
  assert.equal(cache.size, 1);
});

test('leases prevent active resources from being evicted', () => {
  const disposed = [];
  const cache = createResourceCache({ dispose: (resource) => disposed.push(resource.id) });
  const leaseA = cache.acquire('eye', () => ({ id: 'eye' }));
  const leaseB = cache.acquire('eye', () => ({ id: 'other' }));

  assert.equal(leaseA.value, leaseB.value);
  assert.equal(cache.getRefCount('eye'), 2);
  assert.equal(cache.disposeUnused(), 0);
  assert.equal(cache.dispose('eye'), false);

  assert.equal(leaseA.release(), true);
  assert.equal(leaseA.release(), false);
  leaseB.release();
  assert.equal(cache.disposeUnused(), 1);
  assert.deepEqual(disposed, ['eye']);
});

test('autoDisposeUnused disposes after the final lease releases', () => {
  let disposals = 0;
  const cache = createResourceCache({ autoDisposeUnused: true });
  const lease = cache.acquire('material', () => ({ dispose: () => { disposals += 1; } }));

  lease.release();
  assert.equal(cache.has('material'), false);
  assert.equal(disposals, 1);
});

test('forced disposal can tear down every cached resource', () => {
  const disposed = [];
  const cache = createResourceCache({ dispose: (_resource, key) => disposed.push(key) });
  cache.getOrCreate('unused', () => ({}));
  const lease = cache.acquire('active', () => ({}));

  assert.equal(cache.disposeAll(), 1);
  assert.equal(cache.has('active'), true);
  assert.deepEqual(cache.getStats(), { resources: 1, referenced: 1, unused: 0, references: 1 });
  assert.equal(cache.disposeAll({ force: true }), 1);
  assert.deepEqual(disposed.sort(), ['active', 'unused']);
  assert.equal(cache.size, 0);
  assert.equal(lease.release(), true);
});
