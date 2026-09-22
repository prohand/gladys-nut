// -----------------------------------------------------------------------------
// Interpretation of the NUT `ups.status` variable.
//
// NUT reports the UPS state as a space-separated list of flags ("OL CHRG",
// "OB DISCHRG LB", ...). The dashboard widget, the scene triggers and the
// scene actions all need the same reading of those flags, so it lives here.
// See https://networkupstools.org/docs/developer-guide.chunked/new-drivers.html
// for the list of standard flags.
// -----------------------------------------------------------------------------

// Primary states, from the most to the least serious. The first match wins.
// The `key` is exposed to the scenes (output `status` of `get_ups_status`):
// never rename one.
const PRIMARY_STATES = [
  {
    key: 'forced_shutdown',
    matches: (flags) => flags.has('FSD'),
    label: { en: 'Forced shutdown', fr: 'Arrêt forcé' },
    color: 'danger',
  },
  {
    key: 'low_battery',
    matches: (flags) => flags.has('OB') && flags.has('LB'),
    label: { en: 'Low battery', fr: 'Batterie faible' },
    color: 'danger',
  },
  {
    key: 'on_battery',
    matches: (flags) => flags.has('OB'),
    label: { en: 'On battery', fr: 'Sur batterie' },
    color: 'warning',
  },
  {
    key: 'off',
    matches: (flags) => flags.has('OFF'),
    label: { en: 'Output off', fr: 'Sortie coupée' },
    color: 'danger',
  },
  {
    key: 'bypass',
    matches: (flags) => flags.has('BYPASS'),
    label: { en: 'On bypass', fr: 'En bypass' },
    color: 'warning',
  },
  {
    key: 'online',
    matches: (flags) => flags.has('OL'),
    label: { en: 'On mains', fr: 'Sur secteur' },
    color: 'success',
  },
];

const UNKNOWN_STATE = {
  key: 'unknown',
  label: { en: 'Unknown', fr: 'Inconnu' },
  color: 'neutral',
};

/**
 * Split a raw `ups.status` value into its flags.
 * @param {string|undefined} rawStatus - The `ups.status` value reported by NUT.
 * @returns {Set<string>} The upper-case flags, empty when the status is missing.
 */
export function parseStatusFlags(rawStatus) {
  return new Set(
    String(rawStatus ?? '')
      .toUpperCase()
      .split(/\s+/)
      .filter(Boolean),
  );
}

/**
 * Read the state of a UPS from its NUT variables.
 * @param {Map<string, string>} variables - The variables returned by LIST VAR.
 * @returns {object} `{ raw, flags, key, label, color, onBattery, lowBattery,
 * replaceBattery, overload, charging }`.
 */
export function readUpsStatus(variables) {
  const raw = String(variables.get('ups.status') ?? '').trim();
  const flags = parseStatusFlags(raw);
  const primary = PRIMARY_STATES.find((state) => state.matches(flags)) ?? UNKNOWN_STATE;
  return {
    raw,
    flags,
    key: primary.key,
    label: primary.label,
    color: primary.color,
    onBattery: flags.has('OB'),
    lowBattery: flags.has('LB'),
    replaceBattery: flags.has('RB'),
    overload: flags.has('OVER'),
    charging: flags.has('CHRG'),
  };
}

/**
 * Format a runtime in seconds as a short text, e.g. "14 min" or "1 h 25".
 * @param {number} seconds - The `battery.runtime` value.
 * @returns {string} The formatted duration, at most 12 characters.
 */
export function formatRuntime(seconds) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours >= 100) {
    return `${hours} h`;
  }
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}
