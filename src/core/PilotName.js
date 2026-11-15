/** Pilot identity limits are shared by persistence, typed and controller entry. */
export const PILOT_NAME_DEFAULT = 'PIRATE';
export const PILOT_NAME_MAX = 16;
export const PILOT_IDENTITY_DEFAULTS = Object.freeze({
  pilotName: PILOT_NAME_DEFAULT,
  pilotNameConfirmed: false,
});

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
export function pilotNameCharacters(value) {
  return segmenter ? [...segmenter.segment(value)].map(item => item.segment) : Array.from(value);
}

/** Reject before trimming: invisible controls must never disappear silently.
 * Combining marks are allowed only after a Unicode letter/number. NFC keeps
 * ordinary accented names intact without compatibility-changing a pilot's name. */
export function validatePilotName(raw) {
  if (typeof raw !== 'string') return { valid: false, name: '', error: 'Enter a pilot name, or choose PIRATE.' };
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u.test(raw)) {
    return { valid: false, name: '', error: 'Invisible controls and line breaks are not allowed.' };
  }
  const name = raw.normalize('NFC').replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ');
  if (!name) return { valid: false, name, error: 'Enter a name, or choose PIRATE to fly now.' };
  if (!/^(?:[\p{L}\p{N}][\p{M}]*|[ _-])+$/u.test(name)) {
    return { valid: false, name, error: 'Use letters, numbers, spaces, hyphens or underscores.' };
  }
  const length = pilotNameCharacters(name).length;
  if (length > PILOT_NAME_MAX) return { valid: false, name, error: `Keep your name to ${PILOT_NAME_MAX} visible characters.` };
  return { valid: true, name, error: '', length };
}

export function safePilotName(raw) {
  const result = validatePilotName(raw);
  return result.valid ? result.name : PILOT_NAME_DEFAULT;
}
