/**
 * Team status for heads / deputies / unit admins (spec 5.13). Pure.
 */
var HHTeam = (function () {
  function S() { return typeof HHScan !== 'undefined' ? HHScan : require('./scan'); }

  /**
   * Teams the actor may view: unit admins see every team of their unit,
   * heads their own team, anyone the teams assigned to them today
   * (deputies also see their own team).
   * @return {string[]|null} team ids, or null = all teams in the unit
   */
  function visibleTeams(actor, assignments, workDate, allTeamIds) {
    if (actor.role === 'unit_admin' || actor.role === 'super_admin') return null;
    return allTeamIds.filter(function (teamId) {
      if (String(teamId) === String(actor.teamId)) return true;
      return S().coversTeam(actor, teamId, assignments, workDate, '');
    });
  }

  /**
   * One row per member: state for the day and that day's sessions.
   * @param {Object[]} members  Members rows (already limited to the actor's unit)
   * @param {Object[]} sessions WorkSessions rows
   * @param {string[]|null} teamIds from visibleTeams
   * @param {string} workDate
   * @param {function(Date): string} fmtTime  e.g. HHHours.bangkokTime
   */
  function build(members, sessions, teamIds, workDate, fmtTime) {
    var byStudent = {};
    sessions.forEach(function (s) {
      if (String(s.WorkDate) !== workDate) return;
      (byStudent[String(s.StudentID)] = byStudent[String(s.StudentID)] || []).push(s);
    });
    var rows = members
      .filter(function (m) { return m.Status === 'ACTIVE'; })
      .filter(function (m) { return teamIds === null || teamIds.indexOf(String(m.TeamID)) !== -1; })
      .map(function (m) {
        var list = (byStudent[String(m.StudentID)] || []).slice().sort(function (a, b) {
          return new Date(a.In) - new Date(b.In);
        });
        var hours = 0;
        var mapped = list.map(function (s) {
          hours += Number(s.CountedHours) || 0;
          return {
            in: s.In ? fmtTime(new Date(s.In)) : '',
            out: s.Out ? fmtTime(new Date(s.Out)) : '',
            countedHours: s.Out ? Number(s.CountedHours) || 0 : null,
            rawMinutes: s.Out ? Number(s.RawMinutes) || 0 : null,
            scannedInBy: String(s.ScannedInBy || ''),
            scannedOutBy: String(s.ScannedOutBy || ''),
            status: String(s.Status),
          };
        });
        var state = m.CurrentState === 'IN' ? 'IN' : (mapped.length > 0 ? 'LEFT' : 'NOT_HERE');
        return {
          studentId: String(m.StudentID),
          nickname: String(m.Nickname),
          fullName: String(m.FirstName) + ' ' + String(m.LastName),
          teamId: String(m.TeamID),
          role: String(m.Role),
          state: state,
          sessions: mapped,
          hoursToday: hours,
        };
      });
    var order = { IN: 0, LEFT: 1, NOT_HERE: 2 };
    rows.sort(function (a, b) {
      return order[a.state] - order[b.state] || a.teamId.localeCompare(b.teamId) || a.nickname.localeCompare(b.nickname, 'th');
    });
    return {
      workDate: workDate,
      counts: {
        in: rows.filter(function (r) { return r.state === 'IN'; }).length,
        left: rows.filter(function (r) { return r.state === 'LEFT'; }).length,
        notHere: rows.filter(function (r) { return r.state === 'NOT_HERE'; }).length,
      },
      members: rows,
    };
  }

  return { visibleTeams: visibleTeams, build: build };
})();

if (typeof module !== 'undefined') module.exports = HHTeam;
