/**
 * Web app entry points. Thin adapter: all routing/auth rules live in core/router.js.
 *
 * Frontend calls: POST, Content-Type text/plain;charset=utf-8, body = JSON string
 * { action, payload, token }. Response is always a JSON envelope
 * { ok, data | error: { code, messageTh }, requestId, apiVersion, env }.
 */

/** Built on each call: handler functions live in other files and Apps Script load order is not guaranteed. */
function handlers_() {
  return {
    'health': handleHealth_,
    'auth.activate': handleAuthActivate_,
    'auth.login': handleAuthLogin_,
    'auth.signup': handleAuthSignup_,
    'auth.logout': handleAuthLogout_,
    'auth.me': handleAuthMe_,
    'me.card': handleMeCard_,
    'me.today': handleMeToday_,
    'me.history': handleMeHistory_,
    'me.reports': handleMeReports_,
    'me.report.create': handleMeReportCreate_,
    'me.selfReport': handleMeSelfReport_,
    'correction.propose': handleCorrectionPropose_,
    'correction.list': handleCorrectionList_,
    'correction.approve': handleCorrectionApprove_,
    'correction.reject': handleCorrectionReject_,
    'period.close': handlePeriodClose_,
    'period.reopen': handlePeriodReopen_,
    'export.summary': handleExportSummary_,
    'team.reports': handleTeamReports_,
    'team.report.resolve': handleTeamReportResolve_,
    'scan.lookup': handleScanLookup_,
    'scan.confirm': handleScanConfirm_,
    'team.status': handleTeamStatus_,
    'team.activationCode.issue': handleTeamActivationCodeIssue_,
    'roster.import': handleRosterImport_,
    'roster.list': handleRosterList_,
    'role.set': handleRoleSet_,
    'photo.set': handlePhotoSet_,
    'signup.list': handleSignupList_,
    'signup.review': handleSignupReview_,
    'signup.joinCode': handleSignupJoinCode_,
  };
}

function doPost(e) {
  var raw = e && e.postData ? e.postData.contents : '';
  return json_(HHRouter.handle(raw, routerDeps_()));
}

/** GET supports only `?action=health`, handy for checking a deployment in a browser. */
function doGet(e) {
  var action = e && e.parameter ? e.parameter.action : '';
  if (action === 'health') {
    return json_(HHRouter.handle(JSON.stringify({ action: 'health' }), routerDeps_()));
  }
  return ContentService.createTextOutput('Haunted House staff API. Use POST.');
}

function routerDeps_() {
  return {
    env: HHProps.env() || 'UNCONFIGURED',
    newRequestId: function () { return HHIds.newRequestId(); },
    resolveSession: HHSessions.resolve,
    handlers: handlers_(),
    logError: HHErrorLog.write,
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handleHealth_() {
  var now = new Date();
  var configured = HHProps.env() !== null && !!HHProps.get(HHProps.KEYS.SPREADSHEET_ID);
  var schemaOk = false;
  if (configured) {
    try {
      schemaOk = HHSheets.schemaOk();
    } catch (e) {
      schemaOk = false;
    }
  }
  return {
    env: HHProps.env() || 'UNCONFIGURED',
    apiVersion: HHVersion.API_VERSION,
    serverTime: now.toISOString(),
    serverTimeTh: Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss'),
    configured: configured,
    schemaOk: schemaOk,
  };
}
