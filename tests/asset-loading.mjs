import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VOXLoader } from 'three/addons/loaders/VOXLoader.js';
import { readFleetVoxData } from '../src/render/FleetVoxData.js';
import { fetchAssetBuffer } from '../src/core/AssetLoader.js';
import { AudioManagerImpl } from '../src/core/AudioManager.js';

const source = readFileSync(new URL('../assets/voxels/player-fleet/spaceships.vox', import.meta.url));
const bytes = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
const reference = new VOXLoader().parse(bytes);
const actual = readFleetVoxData(bytes);
assert.equal(actual.length, 6);
for (let i = 0; i < actual.length; i++) {
  assert.deepEqual(actual[i].size, reference.chunks[i].size);
  assert.deepEqual(actual[i].data, reference.chunks[i].data, 'Fast reader preserves every authored voxel');
  assert.deepEqual([...actual[i].palette], [...reference.chunks[i].palette], 'All palette channels match the official loader');
}
reference.scene?.traverse(object => {
  if (object.isMesh) { object.geometry.dispose(); object.material.dispose(); }
});
assert.throws(() => readFleetVoxData(bytes.slice(0, 7)), /header/);
assert.throws(() => readFleetVoxData(bytes.slice(0, bytes.byteLength - 1)), /Truncated/);
const badHeader = bytes.slice(0);
new DataView(badHeader).setUint32(0, 0, true);
assert.throws(() => readFleetVoxData(badHeader), /header/);

const fetchBefore = globalThis.fetch;
try {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError('network interruption');
    return new Response(new Uint8Array([1, 2, 3]));
  };
  assert.deepEqual([...new Uint8Array(await fetchAssetBuffer('/asset'))], [1, 2, 3]);
  assert.equal(calls, 2, 'A transient transport failure retries once');
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', { status: 404 }); };
  await assert.rejects(fetchAssetBuffer('/missing'), /HTTP 404/);
  assert.equal(calls, 1, 'A permanent missing URL is not repeatedly requested');
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('', { status: calls === 1 ? 503 : 200 });
  };
  await fetchAssetBuffer('/temporarily-down');
  assert.equal(calls, 2, 'A server error retries');
  calls = 0;
  globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => {
    calls++;
    signal.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  });
  await assert.rejects(fetchAssetBuffer('/stalled', { timeoutMs: 5 }), { name: 'AbortError' });
  assert.equal(calls, 2, 'A stalled request has a finite retry budget');

  const requested = [];
  let active = 0, peak = 0;
  globalThis.fetch = async url => {
    requested.push(url);
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 1));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  const audio = new AudioManagerImpl();
  audio.ctx = { decodeAudioData: async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return { getChannelData: () => new Float32Array([.2, -.2]) };
  } };
  await audio._loadSfx();
  assert.equal(Object.keys(audio.buffers).length, 47, 'Every normal, Black Armor and weapon cue finishes loading');
  assert.equal(peak, 4, 'Downloads and decoding share the same four-worker budget');
  assert.ok(requested[0].endsWith('/sfx/mayhem/pulse.wav'), 'Primary weapon sound starts first');
  assert.ok(requested.some(url => url.endsWith('/sfx/shield_charge_sfx.wav')), 'Black Armor activation audio loads through the SFX bus');
  assert.equal(Object.keys(audio._weaponTrim).length, 18, 'All weapon loudness trims remain available');
} finally {
  globalThis.fetch = fetchBefore;
}
console.log('PASS: identical fleet data without duplicate meshing; bounded prioritized SFX; transient retries, permanent failures and finite timeouts.');
