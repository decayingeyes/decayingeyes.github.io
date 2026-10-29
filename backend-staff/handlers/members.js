/**
 * Member management for the admin page: list members and assign positions.
 * Positions are assigned only here (decision 2026-10-30).
 */

var ROLE_TH = {
  member: 'สมาชิก', deputy: 'รองหัวหน้าทีม', head: 'หัวหน้าทีม',
  unit_admin: 'แอดมินแผนก', super_admin: 'ผู้ดูแลระบบสูงสุด',
};

function handleRosterList_(payload, ctx) {
  var unitId = String(ctx.actor.unitId);
  var teams = unitRows_('Teams', unitId);
  var depts = {};
  unitRows_('Departments', unitId).forEach(function (d) { depts[String(d.DeptID)] = { name: String(d.Name), color: String(d.Color || '#888') }; });
  var teamName = {};
  teams.forEach(function (t) { teamName[String(t.TeamID)] = String(t.Name); });
  var withPhoto = HHPhotos.idsWithPhoto(unitId);
  var members = unitRows_('Members', unitId).filter(function (m) {
    return m.Status !== 'REJECTED' && m.Status !== 'PENDING';
  }).map(function (m) {
    var dept = depts[String(m.DeptID)] || { name: '', color: '#888' };
    return {
      studentId: String(m.StudentID), nickname: String(m.Nickname),
      fullName: String(m.FirstName) + ' ' + String(m.LastName),
      teamId: String(m.TeamID), teamName: teamName[String(m.TeamID)] || '',
      deptName: dept.name, deptColor: dept.color,
      role: String(m.Role), roleTh: ROLE_TH[m.Role] || String(m.Role),
      activated: !!m.PasswordHash, status: String(m.Status), hasPhoto: !!withPhoto[String(m.StudentID)],
      // What this admin may change it to (empty = locked for this admin).
      canSetTo: Object.keys(ROLE_TH).filter(function (r) {
        return r !== String(m.Role) && !HHAuth.roleChangeProblem(ctx.actor, m, r);
      }),
    };
  });
  var rank = HHPermissions.ROLE_RANK;
  members.sort(function (a, b) {
    return rank[b.role] - rank[a.role] || a.teamName.localeCompare(b.teamName, 'th') || a.nickname.localeCompare(b.nickname, 'th');
  });
  var unit = unitRows_('Units', unitId)[0];
  return {
    unitName: unit ? String(unit.Name) : '',
    members: members,
    teams: teams.map(function (t) { return { teamId: String(t.TeamID), name: String(t.Name) }; }),
    roles: Object.keys(ROLE_TH).map(function (r) { return { role: r, th: ROLE_TH[r] }; }),
  };
}

function handleRoleSet_(payload, ctx) {
  var newRole = String(payload.role || '');
  return HHLock.withLock(function () {
    var row = HHRepo.findBy('Members', 'StudentID', HHAuth.normalizeStudentId(payload.studentId));
    if (!row) throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบรหัสนักศึกษานี้');
    var problem = HHAuth.roleChangeProblem(ctx.actor, row.data, newRole);
    if (problem) throw new HHErrors.AppError('FORBIDDEN', problem);
    var old = String(row.data.Role);
    if (old === newRole) return { studentId: String(row.data.StudentID), role: newRole, roleTh: ROLE_TH[newRole] };
    HHRepo.update('Members', row.row, { Role: newRole });
    HHSessions.invalidateMember(String(row.data.StudentID));
    HHLog.append({
      requestId: ctx.requestId, unitId: row.data.UnitID, studentId: row.data.StudentID, action: 'ROLE_SET',
      actorId: ctx.actor.studentId, method: 'ADMIN', note: old + ' -> ' + newRole,
    });
    return { studentId: String(row.data.StudentID), role: newRole, roleTh: ROLE_TH[newRole] };
  });
}

/** payload: { studentId, photo: "data:image/jpeg;base64,…" | "" (remove) } */
function handlePhotoSet_(payload, ctx) {
  var dataUrl = payload.photo === undefined || payload.photo === null ? '' : String(payload.photo);
  return HHLock.withLock(function () {
    var row = HHRepo.findBy('Members', 'StudentID', HHAuth.normalizeStudentId(payload.studentId));
    if (!row) throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบรหัสนักศึกษานี้');
    var cfg = HHConfig.get();
    var covers = HHScan.coversTeam(ctx.actor, row.data.TeamID, unitRows_('ScannerAssignments', row.data.UnitID),
      HHHours.workDate(new Date(), cfg.WORKDAY_START_HOUR), '');
    var problem = HHAuth.photoProblem(ctx.actor, row.data, dataUrl, covers);
    if (problem) throw new HHErrors.AppError('VALIDATION', problem);
    HHPhotos.set(row.data, dataUrl, ctx.actor.studentId);
    HHLog.append({ requestId: ctx.requestId, unitId: row.data.UnitID, studentId: row.data.StudentID, action: 'PHOTO_SET',
      actorId: ctx.actor.studentId, method: 'ADMIN', note: dataUrl ? 'set (' + dataUrl.length + ' chars)' : 'removed' });
    return { studentId: String(row.data.StudentID), hasPhoto: !!dataUrl };
  });
}

/** Self sign-ups waiting for this admin's unit. */
function handleSignupList_(payload, ctx) {
  return unitRows_('Members', ctx.actor.unitId)
    .filter(function (m) { return m.Status === 'PENDING'; })
    .map(function (m) {
      return {
        studentId: String(m.StudentID), nickname: String(m.Nickname),
        fullName: String(m.FirstName) + ' ' + String(m.LastName),
        signedUpAt: m.ActivatedAt ? HHHours.bangkokDate(new Date(m.ActivatedAt)) + ' ' + HHHours.bangkokTime(new Date(m.ActivatedAt)) : '',
      };
    });
}

/** payload: { studentId, approve: boolean } — approve -> ACTIVE member; reject -> REJECTED (may sign up again). */
function handleSignupReview_(payload, ctx) {
  return HHLock.withLock(function () {
    var row = HHRepo.findBy('Members', 'StudentID', HHAuth.normalizeStudentId(payload.studentId));
    if (!row || row.data.Status !== 'PENDING') throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบผู้สมัครที่รออนุมัติ');
    if (ctx.actor.role !== 'super_admin' && String(row.data.UnitID) !== String(ctx.actor.unitId)) {
      throw new HHErrors.AppError('FORBIDDEN', 'ผู้สมัครคนนี้อยู่แผนกอื่น');
    }
    var approve = payload.approve === true;
    HHRepo.update('Members', row.row, approve
      ? { Status: 'ACTIVE' }
      : { Status: 'REJECTED', PasswordHash: '', Salt: '' });
    HHSessions.invalidateMember(String(row.data.StudentID));
    HHLog.append({ requestId: ctx.requestId, unitId: row.data.UnitID, studentId: row.data.StudentID,
      action: approve ? 'SIGNUP_APPROVE' : 'SIGNUP_REJECT', actorId: ctx.actor.studentId, method: 'ADMIN' });
    return { studentId: String(row.data.StudentID), status: approve ? 'ACTIVE' : 'REJECTED' };
  });
}
