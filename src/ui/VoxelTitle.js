/**
 * Locally drawn 5×7 voxel lettering. Every occupied pixel has a separate front,
 * top and side face; this is a real block alphabet, not a system-font treatment.
 * SVG keeps the letter faces crisp at every desktop resolution without a font
 * download or a second WebGL renderer. Semantic text lives on the parent nodes.
 */
const GLYPHS = {
  A: ['01110', '11011', '11011', '11111', '11011', '11011', '11011'],
  C: ['01111', '11000', '11000', '11000', '11000', '11000', '01111'],
  D: ['11110', '11011', '11011', '11011', '11011', '11011', '11110'],
  E: ['11111', '11000', '11000', '11110', '11000', '11000', '11111'],
  F: ['11111', '11000', '11000', '11110', '11000', '11000', '11000'],
  H: ['11011', '11011', '11011', '11111', '11011', '11011', '11011'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['11000', '11000', '11000', '11000', '11000', '11000', '11111'],
  N: ['11001', '11101', '11101', '11011', '11011', '11011', '11001'],
  P: ['11110', '11011', '11011', '11110', '11000', '11000', '11000'],
  R: ['11110', '11011', '11011', '11110', '11100', '11010', '11011'],
  S: ['01111', '11000', '11000', '01110', '00011', '00011', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['11011', '11011', '11011', '11011', '11011', '11011', '01110'],
};

const PALETTES = {
  // Saturated enamel faces over obsidian blocks. Neon belongs on the seams;
  // keeping the extrusion black lets the cyan and violet retain their color.
  rift: { top: '#4ffff0', mid: '#00d6d0', bottom: '#007782', side: '#03161d', depth: '#02050c',
    edge: '#b7fff8', shade: '#004c60', rim: '#19fff1', backRim: '#bd25ff' },
  pirates: { top: '#d878ff', mid: '#ad1cf5', bottom: '#6500aa', side: '#10091e', depth: '#04040c',
    edge: '#f6bdff', shade: '#3c0260', rim: '#f029ff', backRim: '#28f9f1' },
  launch: { top: '#7ffff5', mid: '#00efe0', bottom: '#00a9b0', side: '#02161a', depth: '#02080d',
    edge: '#b8fff5', shade: '#006674', rim: '#0dfde2', backRim: '#175754' },
  ink: { top: '#0b1017', mid: '#080d15', bottom: '#03060c', side: '#071421', depth: '#02040a',
    edge: '#225761', shade: '#02040a', rim: '#174354', backRim: '#16102d' },
};
let nextId = 0;

export function voxelWordSVG(text, paletteName = 'rift') {
  const palette = PALETTES[paletteName] || PALETTES.rift;
  const id = `voxel-word-${nextId++}`;
  const step = 10;
  const compact = paletteName === 'ink' || paletteName === 'launch';
  const gap = compact ? 0.35 : 0.8;
  const dx = compact ? 0.8 : -3.2;
  const dy = compact ? 0.8 : 8;
  const blocks = [];
  let cursor = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') { cursor += 4; continue; }
    const glyph = GLYPHS[ch];
    if (!glyph) { cursor += 6; continue; }
    glyph.forEach((row, y) => [...row].forEach((bit, x) => {
      if (bit === '1') blocks.push({ x: (cursor + x) * step, y: y * step, light: (cursor + x + y * 3) % 9 === 0 });
    }));
    cursor += 6;
  }
  const w = (cursor - 1) * step + Math.abs(dx) + 4;
  const h = 70 + dy + 2;
  const n = step - gap;
  const depth = blocks.map(({ x, y }) => `
    <path d="M${x},${y}h${n}v${n}l${dx},${dy}h-${n}v-${n}Z" fill="url(#${id}-depth)" stroke="${palette.backRim}" stroke-width=".38" stroke-opacity=".8"/>
    <path d="M${x},${y}l${dx},${dy}v${n}l${-dx},${-dy}Z" fill="${palette.side}" stroke="${palette.rim}" stroke-width=".32" stroke-opacity=".7"/>
    <path d="M${x + dx},${y + dy + n}h${n}" fill="none" stroke="${palette.backRim}" stroke-width=".55"/>
  `).join('');
  const faces = blocks.map(({ x, y, light }) => `
    <rect x="${x}" y="${y}" width="${n}" height="${n}" fill="url(#${id})"/>
    <path d="M${x + 0.45},${y + n - 0.45}v-${n - .9}h${n - .9}" fill="none" stroke="${palette.edge}" stroke-width=".55" opacity=".9"/>
    <path d="M${x + n - .45},${y + .45}v${n - .9}h-${n - .9}" fill="none" stroke="${palette.shade}" stroke-width=".7" opacity=".85"/>
    ${light && paletteName !== 'ink' ? `<path d="M${x + .7},${y + 2.8}v-2.1h2.1" fill="none" stroke="#eaffff" stroke-width=".8" opacity=".94"/>` : ''}
  `).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${Math.min(-1, dx - 1)} -1 ${w} ${h}" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2=".22" y2="1" gradientUnits="objectBoundingBox">
        <stop stop-color="${palette.top}"/><stop offset=".22" stop-color="${palette.mid}"/>
        <stop offset=".72" stop-color="${palette.mid}"/><stop offset="1" stop-color="${palette.bottom}"/>
      </linearGradient>
      <linearGradient id="${id}-depth" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="${palette.side}"/><stop offset=".6" stop-color="${palette.depth}"/><stop offset="1" stop-color="#010208"/>
      </linearGradient>
    </defs>
    ${depth}${faces}
  </svg>`;
}

function skullSVG() {
  const skull = [
    '0001111111000', '0011111111100', '0111111111110',
    '0110011100110', '0110011100110', '0111111111110',
    '0011110111100', '0001101011000', '0001101011000',
    '1100000000011', '0110000000110', '0001100011000', '0000011100000',
  ];
  const cells = skull.flatMap((row, y) => [...row].flatMap((bit, x) => bit === '1'
    ? [`<rect x="${x * 3}" y="${y * 3}" width="2.7" height="2.7"/>`] : []));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 39 39" fill="currentColor" aria-hidden="true">${cells.join('')}</svg>`;
}

export function initVoxelTitle() {
  for (const el of document.querySelectorAll('[data-voxel-text]')) {
    el.innerHTML = voxelWordSVG(el.dataset.voxelText, el.dataset.voxelPalette);
  }
  const skull = document.getElementById('voxelSkull');
  if (skull) skull.innerHTML = skullSVG();
  for (const el of document.querySelectorAll('[data-voxel-skull]')) el.innerHTML = skullSVG();
}
