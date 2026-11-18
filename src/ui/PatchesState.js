import { ANNOUNCEMENT_TABS } from '../config/announcements.js';

export function sanitizePatchesState(raw) {
  const state = raw?.schema === 1 ? raw : {};
  const rect = state.rect;
  return {
    schema: 1,
    expanded: state.expanded === true,
    tab: ANNOUNCEMENT_TABS.includes(state.tab) ? state.tab : 'patch',
    rect: rect && ['x', 'y', 'width', 'height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key]))
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    seen: Array.isArray(state.seen) ? [...new Set(state.seen.filter(id => typeof id === 'string'))].slice(-2000) : [],
  };
}

export function clampPatchesRect(rect, width, height) {
  const margin = 12;
  const maxWidth = Math.max(1, width - margin * 2);
  const maxHeight = Math.max(1, height - margin * 2);
  const w = Math.min(maxWidth, Math.max(420, rect.width));
  const h = Math.min(maxHeight, Math.max(250, rect.height));
  return { x: Math.max(margin, Math.min(width - w - margin, rect.x)),
    y: Math.max(margin, Math.min(height - h - margin, rect.y)), width: w, height: h };
}
