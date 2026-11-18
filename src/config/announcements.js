/** Developer-maintained transmissions. See docs/announcements.md for the schema.
 * No release notes or future commitments have been published for this build.
 * Keep concept-art copy out of this feed until it is approved for publication.
 */
export const ANNOUNCEMENTS = [];

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
