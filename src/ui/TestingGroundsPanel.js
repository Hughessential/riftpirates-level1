import { UPGRADES, AUGMENT_CATEGORIES } from '../systems/UpgradeSystem.js';
import { PLAYER_SHIPS } from '../render/PlayerFleet.js';
import { WEAPON_AUDIO } from '../core/AudioManager.js';
import { Input } from '../core/Input.js';
import './testing-grounds.css';

const SCENES = [
  ['sandbox', 'OPEN TEST RANGE'], ['approach1', '01 / OUTER APPROACH'],
  ['tower1', '01 / OUTER DEFENSE TOWER'], ['approach2', '02 / MIDRIFT APPROACH'],
  ['tower2', '02 / MIDRIFT PRESSURE TOWER'], ['approach3', '03 / CITADEL APPROACH'],
  ['tower3', '03 / INNER CITADEL'], ['approach4', '04 / INHIBITOR APPROACH'],
  ['inhibitor', '04 / INHIBITOR CORE'], ['boss', '05 / THE RIFT ADMIRAL'],
  ['escape', '06 / FINAL ESCAPE · LOAD TO RETRY'],
];
const TOGGLES = [
  ['godMode', 'GOD MODE', 'Ignore combat damage. Turn off to test survival.'],
  ['infiniteBoost', 'INFINITE BOOST', 'Keep the engine reserve full.'],
  ['unlimitedRolls', 'UNLIMITED ROLLS', 'Remove barrel-roll recovery.'],
  ['autoFire', 'AUTO FIRE', 'Hold the trigger for your entire build.'],
  ['freezeEnemies', 'FREEZE SHIPS', 'Hold enemy ships still. Boss patterns keep running.'],
  ['trail', 'VOXEL EXHAUST', 'Show the long, glowing engine trail.'],
];
const fmt = (number) => Number.isFinite(Number(number)) ? Math.round(Number(number)).toLocaleString() : '—';
const option = ([value, label]) => `<option value="${value}">${label}</option>`;

/** The visible, keyboard-accessible control room for the isolated test run. */
export class TestingGroundsPanel {
  constructor(testing) {
    this.testing = testing;
    this.activeTab = 'pilot';
    this.search = '';
    this.category = 'ALL';
    this.lastMessage = 'Configure your experiment, then close the console to fly.';

    this.dialog = document.createElement('dialog');
    this.dialog.id = 'testingGroundsPanel';
    this.dialog.className = 'labConsole';
    this.dialog.setAttribute('aria-labelledby', 'labTitle');
    this.dialog.innerHTML = `
      <header class="labHeader">
        <div class="labHeaderMark" aria-hidden="true">[+]</div>
        <div><span class="labEyebrow">RIFT PIRATES / DEVELOPER ACCESS</span><h2 id="labTitle">THE TESTING GROUNDS</h2><p>BREAK THE BUILD. FIND THE MAGIC.</p></div>
        <button type="button" class="labClose" id="labClose" aria-label="Close console and fly">×</button>
      </header>
      <div class="labSafety"><span class="labLiveDot"></span> ISOLATED TEST RUN <span>Scores, scrap and clears from this session are never banked.</span></div>
      <div class="labWorkspace">
        <nav class="labNav" aria-label="Testing tools" role="tablist">
          ${[['pilot', '01', 'PILOT', 'Ships & survival'], ['augments', '02', 'AUGMENTS', 'Build anything'], ['arena', '03', 'ARENA', 'Spawn & challenge'], ['effects', '04', 'EFFECTS', 'Light & sound']].map(([id, n, name, hint]) => `
            <button type="button" class="labTab" id="labTab-${id}" role="tab" data-tab="${id}" aria-controls="labPage-${id}" aria-selected="false"><small>${n}</small><strong>${name}</strong><span>${hint}</span></button>`).join('')}
          <div class="labReadout" aria-label="Live test telemetry"><span>RANGE TELEMETRY</span><dl>
            <div><dt>HULL</dt><dd data-readout="hull">—</dd></div><div><dt>SHIELD</dt><dd data-readout="shield">—</dd></div>
            <div><dt>PROJECTILES</dt><dd data-readout="projectiles">—</dd></div><div><dt>HOSTILES</dt><dd data-readout="enemies">—</dd></div>
            <div><dt>DUMMY DAMAGE</dt><dd data-readout="damage">—</dd></div><div><dt>DPS</dt><dd data-readout="dps">—</dd></div>
          </dl><span class="labSimState">SIMULATION HELD</span></div>
        </nav>
        <div class="labPages">
          <section class="labPage" id="labPage-pilot" role="tabpanel" aria-labelledby="labTab-pilot">
            <div class="labSectionHead"><div><span class="labEyebrow">YOUR SHIP. YOUR RULES.</span><h3>PILOT OVERRIDES</h3></div><span class="labPill">SESSION ONLY</span></div>
            <div class="labToggleGrid">${TOGGLES.map(([id, label, desc]) => `<label class="labToggle"><input type="checkbox" data-setting="${id}"><span class="labSwitch" aria-hidden="true"></span><span><strong>${label}</strong><small>${desc}</small></span></label>`).join('')}</div>
            <div class="labSectionHead labSubhead"><h3>THE STOLEN FLEET</h3><span>ALL SIX / SAME STATS</span></div>
            <div class="labShips">${PLAYER_SHIPS.map((ship, index) => `<button type="button" class="labShip" data-lab-ship="${ship.id}" aria-pressed="false"><small>HULL 0${index + 1}</small><img alt="" hidden><strong>${ship.name}</strong><span>${ship.tagline}</span></button>`).join('')}</div>
            <div class="labControlRow"><label>SIMULATION SPEED<select id="labTimeScale">${[[.25, '0.25× / FRAME STUDY'], [.5, '0.5× / SLOW MOTION'], [1, '1× / REAL TIME'], [2, '2× / FAST FORWARD']].map(option).join('')}</select></label><label>PLAYER LEVEL<select id="labXPLevel">${Array.from({ length: 18 }, (_, i) => option([i + 1, `LEVEL ${i + 1}`])).join('')}</select></label><button type="button" data-action="xp">SET LEVEL</button></div>
            <div class="labActionGrid"><button type="button" data-action="restore">RESTORE HULL + SHIELD</button><button type="button" data-action="damage">TAKE 40 DAMAGE</button><button type="button" data-action="shield">BREAK SHIELD</button><button type="button" data-action="dodge">TRIGGER PERFECT DODGE</button></div>
            <p class="labHint">Damage controls deliberately bypass god mode so you can test shield-break and low-health effects.</p>
          </section>
          <section class="labPage" id="labPage-augments" role="tabpanel" aria-labelledby="labTab-augments" hidden>
            <div class="labSectionHead"><div><span class="labEyebrow">45 AUGMENTS / EVERY COMBINATION</span><h3>BUILD A MONSTER</h3></div><span class="labPill" id="labBuildCount">0 STACKS</span></div>
            <div class="labPresets"><button type="button" data-preset="all">ALL 45 / RANK 1</button><button type="button" data-preset="arsenal">FULL ARSENAL</button><button type="button" data-preset="empty" class="labDanger">CLEAR BUILD</button></div>
            <div class="labAugmentFilters"><label class="labSearch"><span class="labVisuallyHidden">Search augments</span><input id="labAugmentSearch" type="search" placeholder="SEARCH NAME, EFFECT OR WEAPON…" autocomplete="off"></label><label><span class="labVisuallyHidden">Filter augment category</span><select id="labAugmentCategory"><option value="ALL">ALL CATEGORIES</option>${Object.keys(AUGMENT_CATEGORIES).map(id => option([id, id])).join('')}</select></label></div>
            <div id="labAugmentList" class="labAugmentList"></div><p id="labNoAugments" class="labHint" hidden>No augments match that search.</p>
            <p class="labHint">Set any rank from 0–50. Zero removes that augment. Changes apply to your current ship immediately.</p>
          </section>
          <section class="labPage" id="labPage-arena" role="tabpanel" aria-labelledby="labTab-arena" hidden>
            <div class="labSectionHead"><div><span class="labEyebrow">EVERY ENCOUNTER / NO WAITING</span><h3>COMMAND THE RIFT</h3></div><span class="labPill" id="labSceneLabel">TEST RANGE</span></div>
            <div class="labControlRow labSceneControls"><label>DESTINATION<select id="labScene">${SCENES.map(option).join('')}</select></label><button type="button" data-action="scene" class="labPrimary">LOAD SCENE →</button></div>
            <div class="labControlRow"><label>ADMIRAL PHASE<select id="labBossPhase">${[[1, '01 / RIFT ADMIRAL'], [2, '02 / RIFT UNLEASHED'], [3, '03 / NEXUS OVERDRIVE'], [4, '04 / TOTAL DOMINION']].map(option).join('')}</select></label><button type="button" data-action="phase">LOAD BOSS PHASE</button></div>
            <button type="button" data-action="intro">PLAY SELECTED BOSS INTRO</button>
            <p class="labHint">Choose a tower, Inhibitor or Admiral, then PLAY INTRO to watch its arrival. Scene changes keep your ship, augments and overrides. Load FINAL ESCAPE to retry the collapse; turn god mode and infinite boost off to test difficulty.</p>
            <div class="labSectionHead labSubhead"><h3>POPULATE THE RANGE</h3><span>SHIPS / TARGETS / DODGE PATTERNS</span></div>
            <div class="labControlRow"><label>ENEMY SHIP<select id="labEnemyType">${[['scout', 'SCOUT / MICRO RECON'], ['gunship', 'GUNSHIP'], ['heavy', 'HEAVY GUNNER'], ['elite', 'ELITE CAPTAIN'], ['shielder', 'SHIELD DRONE']].map(option).join('')}</select></label><label>COUNT<select id="labEnemyCount">${[1, 3, 5, 10].map(n => option([n, `${n} SHIP${n > 1 ? 'S' : ''}`])).join('')}</select></label><button type="button" data-action="enemy">SPAWN</button></div>
            <div class="labActionGrid"><button type="button" data-action="dummies">SPAWN TARGET DUMMIES</button><button type="button" data-action="bullets">SEND A BULLET FAN</button><button type="button" data-action="scrap">DROP SCRAP CACHE</button><button type="button" data-action="clear" class="labDanger">CLEAR ARENA</button></div>
            <div class="labControlRow"><label>RIFT HEAT<select id="labHeat">${[[1, '1 / COOL'], [3, '3 / HOT'], [6, '6 / BURNING'], [9, '9 / INFERNAL'], [12, '12 / OVERDRIVE']].map(option).join('')}</select></label><button type="button" data-action="heat">SET HEAT</button></div>
          </section>
          <section class="labPage" id="labPage-effects" role="tabpanel" aria-labelledby="labTab-effects" hidden>
            <div class="labSectionHead"><div><span class="labEyebrow">MAKE THE VOID SING</span><h3>LIGHT + SOUND LAB</h3></div><span class="labPill">18 WEAPON SOUNDS</span></div>
            <div class="labEffectCard"><div><h4>CINEMATIC BLOOM</h4><p>Dial in the neon glow. The scene default follows each encounter.</p></div><label class="labRange"><span id="labBloomValue">SCENE DEFAULT</span><input id="labBloom" type="range" min="0" max="1.5" step="0.05" value="0.8" aria-label="Bloom strength"></label><button type="button" data-action="bloomReset">SCENE DEFAULT</button></div>
            <div class="labActionGrid"><button type="button" data-action="fx">VOXEL EXPLOSION BURST</button><button type="button" data-action="dodge">PERFECT-DODGE EFFECTS</button></div>
            <p class="labHint">Close the console to watch particle effects and fly through the exhaust trail. The simulation is held while you configure it.</p>
            <div class="labSectionHead labSubhead"><h3>WEAPON SOUND BOARD</h3><span>CLICK TO AUDITION</span></div>
            <div class="labSoundGrid">${Object.keys(WEAPON_AUDIO).map((kind, index) => `<button type="button" data-sound="${kind}"><small>${String(index + 1).padStart(2, '0')}</small><span>${kind.replaceAll('_', ' ').toUpperCase()}</span><b aria-hidden="true">▷</b></button>`).join('')}</div>
            <p class="labHint">Sound previews follow the game's SFX switch. If silent, enable SFX in the pause menu.</p>
          </section>
        </div>
      </div>
      <footer class="labFooter"><p id="labStatus" role="status" aria-live="polite"></p><div><button type="button" id="labExit" class="labDanger">EXIT TEST LAB</button><button type="button" id="labFly" class="labPrimary">CLOSE + FLY <span>F2 / ESC</span></button></div></footer>`;
    document.body.append(this.dialog);

    this.badge = document.createElement('button');
    this.badge.id = 'testingGroundsBadge';
    this.badge.className = 'labBadge';
    this.badge.hidden = true;
    this.badge.innerHTML = '<span class="labLiveDot"></span><strong>TEST LAB</strong><span class="labBadgeGod">GOD MODE</span><kbd>F2</kbd>';
    this.badge.addEventListener('click', () => this.open());
    document.body.append(this.badge);

    this._addEntrances();
    this._buildAugments();
    this._wire();
    testing.onChange = () => this.renderState();
    this.renderState();
    this._telemetryTimer = setInterval(() => { if (testing.active) this._telemetry(testing.snapshot()); }, 300);
  }

  _addEntrances() {
    this.titleEntry = document.createElement('button');
    this.titleEntry.type = 'button';
    this.titleEntry.id = 'testingGroundsBtn';
    this.titleEntry.className = 'labTitleEntry';
    this.titleEntry.innerHTML = '<span aria-hidden="true">[+]</span> TESTING GROUNDS <kbd>F2</kbd>';
    this.titleEntry.addEventListener('click', () => this.open());
    document.getElementById('titleScreen').append(this.titleEntry);
    const pauseEntry = document.createElement('button');
    pauseEntry.id = 'testingGroundsPauseBtn';
    pauseEntry.className = 'btnGhost labPauseEntry';
    pauseEntry.textContent = 'ENTER TESTING GROUNDS / F2';
    pauseEntry.addEventListener('click', () => this.open());
    document.getElementById('quitBtn').before(pauseEntry);
  }

  _buildAugments() {
    this.augmentRows = new Map();
    const list = this.dialog.querySelector('#labAugmentList');
    for (const [id, up] of Object.entries(UPGRADES)) {
      const row = document.createElement('article');
      row.className = 'labAugment';
      row.style.setProperty('--augment-color', up.color);
      row.dataset.augment = id;
      // All content is from the checked-in augment catalogue, never user HTML.
      row.innerHTML = `<div class="labAugmentIcon" aria-hidden="true">${up.icon.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</div><div class="labAugmentCopy"><small>${up.category}</small><h4>${up.name}</h4><p>${up.desc}</p><span>${up.stack}</span></div><div class="labRank"><button type="button" data-rank-step="-1" aria-label="Remove one ${up.name} stack">−</button><label><span class="labVisuallyHidden">${up.name} rank</span><input type="number" min="0" max="50" step="1" value="0" data-rank-input="${id}" inputmode="numeric"></label><button type="button" data-rank-step="1" aria-label="Add one ${up.name} stack">+</button><small>STACKS</small></div>`;
      row.addEventListener('click', event => {
        const step = event.target.closest('[data-rank-step]');
        if (!step) return;
        const rank = (this.testing.snapshot().ranks?.[id] || 0) + Number(step.dataset.rankStep);
        this.run(() => this.testing.setAugmentRank(id, rank), `${up.name} / RANK ${Math.max(0, Math.min(50, rank))}`);
      });
      row.querySelector('input').addEventListener('change', event => {
        const rank = Number(event.target.value);
        this.run(() => this.testing.setAugmentRank(id, rank), `${up.name} / RANK ${Math.max(0, Math.min(50, Math.floor(rank)))}`);
        event.target.value = this.testing.snapshot().ranks?.[id] || 0;
      });
      this.augmentRows.set(id, row);
      list.append(row);
    }
  }

  _wire() {
    const $ = selector => this.dialog.querySelector(selector);
    $('#labClose').addEventListener('click', () => this.close());
    $('#labFly').addEventListener('click', () => this.close());
    $('#labExit').addEventListener('click', () => this.run(() => this.testing.exit()));
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); });
    this.dialog.addEventListener('click', event => {
      const tab = event.target.closest('[data-tab]');
      if (tab) this.selectTab(tab.dataset.tab);
      const ship = event.target.closest('[data-lab-ship]');
      if (ship) this.run(() => this.testing.setShip(ship.dataset.labShip), 'HULL SWAPPED. YOUR BUILD IS READY.');
      const preset = event.target.closest('[data-preset]');
      if (preset) this.run(() => this.testing.applyPreset(preset.dataset.preset), 'BUILD PRESET APPLIED.');
      const sound = event.target.closest('[data-sound]');
      if (sound) this.run(() => this.testing.playWeaponSound(sound.dataset.sound), `AUDITION / ${sound.dataset.sound.toUpperCase()}`);
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action) this._action(action);
    });
    this.dialog.querySelectorAll('[data-setting]').forEach(input => {
      input.addEventListener('change', () => this.run(() => this.testing.setSetting(input.dataset.setting, input.checked)));
    });
    $('#labTimeScale').addEventListener('change', event => this.run(() => this.testing.setSetting('timeScale', Number(event.target.value))));
    $('#labBloom').addEventListener('input', event => this.run(() => this.testing.setBloom(Number(event.target.value))));
    $('#labAugmentSearch').addEventListener('input', event => { this.search = event.target.value.toLowerCase().trim(); this._filterAugments(); });
    $('#labAugmentCategory').addEventListener('change', event => { this.category = event.target.value; this._filterAugments(); });

    // Capture before gameplay's global keys: typing a name must never fly,
    // fire, roll, pause, or pick a card underneath the native dialog.
    this._keyDown = event => {
      const editing = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName);
      const shortcut = event.code === 'F2' || (event.code === 'Backquote' && !editing);
      if (shortcut || (this.dialog.open && event.code === 'Escape')) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) this.dialog.open ? this.close() : this.open();
        return;
      }
      if (this.dialog.open) {
        // Native input editing and focus navigation keep their default action.
        // Handle tab-list arrows here, before blocking gameplay's listeners.
        if (event.target?.closest?.('.labNav')) {
          if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const tabs = ['pilot', 'augments', 'arena', 'effects'];
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? 3
              : (tabs.indexOf(this.activeTab) + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + 4) % 4;
            this.selectTab(tabs[index]); $(`#labTab-${tabs[index]}`).focus();
          }
        }
        event.stopImmediatePropagation();
      }
    };
    this._keyUp = event => { if (this.dialog.open || event.code === 'F2' || event.code === 'Backquote') event.stopImmediatePropagation(); };
    window.addEventListener('keydown', this._keyDown, true);
    window.addEventListener('keyup', this._keyUp, true);
  }

  _action(action) {
    const value = id => this.dialog.querySelector(`#${id}`).value;
    const t = this.testing;
    const actions = {
      restore: [() => t.restorePlayer(), 'HULL, SHIELD AND BOOST RESTORED.'],
      damage: [() => t.damagePlayer(40), 'APPLIED 40 TEST DAMAGE.'],
      shield: [() => t.breakShield(), 'SHIELD BROKEN. CLOSE THE CONSOLE TO TEST RECOVERY.'],
      dodge: [() => t.triggerDodge(), 'PERFECT-DODGE EFFECTS TRIGGERED.'],
      xp: [() => t.setXPLevel(Number(value('labXPLevel'))), `PLAYER LEVEL ${value('labXPLevel')} APPLIED.`],
      scene: [() => t.loadScene(value('labScene')), 'SCENE LOADED. CLOSE THE CONSOLE TO FLY.'],
      intro: [() => {
        const id = value('labScene');
        if (!['tower1', 'tower2', 'tower3', 'inhibitor', 'boss'].includes(id)) return false;
        t.loadScene(id, { introOnly: true });
        this.close();
      }, 'HOSTILE SIGNAL ACQUIRED.'],
      phase: [() => t.setBossPhase(Number(value('labBossPhase'))), `ADMIRAL PHASE ${value('labBossPhase')} READY.`],
      enemy: [() => t.spawnEnemy(value('labEnemyType'), Number(value('labEnemyCount'))), 'ENEMY SHIPS DEPLOYED.'],
      dummies: [() => t.spawnDummies(), 'TARGET DUMMIES READY. WATCH DAMAGE + DPS IN THE READOUT.'],
      bullets: [() => t.spawnBulletPattern(), 'HOSTILE FAN READY. CLOSE THE CONSOLE TO DODGE.'],
      scrap: [() => t.spawnScrap(), 'SCRAP CACHE DROPPED.'],
      clear: [() => t.clearArena(), 'RANGE CLEARED. YOUR BUILD IS KEPT.'],
      heat: [() => t.setHeat(Number(value('labHeat'))), `RIFT HEAT SET TO ${value('labHeat')}.`],
      bloomReset: [() => t.setBloom(null), 'BLOOM FOLLOWS THE SCENE AGAIN.'],
      fx: [() => t.burstFX(), 'VOXEL BURST READY. CLOSE THE CONSOLE TO WATCH.'],
    };
    if (actions[action]) this.run(...actions[action]);
  }

  run(action, message) {
    try {
      const result = action();
      this.lastMessage = result === false ? 'That action is unavailable here. Try the open test range.'
        : message || 'OVERRIDE UPDATED.';
    } catch (error) {
      this.lastMessage = `ACTION FAILED / ${error.message}`;
    }
    this.renderState();
  }

  open() {
    this.testing.game?.hangar?.close();
    if (!this.testing.active) this.testing.enter();
    Input.reset();
    this.testing.setPanelOpen(true);
    this.renderState();
  }

  close() {
    Input.reset();
    this.testing.setPanelOpen(false);
    this.renderState();
    this.badge.focus({ preventScroll: true });
  }

  selectTab(id) {
    this.activeTab = id;
    this.dialog.querySelectorAll('[data-tab]').forEach(tab => {
      const selected = tab.dataset.tab === id;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    this.dialog.querySelectorAll('.labPage').forEach(page => { page.hidden = page.id !== `labPage-${id}`; });
  }

  _filterAugments() {
    let visible = 0;
    for (const [id, row] of this.augmentRows) {
      const up = UPGRADES[id];
      const matches = (this.category === 'ALL' || up.category === this.category)
        && `${up.name} ${up.desc} ${up.stack}`.toLowerCase().includes(this.search);
      row.hidden = !matches;
      if (matches) visible++;
    }
    this.dialog.querySelector('#labNoAugments').hidden = visible > 0;
  }

  _telemetry(state) {
    const bolts = state.projectiles;
    const projectileCount = bolts && typeof bolts === 'object' ? Number(bolts.player || 0) + Number(bolts.enemy || 0) : bolts;
    const values = { hull: `${fmt(state.hp)} / ${fmt(state.maxHp)}`, shield: `${fmt(state.shield)} / ${fmt(state.maxShield)}`,
      projectiles: fmt(projectileCount), enemies: fmt(state.enemies), damage: fmt(state.dummyDamage), dps: fmt(state.dps) };
    for (const [key, value] of Object.entries(values)) this.dialog.querySelector(`[data-readout="${key}"]`).textContent = value;
    this.badge.querySelector('.labBadgeGod').textContent = state.settings?.godMode ? 'GOD MODE ON' : 'DAMAGE ON';
    this.badge.classList.toggle('labDamageOn', !state.settings?.godMode);
  }

  renderState() {
    const t = this.testing;
    const state = t.snapshot();
    const open = t.active && t.panelOpen;
    this.badge.hidden = !t.active || open;
    if (open && !this.dialog.open) {
      this.dialog.showModal();
      this.dialog.querySelector(`#labTab-${this.activeTab}`).focus({ preventScroll: true });
    } else if (!open && this.dialog.open) this.dialog.close();
    this.selectTab(this.activeTab);
    this._telemetry(state);
    this.dialog.querySelector('#labStatus').textContent = this.lastMessage;
    this.dialog.querySelectorAll('[data-setting]').forEach(input => { input.checked = !!state.settings?.[input.dataset.setting]; });
    this.dialog.querySelector('#labTimeScale').value = String(state.settings?.timeScale ?? 1);
    this.dialog.querySelectorAll('[data-lab-ship]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.labShip === state.shipId));
      const image = button.querySelector('img');
      const thumbnail = t.game?.hangar?.thumbnails?.get(button.dataset.labShip);
      if (thumbnail && !image.getAttribute('src')) { image.src = thumbnail; image.hidden = false; }
    });
    let total = 0;
    for (const [id, row] of this.augmentRows) {
      const rank = state.ranks?.[id] || 0;
      const input = row.querySelector('input');
      if (document.activeElement !== input) input.value = rank;
      row.classList.toggle('labAugmentOwned', rank > 0);
      row.querySelector('[data-rank-step="-1"]').disabled = rank <= 0;
      row.querySelector('[data-rank-step="1"]').disabled = rank >= 50;
      total += rank;
    }
    this.dialog.querySelector('#labBuildCount').textContent = `${total} STACK${total === 1 ? '' : 'S'}`;
    this.dialog.querySelector('#labSceneLabel').textContent = SCENES.find(([id]) => id === state.sceneId)?.[1] || 'TEST RANGE';
    if (document.activeElement !== this.dialog.querySelector('#labScene')) this.dialog.querySelector('#labScene').value = state.sceneId || 'sandbox';
    const bloom = state.settings?.bloom;
    this.dialog.querySelector('#labBloomValue').textContent = bloom == null ? 'SCENE DEFAULT' : `${Number(bloom).toFixed(2)}× GLOW`;
    if (bloom != null && document.activeElement !== this.dialog.querySelector('#labBloom')) this.dialog.querySelector('#labBloom').value = bloom;
  }
}
