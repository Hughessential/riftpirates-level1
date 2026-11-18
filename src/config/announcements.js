/** Approved, developer-maintained transmissions. See docs/announcements.md. */
export const ANNOUNCEMENTS = [
  {
    id: 'beta-transmission-console',
    category: 'patch', published: true, status: 'released',
    date: '2026-11-18', title: 'BETA: PATCHES & UPDATES',
    summary: 'Keep up with Rift Pirates directly from the title screen.',
    highlights: [
      'New Patches & Updates console with Latest Patch, Upcoming, and Roadmap channels.',
      'Drag and resize the window, with your layout and selected channel saved between visits.',
      'Unread announcements now display a NEW indicator.',
      'The title-screen version now carries the BETA label.',
    ],
    details: 'The console supports keyboard, touch, and controller navigation, with a compact sheet on smaller screens.',
  },
  {
    id: 'upcoming-augment-system-overhaul',
    category: 'upcoming', published: true, status: 'in-development', order: 1,
    date: '2026-11-18', title: 'AUGMENT SYSTEM OVERHAUL',
    summary: 'The augment system is being overhauled.',
    details: 'A major update to the augment system is on the way. Specific system changes and release timing will be shared in a future transmission.',
  },
  {
    id: 'upcoming-25-ascendant-mythic-augments',
    category: 'upcoming', published: true, status: 'planned', order: 2,
    date: '2026-11-18', title: '25 NEW ASCENDANT MYTHIC AUGMENTS',
    summary: '25 new Ascendant Mythic augments are coming to Rift Pirates.',
    details: 'This addition is part of the upcoming augment update. Individual augment reveals, abilities, and release timing have not yet been announced.',
  },
  {
    id: 'upcoming-game-progression-expansion',
    category: 'upcoming', published: true, status: 'in-development', order: 3,
    date: '2026-11-18', title: 'EXPANDED GAME PROGRESSION',
    summary: 'The entire game progression is being extended, improved, and updated—with more fun at the heart of the changes.',
    highlights: ['Extended game progression.', 'Improvements throughout the progression experience.', 'An update focused on making the journey more fun.'],
    details: 'The progression update is in development. Specific additions and release timing will be announced when more details are ready.',
  },
];

export const ANNOUNCEMENT_TABS = ['patch', 'upcoming', 'roadmap'];
export const ANNOUNCEMENT_STATUSES = ['planned', 'in-development', 'testing', 'released'];

export function publishedAnnouncements(entries, now = Date.now()) {
  const ids = new Set();
  return entries.filter(entry => {
    if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) ||
        entry.published !== true || entry.retired === true || !ANNOUNCEMENT_TABS.includes(entry.category) ||
        typeof entry.title !== 'string' || !entry.title.trim()) return false;
    if (entry.date && (typeof entry.date !== 'string' || !Number.isFinite(Date.parse(entry.date)) || Date.parse(entry.date) > now)) return false;
    ids.add(entry.id);
    return true;
  }).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) ||
    (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
