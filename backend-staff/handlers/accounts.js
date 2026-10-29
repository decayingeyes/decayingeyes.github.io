/**
 * Account services shared by API handlers and the spreadsheet menu:
 * roster import and activation code issuing.
 */
var HHAccounts = (function () {
  function pepper_() {
    var p = HHProps.get(HHProps.KEYS.PASSWORD_PEPPER);
    if (!p) throw new HHErrors.AppError('NOT_CONFIGURED', null, 'PASSWORD_PEPPER missing');
    return p;
  }

  function newCodeFor_(studentId) {
    var code = HHAuth.newActivationCode(HHCrypto.randInt);
    return { code: code, hash: HHAuth.hashActivationCode(code, pepper_(), HHCrypto.sha256Hex) };
  }

  /**
   * Import roster rows (2D array incl. header). New members get an activation code.
   * @param {Array<Array>} table
   * @param {{unitId: (string|null), actorId: string, requestId: string}} ctx
   *        unitId null = unscoped (super admin / sheet menu)
   * @return {{inserted, updated, codes: Array<{studentId, nickname, team, code}>, errors}}
   */
  function importRoster(table, ctx) {
    var v = HHRoster.validate(table);
    return HHLock.withLock(function () {
      var current = {
        units: HHSheets.readAll('Units'),
        departments: HHSheets.readAll('Departments'),
        teams: HHSheets.readAll('Teams'),
        members: HHSheets.readAll('Members'),
      };
      var p = HHRoster.plan(v.rows, current, { unitId: ctx.unitId });
      HHRepo.appendMany('Units', p.newUnits);
      HHRepo.appendMany('Departments', p.newDepartments);
      HHRepo.appendMany('Teams', p.newTeams);

      var teamName = {};
      current.teams.concat(p.newTeams).forEach(function (t) { teamName[t.TeamID] = t.Name; });

      var codes = [];
      var inserts = p.inserts.map(function (f) {
        var c = newCodeFor_(f.StudentID);
        codes.push({ studentId: f.StudentID, nickname: f.Nickname, team: teamName[f.TeamID] || '', code: c.code });
        return Object.assign({}, f, {
          ActivationCodeHash: c.hash, CodeVersion: 1, Status: 'ACTIVE', CurrentState: 'OUT',
        });
      });
      HHRepo.appendMany('Members', inserts);

      if (p.updates.length > 0) {
        var rows = HHRepo.all('Members');
        var rowOf = {};
        rows.forEach(function (r) { rowOf[String(r.data.StudentID).toUpperCase()] = r.row; });
        p.updates.forEach(function (f) {
          var fields = Object.assign({}, f);
          delete fields.StudentID;
          HHRepo.update('Members', rowOf[f.StudentID], fields);
        });
      }

      HHLog.append({
        requestId: ctx.requestId, unitId: ctx.unitId || '', action: 'ROSTER_IMPORT', actorId: ctx.actorId, method: 'ADMIN',
        note: 'roster import: +' + inserts.length + ' new, ' + p.updates.length + ' updated',
      });
      return {
        inserted: inserts.length,
        updated: p.updates.length,
        codes: codes,
        errors: v.errors.map(function (e) { return { line: e.line, messageTh: e.messageTh }; })
          .concat(p.errors.map(function (e) { return { studentId: e.studentId, messageTh: e.messageTh }; })),
      };
    });
  }

  /**
   * Issue a new activation code for one member (first activation or forgot password).
   * @param {{studentId, role, unitId, teamId}|null} actor null = sheet menu (owner)
   */
  function issueCode(studentId, actor, requestId) {
    var sid = HHAuth.normalizeStudentId(studentId);
    return HHLock.withLock(function () {
      var m = HHRepo.findBy('Members', 'StudentID', sid);
      if (!m) throw new HHErrors.AppError('NOT_FOUND', 'ไม่พบรหัสนักศึกษานี้');
      if (actor) {
        var problem = HHAuth.activationCodeProblem(actor, m.data);
        if (problem) throw new HHErrors.AppError('FORBIDDEN', problem);
      }
      var c = newCodeFor_(sid);
      HHRepo.update('Members', m.row, { ActivationCodeHash: c.hash });
      HHLog.append({
        requestId: requestId, unitId: m.data.UnitID, studentId: sid, action: 'RESET',
        actorId: actor ? actor.studentId : 'OWNER', method: 'ADMIN', note: 'activation code issued',
      });
      return { studentId: sid, nickname: m.data.Nickname, code: c.code };
    });
  }

  return {
    importRoster: importRoster,
    issueCode: issueCode,
    pepper: pepper_,
  };
})();
