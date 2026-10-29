'use strict';
// How a stored permissions record is read: the defaults it falls back to, what a missing action key
// means, which actions are never inherited from a master switch, how a scope is understood. The
// catalogue (./permissions-catalogue) is the data; this is the rule that reads it.
//
// Moved here, unchanged in behaviour, from src/routes/employee-portal.js. The two things the rule
// used to reach for through the server's context — the deal stages a scope may name and the
// normaliser for a lead status — are passed in, so this file depends on nothing.

const {
  DEFAULT_PERMISSIONS,
  PERM_ACTIONS,
  PERM_LEGACY,
  PERM_ACTION_FALLBACK,
  PERM_ACTION_NEVER_INHERIT,
  PERM_GROUPS,
  PERM_SECTION_LABELS,
  PERM_ACTION_LABELS,
  PERM_READISH,
} = require('./permissions-catalogue');

/**
 * @typedef {{ assignedOnly: boolean, dealStages: string[], leadStatuses: string[] }} Scope
 * @typedef {{ dealStages: readonly string[], normStatus: (status: unknown) => string }} NormaliseDeps
 */

/**
 * The permissions of an employee as the portals and the guards read them: every section a flag, every
 * section's actions an explicit true/false map, and the data scope.
 * @param {any} raw what is stored (any shape the record has ever had)
 * @param {NormaliseDeps} deps
 * @returns {Record<string, any>}
 */
function normalisePermissions(raw, deps) {
  /** @type {Record<string, any>} */
  const p = { ...DEFAULT_PERMISSIONS, ...(raw || {}) };
  for (const [section, actions] of Object.entries(PERM_ACTIONS)) {
    const master = p[section] === true;
    const given =
      raw && raw[section + 'Actions'] && typeof raw[section + 'Actions'] === 'object'
        ? raw[section + 'Actions']
        : null;
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const a of actions) {
      const legacy = PERM_LEGACY[section + '.' + a];
      const fallback = PERM_ACTION_FALLBACK[section + '.' + a];
      const never = PERM_ACTION_NEVER_INHERIT.has(section + '.' + a);
      out[a] = given
        ? // An explicit answer always wins; a MISSING key predates the action.
          a in given
          ? given[a] === true
          : never
            ? false
            : fallback
              ? fallback(given, p)
              : false
        : // No actions object at all: master on ⇒ all, except older flat flags.
          never
          ? false
          : legacy
            ? master && legacy(p)
            : master;
    }
    p[section + 'Actions'] = out;
  }
  // Keep the flat flag in step with the action, so anything still reading it — a
  // saved automation, an old client cached in a service worker — sees one answer.
  p.viewAllRequests = p.requestsActions.viewAll === true;
  /** @type {Record<string, any>} */
  const s = raw && typeof raw.scope === 'object' && raw.scope ? raw.scope : {};
  p.scope = {
    assignedOnly: s.assignedOnly === true,
    dealStages: Array.isArray(s.dealStages)
      ? s.dealStages.filter((/** @type {string} */ x) => deps.dealStages.includes(x))
      : [],
    leadStatuses: Array.isArray(s.leadStatuses)
      ? s.leadStatuses.map((/** @type {unknown} */ x) => deps.normStatus(x)).filter(Boolean)
      : [],
  };
  return p;
}

// Expand a preset into the same permissions shape the editor saves, so the
// client applies a server-built object rather than reimplementing the rules.
/**
 * @param {{ sections?: string[], readOnly?: string[], all?: boolean }} preset
 * @returns {Record<string, any>}
 */
function permPresetPerms(preset) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [section, actions] of Object.entries(PERM_ACTIONS)) {
    const full = preset.all === true || (preset.sections || []).includes(section);
    const read = !full && (preset.readOnly || []).includes(section);
    out[section] = full || read;
    /** @type {Record<string, boolean>} */
    const acts = {};
    actions.forEach(a => {
      acts[a] = full || (read && PERM_READISH.includes(a));
    });
    out[section + 'Actions'] = acts;
  }
  return out;
}

/**
 * The catalogue the admin's editor is built from: groups of sections, each with its labelled actions.
 * @returns {{ group: string, sections: { key: string, label: string, defaultOn: boolean, actions: { key: string, label: string }[] }[] }[]}
 */
function permCatalogue() {
  return PERM_GROUPS.map(g => ({
    group: g.group,
    sections: g.sections
      .filter(s => PERM_ACTIONS[s])
      .map(s => ({
        key: s,
        label: PERM_SECTION_LABELS[s] || s,
        defaultOn: DEFAULT_PERMISSIONS[s] === true,
        actions: (PERM_ACTIONS[s] || []).map(a => ({
          key: a,
          label: PERM_ACTION_LABELS[s + '.' + a] || PERM_ACTION_LABELS[a] || a,
        })),
      })),
  }));
}

module.exports = { normalisePermissions, permPresetPerms, permCatalogue };
