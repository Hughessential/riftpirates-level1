/** Authored approach beats use traversal time; choosing augments freezes it. */
export const OUTER_APPROACH = {
  beats: [
    { at: 0, title: 'BREAK THE PICKET', detail: 'Destroy the scout patrols · SPACE fire / F lock-on', speed: 34, asteroidRate: 0.15 },
    { at: 22, title: 'RAID THE WRECKLINE', detail: 'Follow the gold salvage · dodge the magenta gates', speed: 44, asteroidRate: 0.38 },
    { at: 54, title: 'BREAK THE BLOCKADE', detail: 'Drop the shield drone, then hunt the blockade ace', speed: 32, asteroidRate: 0.12 },
    { at: 88, title: 'BREACH VECTOR', detail: 'Three augments online · punch through to the tower', speed: 54, asteroidRate: 0.22 },
  ],
  events: [
    { at: 2, type: 'wave', enemies: ['scout', 'scout', 'scout'], formation: 'v' },
    { at: 9, type: 'wave', enemies: ['scout', 'gunship'], formation: 'left' },
    { at: 15, type: 'wave', enemies: ['scout', 'scout'], formation: 'right' },
    { at: 19, type: 'wave', enemies: ['gunship', 'scout'], formation: 'v', cue: 'STRIKER SIGNAL', hint: 'Watch its locked crossing lances' },
    { at: 24, type: 'salvage', x: -10, y: 3 },
    { at: 26, type: 'gate', x: 5, y: 0, rotation: 0 },
    { at: 30, type: 'wave', enemies: ['gunship', 'scout', 'scout'], formation: 'right' },
    { at: 34, type: 'salvage', x: 10, y: 5 },
    { at: 36, type: 'gate', x: -5, y: 2, rotation: 0.3 },
    { at: 42, type: 'wave', enemies: ['scout', 'scout', 'scout'], formation: 'v' },
    { at: 46, type: 'salvage', x: 0, y: 7 },
    { at: 49, type: 'wave', enemies: ['heavy', 'scout'], formation: 'left', cue: 'SIEGE JET INBOUND', hint: 'Marked mine clusters explode after the warning' },
    { at: 57, type: 'wave', enemies: ['gunship', 'shielder', 'gunship'], formation: 'v', cue: 'SHIELD ESCORT', hint: 'Destroy the central shield drone first' },
    { at: 66, type: 'ace' },
    { at: 77, type: 'wave', enemies: ['scout', 'shielder', 'gunship'], formation: 'left' },
    { at: 90, type: 'wave', enemies: ['gunship', 'heavy', 'gunship'], formation: 'v', cue: 'FINAL PICKET', hint: 'Put your new build to work' },
    { at: 97, type: 'salvage', x: 0, y: 3 },
  ],
};
