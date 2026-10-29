/**
 * TEST-only demo data (spec 5.15): one unit, departments, teams and ~50 fake
 * members, all pre-activated with password DEMO_PASSWORD so demos can log in
 * straight away. Refuses to run in PROD.
 */
var DEMO_PASSWORD = 'demo1234';

function menuSeedTest() {
  var ui = SpreadsheetApp.getUi();
  if (!HHProps.isTest()) {
    ui.alert('ใช้ได้เฉพาะโหมดทดสอบ (TEST) เท่านั้น');
    return;
  }
  var answer = ui.alert('สร้างสมาชิกตัวอย่าง ~50 คน (รหัสผ่านทุกคน: ' + DEMO_PASSWORD + ')?', ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) return;
  var result = seedTest_();
  ui.alert('สร้างแล้ว ' + result.created + ' คน\n\nบัญชีสำหรับเดโม (รหัสผ่าน ' + DEMO_PASSWORD + '):\n' + result.demoAccounts.join('\n'));
}

function seedTest_() {
  if (!HHProps.isTest()) throw new HHErrors.AppError('FORBIDDEN', null, 'seed outside TEST');
  var unit = 'บ้านผีสิง (เดโม)';
  var plan = [
    // [department, team, shift, count]
    ['นักแสดง', 'ผีกะ 1', 'กะ 1', 12],
    ['นักแสดง', 'ผีกะ 2', 'กะ 2', 12],
    ['ฉากและแสง', 'ทีมฉาก', '', 10],
    ['ต้อนรับ', 'หน้างาน', '', 10],
    ['สวัสดิการ', 'พยาบาล/น้ำ', '', 6],
  ];
  var nicknames = ['มิว', 'ฟ้า', 'บอส', 'เจ', 'ปุ้ย', 'แบงค์', 'ต้น', 'นุ่น', 'กาย', 'เฟิร์น', 'ภูมิ', 'ใบเตย',
    'ปอนด์', 'แพรว', 'ไอซ์', 'บีม', 'มายด์', 'ตาล', 'โอ๊ต', 'จูน', 'ก้อง', 'น้ำ', 'เบนซ์', 'ปาล์ม', 'ออม'];
  var firstNames = ['สมชาย', 'สมหญิง', 'วรวุฒิ', 'กมลชนก', 'ธนากร', 'ปิยะนุช', 'ณัฐวุฒิ', 'อรอุมา', 'ศุภชัย', 'พิมพ์ชนก'];
  var lastNames = ['ใจดี', 'รักงาน', 'มีสุข', 'แสงทอง', 'ศรีสวัสดิ์', 'บุญมา', 'ทองดี', 'วงศ์ใหญ่'];

  var table = [['StudentID', 'FirstName', 'LastName', 'Nickname', 'Unit', 'Department', 'Team', 'Shift', 'Role']];
  var n = 0;
  plan.forEach(function (p, teamIndex) {
    for (var i = 0; i < p[3]; i++) {
      n++;
      var role = i === 0 ? 'head' : i === 1 ? 'deputy' : 'member';
      if (teamIndex === 0 && i === 2) role = 'unit_admin';
      table.push([
        '99' + ('00000' + n).slice(-5),
        firstNames[n % firstNames.length], lastNames[n % lastNames.length],
        nicknames[n % nicknames.length] + (n > nicknames.length ? String(Math.ceil(n / nicknames.length)) : ''),
        unit, p[0], p[1], p[2], role,
      ]);
    }
  });

  var result = HHAccounts.importRoster(table, { unitId: null, actorId: 'SEED', requestId: HHIds.newRequestId() });
  HHOrg.clearCache();

  // Pre-activate everyone with the demo password (bulk write per column).
  var cfg = HHConfig.get();
  var pepper = HHAccounts.pepper();
  var rows = HHRepo.all('Members');
  var seedIds = {};
  table.slice(1).forEach(function (r) { seedIds[r[0]] = true; });
  rows.forEach(function (r) {
    if (!seedIds[String(r.data.StudentID)] || r.data.PasswordHash) return;
    var salt = HHAuth.newSalt(HHCrypto.randInt);
    HHRepo.update('Members', r.row, {
      Salt: salt,
      PasswordHash: HHAuth.hashPassword(DEMO_PASSWORD, salt, pepper, cfg.PASSWORD_HASH_ROUNDS, HHCrypto.sha256Hex),
      ActivationCodeHash: '',
      ActivatedAt: new Date(),
    });
  });

  var demo = table.slice(1).filter(function (r) { return r[8] !== 'member'; }).slice(0, 6)
    .map(function (r) { return r[0] + '  ' + r[3] + '  (' + r[8] + ', ' + r[6] + ')'; });
  demo.push(table[4][0] + '  ' + table[4][3] + '  (member, ' + table[4][6] + ')');
  return { created: result.inserted, demoAccounts: demo };
}
