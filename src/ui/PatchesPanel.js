import { Save } from '../core/SaveSystem.js';
import { Input } from '../core/Input.js';
import { Audio2 } from '../core/AudioManager.js';
import { ANNOUNCEMENTS, ANNOUNCEMENT_TABS, ANNOUNCEMENT_STATUSES, publishedAnnouncements } from '../config/announcements.js';
import { sanitizePatchesState, clampPatchesRect } from './PatchesState.js';
import './patches-panel.css';

const LABELS = { patch: 'LATEST PATCH', upcoming: 'UPCOMING', roadmap: 'ROADMAP' };
const sheetLayout = () => innerWidth <= 700 || (innerWidth <= 900 && innerHeight <= 500);
const EMPTY = {
  patch: ['AWAITING TRANSMISSION', 'No patch notes have been published yet.', 'The next dispatch will appear here. Until then, the rift is yours.'],
  upcoming: ['THE HORIZON IS QUIET', 'No upcoming announcements have been published.', 'Confirmed previews will arrive on this channel. Stay tuned, captain.'],
  roadmap: ['UNCHARTED TERRITORY', 'No development milestones have been published.', 'When the course is set, follow its progress here.'],
};
const TOOL_ICON = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m7 5 20 22M5 7l4-4 5 5-4 4M22 5l5 5M5 27l17-17M19 7l6-4 4 4-4 6" stroke="currentColor" stroke-width="3" stroke-linecap="square"/><path d="m3 25 4 4" stroke="currentColor" stroke-width="4"/></svg>`;
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
};
function mediaURL(path) {
  if (typeof path !== 'string' || !path) return null;
  // Media belongs to the curated public asset library or an explicit HTTPS URL.
  if (/^https:\/\//.test(path)) return path;
  if (/^[\w/-]+\.(webp|png|jpg|jpeg|avif|mp4|webm)$/i.test(path)) return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
  return null;
}

/** A nonmodal title-screen window. It owns no rendering or polling loop. */
export class PatchesPanel {
  constructor(game, entries = ANNOUNCEMENTS) {
    this.game = game;
    this.entries = publishedAnnouncements(entries);
    this.state = sanitizePatchesState(Save.data.patchesWindow);
    this.abort = new AbortController();
    this.readTimers = new Map();
    this.intersections = new Set();
    this.title = document.getElementById('titleScreen');
    this.button = node('button', 'patchesToggle');
    this.button.id = 'patchesToggle';
    this.button.type = 'button';
    this.button.setAttribute('aria-controls', 'patchesPanel');
    this.button.innerHTML = `${TOOL_ICON}<span>PATCHES &amp; UPDATES</span><small class="patchesNew" hidden>NEW</small><i class="patchesChevron" aria-hidden="true"></i>`;
    document.querySelector('.menuEdition').before(this.button);
    this.panel = node('section', 'patchesPanel');
    this.panel.id = 'patchesPanel';
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-labelledby', 'patchesHeading');
    this.panel.innerHTML = `<div class="patchesSurface">
      <header class="patchesHeader">${TOOL_ICON}<h2 id="patchesHeading">PATCHES &amp; UPDATES</h2><span class="patchesStripes" aria-hidden="true"></span><span class="patchesDragGrip" aria-hidden="true">⠿</span><button type="button" data-collapse aria-label="Minimize patches and updates">−</button><button type="button" data-collapse aria-label="Close patches and updates">×</button></header>
      <div class="patchesTabs" role="tablist" aria-label="Transmission channels">${ANNOUNCEMENT_TABS.map(tab => `<button type="button" id="patchesTab-${tab}" role="tab" aria-controls="patchesContent" data-patches-tab="${tab}">${LABELS[tab]}</button>`).join('')}</div>
      <div id="patchesContent" class="patchesContent" role="tabpanel" tabindex="0"></div>
      <footer class="patchesFooter"><span><i></i> RIFT TRANSMISSIONS</span><button type="button" class="patchesReset">RESET WINDOW LAYOUT <b aria-hidden="true">↺</b></button></footer>
    </div><div class="patchesResize patchesResizeRight" data-resize="right" aria-hidden="true"></div><div class="patchesResize patchesResizeBottom" data-resize="bottom" aria-hidden="true"></div><div class="patchesResize patchesResizeCorner" data-resize="corner" aria-hidden="true"></div>`;
    this.title.append(this.panel);
    this.content = this.panel.querySelector('.patchesContent');
    const on = (el, type, handler, options = {}) => el.addEventListener(type, handler, { ...options, signal: this.abort.signal });
    on(this.button, 'click', () => this.setOpen(!this.state.expanded, true));
    on(this.button, 'keydown', event => {
      if (event.code === 'Space' || event.code === 'Enter') event.stopPropagation();
      if (event.key === 'Escape' && this.state.expanded) { event.stopPropagation(); this.close(); }
    });
    this.panel.querySelectorAll('[data-collapse]').forEach(button => on(button, 'click', () => this.close()));
    on(this.panel.querySelector('.patchesReset'), 'click', () => this.resetLayout());
    this.panel.querySelectorAll('[role="tab"]').forEach(button => on(button, 'click', () => this.selectTab(button.dataset.patchesTab)));
    on(this.panel, 'keydown', event => {
      // Preserve native Space activation, scrolling and text selection. Prevent
      // menu keys from reaching the game's window-level keyboard listener.
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); this.close(); }
      if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 :
          (ANNOUNCEMENT_TABS.indexOf(this.state.tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        this.selectTab(ANNOUNCEMENT_TABS[index], true);
      }
    });
    on(document, 'keydown', event => {
      if (event.key === 'Escape' && this.isVisible() && !document.querySelector('dialog[open]')) {
        event.stopPropagation(); this.close();
      }
    });
    on(this.panel, 'pointerdown', event => this.startGesture(event));
    on(this.panel, 'pointermove', event => this.moveGesture(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) on(this.panel, type, () => this.endGesture());
    on(window, 'blur', () => this.endGesture());
    on(window, 'resize', () => this.layout(true));
    on(window, 'rift-ui-scale', () => this.layout(true));
    on(document, 'visibilitychange', () => this.scheduleReads());
    on(this.panel, 'transitionend', () => this.scheduleReads());
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= .75) this.intersections.add(entry.target);
        else this.intersections.delete(entry.target);
      }
      this.scheduleReads();
    }, { root: this.content, threshold: [.75] });
    this.visibilityObserver = new MutationObserver(() => this.scheduleReads());
    this.visibilityObserver.observe(this.title, { attributes: true, attributeFilter: ['class'] });
    document.querySelectorAll('dialog').forEach(dialog => this.visibilityObserver.observe(dialog, { attributes: true, attributeFilter: ['open'] }));
    this.selectTab(this.state.tab, false, false);
    this.layout(true);
    this.setOpen(this.state.expanded, false, false);
    this.paintUnread();
  }

  isVisible() {
    return this.state.expanded && !this.title.classList.contains('hidden') && !document.hidden;
  }

  persist() { Save.data.patchesWindow = this.state; Save.save(); }

  setOpen(open, focus = false, save = true) {
    this.state.expanded = open;
    this.panel.inert = !open;
    this.panel.setAttribute('aria-hidden', String(!open));
    this.panel.classList.toggle('isOpen', open);
    this.button.setAttribute('aria-expanded', String(open));
    if (open) this.layout();
    else {
      this.endGesture();
      this.panel.querySelectorAll('video').forEach(video => video.pause());
    }
    if (focus) {
      (open ? this.panel.querySelector('[aria-selected="true"]') : this.button).focus({ preventScroll: true });
      Input.blockMenuCarryover();
      Audio2.play('ui_select', .4, 1);
    }
    if (save) this.persist();
    this.scheduleReads();
  }

  close() {
    this.setOpen(false, true);
    const menus = this.game.controllerMenus;
    if (menus?.active) { menus.root = menus.currentRoot(); menus.focus(this.button); }
  }

  defaultRect() {
    const masthead = document.querySelector('.menuMasthead').getBoundingClientRect();
    const width = Math.min(640, Math.max(420, innerWidth * .51));
    return { x: masthead.right - width, y: masthead.bottom + 12, width, height: 300 };
  }

  layout(checkObstruction = false) {
    this.endGesture();
    if (sheetLayout()) {
      // Keep desktop preferences intact while the window becomes a mobile sheet.
      this.panel.style.cssText = '';
      return;
    }
    let rect = clampPatchesRect(this.state.rect || this.defaultRect(), innerWidth, innerHeight);
    if (checkObstruction && this.state.rect) {
      const blocked = ['launchBtn', 'optionsBtn', 'shipSelectBtn', 'pilotIdentityBtn'].some(id => {
        const target = document.getElementById(id)?.getBoundingClientRect();
        return target?.width && rect.x < target.right && rect.x + rect.width > target.left && rect.y < target.bottom && rect.y + rect.height > target.top;
      });
      if (blocked) rect = clampPatchesRect(this.defaultRect(), innerWidth, innerHeight);
    }
    this.applyRect(rect);
    if (this.state.rect) { this.state.rect = rect; this.persist(); }
  }

  applyRect(rect) {
    Object.assign(this.panel.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  resetLayout() { this.state.rect = null; this.layout(); this.persist(); }

  startGesture(event) {
    if (sheetLayout() || event.button !== 0 || this.gesture) return;
    const mode = event.target.closest('[data-resize]')?.dataset.resize ||
      (event.target.closest('.patchesHeader') && !event.target.closest('button') ? 'drag' : null);
    if (!mode) return;
    event.preventDefault();
    const rect = this.panel.getBoundingClientRect();
    this.gesture = { mode, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    this.panel.setPointerCapture(event.pointerId);
    this.panel.classList.add('isMoving');
    this.clearReads();
  }

  moveGesture(event) {
    const g = this.gesture;
    if (!g || g.pointer !== event.pointerId) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    const rect = { ...g.rect };
    if (g.mode === 'drag') { rect.x += dx; rect.y += dy; }
    else {
      if (g.mode !== 'bottom') rect.width = Math.min(innerWidth - rect.x - 12, rect.width + dx);
      if (g.mode !== 'right') rect.height = Math.min(innerHeight - rect.y - 12, rect.height + dy);
    }
    this.state.rect = clampPatchesRect(rect, innerWidth, innerHeight);
    this.applyRect(this.state.rect);
  }

  endGesture() {
    if (!this.gesture) return;
    const pointer = this.gesture.pointer;
    this.gesture = null;
    if (this.panel.hasPointerCapture(pointer)) this.panel.releasePointerCapture(pointer);
    this.panel.classList.remove('isMoving');
    this.persist();
    this.scheduleReads();
  }

  selectTab(tab, focus = false, save = true) {
    if (!ANNOUNCEMENT_TABS.includes(tab)) return;
    this.state.tab = tab;
    this.panel.querySelectorAll('[role="tab"]').forEach(button => {
      const selected = button.dataset.patchesTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus({ preventScroll: true });
    });
    this.clearReads();
    this.observer.disconnect();
    this.intersections.clear();
    this.content.setAttribute('aria-labelledby', `patchesTab-${tab}`);
    this.content.replaceChildren();
    let entries = this.entries.filter(entry => entry.category === tab);
    if (tab === 'patch') entries = entries.slice().sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)).slice(0, 1);
    if (entries.length) entries.forEach(entry => this.renderEntry(entry));
    else this.renderEmpty(tab);
    this.content.scrollTop = 0;
    if (save) this.persist();
    this.paintUnread();
  }

  renderEmpty(tab) {
    const card = node('div', 'patchesEmpty');
    const art = node('div', 'patchesArtwork');
    const image = node('img');
    image.src = `${import.meta.env.BASE_URL}images/ships/neon-wraith.webp`;
    image.alt = ''; image.width = 240; image.height = 150;
    art.append(image, node('span', '', 'RIFT APPROACH / COMMS ARRAY'));
    const copy = node('div', 'patchesEmptyCopy');
    copy.append(node('small', '', 'CHANNEL 0' + (ANNOUNCEMENT_TABS.indexOf(tab) + 1) + ' / STANDBY'), node('h3', '', EMPTY[tab][0]), node('p', '', EMPTY[tab][1]), node('p', 'patchesMuted', EMPTY[tab][2]));
    card.append(art, copy);
    this.content.append(card);
  }

  renderEntry(entry) {
    const card = node('article', `patchesCard${entry.category === 'roadmap' ? ' patchesMilestone' : ''}`);
    const preview = mediaURL(entry.image);
    if (preview) {
      const image = node('img', 'patchesPreview');
      image.src = preview; image.alt = entry.imageAlt || ''; image.loading = 'lazy';
      image.addEventListener('error', () => image.remove(), { once: true });
      card.append(image);
    }
    const body = node('div', 'patchesCardBody');
    const readTarget = node('div', 'patchesReadTarget');
    readTarget.dataset.announcementId = entry.id;
    const meta = node('div', 'patchesMeta');
    if (entry.version) meta.append(node('strong', '', entry.version));
    if (ANNOUNCEMENT_STATUSES.includes(entry.status)) meta.append(node('span', `patchesStatus ${entry.status}`, entry.status.replaceAll('-', ' ').toUpperCase()));
    if (entry.date) {
      const date = node('time', '', entry.date.slice(0, 10)); date.dateTime = entry.date; meta.append(date);
    }
    readTarget.append(meta, node('h3', '', entry.title));
    if (entry.summary) readTarget.append(node('p', '', entry.summary));
    body.append(readTarget);
    if (entry.releaseWindow) body.append(node('p', 'patchesMuted', entry.releaseWindow));
    if (Array.isArray(entry.highlights) && entry.highlights.length) {
      const list = node('ul', 'patchesHighlights');
      entry.highlights.forEach(text => list.append(node('li', '', text)));
      body.append(list);
    }
    const sections = [['details', 'FIELD NOTES'], ['balance', 'BALANCE'], ['fixes', 'BUG FIXES'], ['performance', 'PERFORMANCE']];
    if (sections.some(([key]) => entry[key]?.length) || mediaURL(entry.video)) {
      const toggle = node('button', 'patchesDetailsToggle', 'EXPAND TRANSMISSION +');
      toggle.type = 'button'; toggle.setAttribute('aria-expanded', 'false');
      const details = node('div', 'patchesDetails'); details.hidden = true;
      details.id = `patchesDetails-${this.content.children.length}`;
      toggle.setAttribute('aria-controls', details.id);
      for (const [key, label] of sections) if (entry[key]?.length) {
        details.append(node('h4', '', label));
        (Array.isArray(entry[key]) ? entry[key] : [entry[key]]).forEach(text => details.append(node('p', '', text)));
      }
      if (mediaURL(entry.video)) {
        const video = node('video'); video.src = mediaURL(entry.video); video.controls = true; video.preload = 'none'; video.playsInline = true;
        details.append(video);
      }
      toggle.addEventListener('click', () => {
        details.hidden = !details.hidden;
        toggle.setAttribute('aria-expanded', String(!details.hidden));
        toggle.textContent = details.hidden ? 'EXPAND TRANSMISSION +' : 'COLLAPSE TRANSMISSION −';
      });
      body.append(toggle, details);
    }
    card.append(body); this.content.append(card); this.observer.observe(readTarget);
  }

  paintUnread() {
    // Only visible feed items count: older patches are not reachable in Latest.
    const latest = this.entries.filter(entry => entry.category === 'patch').sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))[0];
    const unread = this.entries.some(entry => (entry.category !== 'patch' || entry === latest) && !this.state.seen.includes(entry.id));
    this.button.querySelector('.patchesNew').hidden = !unread;
    this.button.classList.toggle('hasUnread', unread);
  }

  clearReads() { for (const timer of this.readTimers.values()) clearTimeout(timer); this.readTimers.clear(); }

  scheduleReads() {
    this.clearReads();
    if (!this.isVisible() || document.querySelector('dialog[open]') || this.gesture) return;
    for (const target of this.intersections) {
      const id = target.dataset.announcementId;
      if (this.state.seen.includes(id)) continue;
      this.readTimers.set(id, setTimeout(() => {
        this.readTimers.delete(id);
        if (!this.isVisible() || !this.intersections.has(target) || document.querySelector('dialog[open]')) return;
        const r = target.getBoundingClientRect();
        if (!target.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))) return;
        this.state.seen.push(id); this.persist(); this.paintUnread();
      }, 900));
    }
  }

  destroy() {
    this.endGesture(); this.clearReads(); this.observer.disconnect(); this.visibilityObserver.disconnect();
    this.abort.abort(); this.panel.remove(); this.button.remove();
  }
}
