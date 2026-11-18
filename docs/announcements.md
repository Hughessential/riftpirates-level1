# Patches & Updates

The title-screen transmission console is implemented in `src/ui/PatchesPanel.js` and `src/ui/patches-panel.css`. It uses the existing title, ship artwork, pixel font, save system and controller router. There are no new runtime dependencies or backend services.

## Publishing content

Edit `src/config/announcements.js`. The feed intentionally starts empty: the reference artwork is a visual specification, not a release record. Do not publish its sample version, Mech Arena feature or future promises without confirmation.

Add objects to `ANNOUNCEMENTS` using this structure (the example is a draft, not a real announcement):

```js
{
  id: 'unique-stable-announcement-id',
  category: 'patch', // patch | upcoming | roadmap
  published: false, // set true only when approved for publication
  retired: false,
  order: 0, // ascending for upcoming/roadmap; dates break ties
  title: 'Approved announcement title',
  version: 'approved version', // optional
  date: '2026-11-17', // optional publication date; future dates stay hidden
  status: 'released', // planned | in-development | testing | released
  summary: 'A short, player-facing overview.',
  image: 'images/ships/gold-revenant.webp', // optional, relative to assets/
  imageAlt: 'Gold Revenant ship',
  video: 'videos/approved-preview.webm', // optional, controls and no autoplay
  releaseWindow: 'An approved release window', // optional; never invent one
  highlights: ['A confirmed feature'],
  details: ['Detailed notes'], // string or array
  balance: ['Approved balance adjustment'],
  fixes: ['Confirmed bug fix'],
  performance: ['Confirmed performance improvement'],
}
```

Use `patch` for release notes, `upcoming` for confirmed previews, and `roadmap` for milestones. Latest Patch displays the most recent published patch by date; if dates are absent, configuration order is used. The other channels show all published entries in their configured order. Retire an entry with `retired: true`, or unpublish it with `published: false`. Duplicate IDs, unknown categories, invalid dates and future publication dates are excluded. Text is rendered as text, never HTML. Media accepts curated asset paths or explicit HTTPS URLs.

Keep IDs stable for editorial corrections. Publish a new ID for a new announcement so returning players receive a NEW indicator. New content is loaded with the next page load; there is no remote polling.

## Window and input behavior

The first visit is collapsed. Click the masthead tab to open the nonmodal window. Drag the header, or resize the right edge, bottom edge or corner using pointer input. Pointer capture keeps gestures stable outside the window; cancellation, blur and disposal clean up the interaction. Geometry is clamped to the viewport. Resizing the viewport also restores safe defaults if a customized position covers essential menu controls.

At widths of 700px or less (and landscape screens up to 900px wide and 500px high), the console becomes a scrollable bottom sheet; drag/resize are disabled and desktop geometry is retained. Reset Window Layout clears custom geometry. The component exposes `destroy()` to release listeners and observers.

`Save.data.patchesWindow` stores a versioned schema containing geometry, expanded state, selected tab and seen announcement IDs. It uses the game's existing localStorage/in-memory fallback. Invalid or old schema values are ignored; numeric geometry is clamped. The window stays inside the title-screen subtree and disappears when gameplay starts.

Keyboard: Tab moves through controls, Enter/Space activates buttons, Left/Right/Home/End select channels when a tab is focused, and Escape closes with focus restored to the masthead button. Controller: the existing physical A/Back conventions apply, LB/RB switch channels, and the focusable content area supports D-pad scrolling. Other modal menus retain priority. Reduced motion disables decorative animation and transitions.

NEW represents only reachable, unread announcements. A headline and summary must be at least 75% visible in the scrolling content for 900ms while the title is active and unobscured by a modal. Opening a channel does not mark offscreen cards read. Test fixture announcements are injected only by the browser test and never ship in the feed.

## Verification

Run the dev server, then `npm run test:patches`. Set `RIFT_TEST_URL` for a different port and `RIFT_BROWSER_PATH` for a Chromium-compatible executable. On macOS the test finds Google Chrome or Brave. Browser captures are written to the ignored `shots/` directory.

The test covers keyboard activation, all resize handles, dragging, layout/tab/expanded persistence, desktop/tablet/mobile bounds, tab content, read tracking, reduced motion, simulated physical-controller input and the existing launch/options/identity/ship controls. The normal project build and regression suites remain separate checks.

## Implementation files

- `src/config/announcements.js`: maintained feed and publication filtering.
- `src/ui/PatchesPanel.js`: window, content, pointer gestures, focus and read tracking.
- `src/ui/PatchesState.js`: saved-state validation and viewport constraints.
- `src/ui/patches-panel.css`: reference-inspired chassis, tabs, transitions and responsive sheet.
- `src/main.js`: title-screen initialization.
- `src/core/SaveSystem.js`: additive panel-preference field.
- `src/ui/ControllerMenus.js`: nonmodal focus ownership, channel switching, content scrolling and primary-action focus.
- `tests/patches-panel.mjs` and `package.json`: dedicated interaction and responsive regression command.
- `tests/final-escape.mjs`: legacy-save expectation includes the new nullable preference field.
- `docs/announcements.md`: publishing and maintenance instructions.

## Validation scope

Browser checks use headless Brave with a temporary profile because this machine does not have the Chrome executable hard-coded by the older suites. Those suites run unchanged through a temporary external executable override. Touch and controller checks use emulated browser input; physical-device and Safari testing have not been performed. The production feed is empty until approved announcements are added.

Completed checks: `npm run build`, `npm test`, `npm run test:menu`, `npm run test:controllers`, `npm run test:patches`, and `git diff --check` all passed. The panel suite checked 1663×946, 1280×720, 1024×768, 820×1180, 390×844, 375×667 and 844×390. The existing menu suite also passed its six desktop sizes at 80%, 110% and 140% UI scale. No missing assets or browser errors were reported by the panel suite.
