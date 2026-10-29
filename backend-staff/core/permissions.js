/**
 * Single permissions table for every API action (spec section 7).
 *
 * minRole: lowest role allowed to call the action ('public' = no login).
 *          Roles are ranked; a higher role can do everything a lower one can.
 * scope:   which records the action may touch. Enforced again inside each
 *          handler; this table documents it and lets tests check coverage.
 *          self  = only the caller's own records (no studentId parameter)
 *          team  = teams the caller heads / is assigned to scan
 *          unit  = the caller's unit
 *          all   = every unit (super_admin)
 *          none  = touches no member records
 */
var HHPermissions = (function () {
  var ROLE_RANK = {
    member: 1,
    deputy: 2,
    head: 3,
    unit_admin: 4,
    super_admin: 5,
  };

  var ACTIONS = {
    // system
    'health': { minRole: 'public', scope: 'none' },

    // auth
    'auth.activate': { minRole: 'public', scope: 'self' },
    'auth.login': { minRole: 'public', scope: 'self' },
    'auth.logout': { minRole: 'member', scope: 'self' },
    'auth.me': { minRole: 'member', scope: 'self' },

    // member
    'me.card': { minRole: 'member', scope: 'self' },
    'me.today': { minRole: 'member', scope: 'self' },
    'me.history': { minRole: 'member', scope: 'self' },
    'me.schedule': { minRole: 'member', scope: 'self' },
    'me.reports': { minRole: 'member', scope: 'self' },
    'me.report.create': { minRole: 'member', scope: 'self' },
    // Not in spec v4: heads/deputies report themselves in/out; counted only after admin approval.
    'me.selfReport': { minRole: 'deputy', scope: 'self' },

    // scan
    'scan.lookup': { minRole: 'deputy', scope: 'team' },
    'scan.confirm': { minRole: 'deputy', scope: 'team' },

    // head
    'team.status': { minRole: 'deputy', scope: 'team' },
    'team.reports': { minRole: 'head', scope: 'team' },
    'team.report.resolve': { minRole: 'head', scope: 'team' },
    'team.activationCode.issue': { minRole: 'head', scope: 'team' },
    'correction.propose': { minRole: 'head', scope: 'team' },

    // admin
    'correction.list': { minRole: 'unit_admin', scope: 'unit' },
    'correction.approve': { minRole: 'unit_admin', scope: 'unit' },
    'correction.reject': { minRole: 'unit_admin', scope: 'unit' },
    'roster.import': { minRole: 'unit_admin', scope: 'unit' },
    'roster.update': { minRole: 'unit_admin', scope: 'unit' },
    'role.set': { minRole: 'unit_admin', scope: 'unit' },
    'scanner.assign': { minRole: 'unit_admin', scope: 'unit' },
    'code.reissue': { minRole: 'unit_admin', scope: 'unit' },
    'schedule.import': { minRole: 'unit_admin', scope: 'unit' },
    'schedule.update': { minRole: 'unit_admin', scope: 'unit' },
    'period.close': { minRole: 'unit_admin', scope: 'unit' },
    'period.reopen': { minRole: 'super_admin', scope: 'all' },
    'export.summary': { minRole: 'unit_admin', scope: 'unit' },
    'dashboard.get': { minRole: 'unit_admin', scope: 'unit' },
    'rebuild.fromLog': { minRole: 'unit_admin', scope: 'unit' },
  };

  function isKnownAction(action) {
    return Object.prototype.hasOwnProperty.call(ACTIONS, action);
  }

  function isRole(role) {
    return Object.prototype.hasOwnProperty.call(ROLE_RANK, role);
  }

  function rule(action) {
    return isKnownAction(action) ? ACTIONS[action] : null;
  }

  function isPublic(action) {
    var r = rule(action);
    return !!r && r.minRole === 'public';
  }

  /** True if `role` is at least `minRole`. */
  function atLeast(role, minRole) {
    if (minRole === 'public') return true;
    if (!isRole(role) || !isRole(minRole)) return false;
    return ROLE_RANK[role] >= ROLE_RANK[minRole];
  }

  /**
   * Can a caller with `role` (null when not logged in) call `action`?
   * @return {{allowed: boolean, reason: (string|null)}}
   */
  function check(action, role) {
    var r = rule(action);
    if (!r) return { allowed: false, reason: 'UNKNOWN_ACTION' };
    if (r.minRole === 'public') return { allowed: true, reason: null };
    if (!role) return { allowed: false, reason: 'UNAUTHENTICATED' };
    if (!atLeast(role, r.minRole)) return { allowed: false, reason: 'FORBIDDEN' };
    return { allowed: true, reason: null };
  }

  return {
    ROLE_RANK: ROLE_RANK,
    ACTIONS: ACTIONS,
    isKnownAction: isKnownAction,
    isRole: isRole,
    rule: rule,
    isPublic: isPublic,
    atLeast: atLeast,
    check: check,
  };
})();

if (typeof module !== 'undefined') module.exports = HHPermissions;
