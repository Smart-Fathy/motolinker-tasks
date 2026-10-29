'use strict';
// Can this person do that? One answer, for the server's guards and for the portals' navigation.

/**
 * Can this employee perform <action> in <section>? Master must be on AND the action allowed.
 * (Moved here, unchanged, from src/routes/employee-portal.js, where it was empCan.)
 * @param {{ permissions?: Record<string, any>, job_title?: string } | null | undefined} emp
 * @param {string} section
 * @param {string} action
 * @returns {boolean}
 */
// Can this employee perform <action> in <section>? Master must be on AND the action allowed.
function employeeCan(emp, section, action) {
  const p = emp && emp.permissions;
  if (!p) return false;
  // The Issues centre belonged to the CTO by job title before it had a permission.
  // Honouring that here means nobody loses it the moment the section gains a
  // switch; the switch is now how anyone *else* is given it.
  if (section === 'issues' && /chief technical officer/i.test(emp.job_title || '')) return true;
  if (p[section] !== true) return false;
  const acts = p[section + 'Actions'];
  return !!(acts && acts[action] === true);
}

module.exports = { employeeCan };
