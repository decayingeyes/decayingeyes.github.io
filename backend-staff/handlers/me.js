/**
 * me.* handlers: only the caller's own data. No studentId parameter is read.
 */

function handleMeCard_(payload, ctx) {
  var m = HHRepo.findBy('Members', 'StudentID', ctx.actor.studentId);
  var secret = HHProps.get(HHProps.KEYS.HMAC_SECRET);
  if (!secret) throw new HHErrors.AppError('NOT_CONFIGURED', null, 'HMAC_SECRET missing');
  var p = profileOf_(m.data);
  p.eventName = HHConfig.get().EVENT_NAME;
  p.barcode = HHBarcode.payload(String(m.data.StudentID), Number(m.data.CodeVersion) || 1, secret, HHCrypto.hmacBytes);
  return p;
}
