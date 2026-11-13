/**
 * Read the supplied fleet's model data without creating its presentation scene.
 * VOXLoader.parse also meshes the scene; the fleet needs six individually painted
 * hulls, so constructing that scene first performs all of the greedy meshing twice.
 * Original .vox files remain authoritative and untouched.
 */
export function readFleetVoxData(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 542658390
      || ![150, 200].includes(view.getUint32(4, true))) throw new Error('Invalid fleet VOX header');
  const chunks = [];
  let palette;
  let model;
  let offset = 8;
  while (offset < view.byteLength) {
    if (offset + 12 > view.byteLength) throw new Error('Truncated fleet VOX chunk');
    const id = String.fromCharCode(...new Uint8Array(buffer, offset, 4));
    const length = view.getUint32(offset + 4, true);
    const children = view.getUint32(offset + 8, true);
    const start = offset + 12;
    const end = start + length;
    if (end + children > view.byteLength) throw new Error('Truncated fleet VOX data');
    if (id === 'SIZE') {
      if (length !== 12) throw new Error('Invalid fleet VOX dimensions');
      const size = { x: view.getUint32(start, true), y: view.getUint32(start + 4, true), z: view.getUint32(start + 8, true) };
      if (Object.values(size).some(n => n < 1 || n > 256)) throw new Error('Invalid fleet VOX bounds');
      model = { size };
      chunks.push(model);
    } else if (id === 'XYZI') {
      if (!model || length < 4) throw new Error('Missing fleet VOX dimensions');
      const count = view.getUint32(start, true);
      if (4 + count * 4 !== length) throw new Error('Invalid fleet VOX voxel count');
      model.data = new Uint8Array(buffer, start + 4, count * 4);
    } else if (id === 'RGBA') {
      if (length !== 1024) throw new Error('Invalid fleet VOX palette');
      palette = new Uint32Array(257);
      for (let i = 0; i < 256; i++) palette[i + 1] = view.getUint32(start + i * 4, true);
    }
    // MAIN contains child chunks. Walk those too, skipping scene-node payloads.
    offset = end;
  }
  if (!palette || !chunks.length || chunks.some(chunk => !chunk.data)) throw new Error('Incomplete fleet VOX data');
  for (const chunk of chunks) chunk.palette = palette;
  return chunks;
}
