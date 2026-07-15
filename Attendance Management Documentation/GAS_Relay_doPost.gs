// StudyLink GAS relay - doPost
// One web app, four message types:
//   1) OTP email (EXISTING, unchanged):   { email, otp }
//   2) Event registration badge:          { type:'event_badge', email, name, eventName, badgeUrl,
//                                           badgeImageUrl (hosted), badgePng(base64, legacy fallback),
//                                           profileUrl, questionnaireComplete,
//                                           stoneTier, stoneLabel, stoneMessage, stoneImageUrl }
//   3) Rep one-click sign-in link:        { type:'rep_link', email, name, eventName, link }
//   4) Questionnaire evaluation:          { type:'stone_result', email, name, eventName,
//                                           stoneTier, stoneLabel, stoneMessage, stoneImageUrl,
//                                           profileUrl, badgeImageUrl (hosted updated badge) }
//
// Badge images are referenced by HOSTED URL (the server's /badge-image route),
// NOT attached inline - attachments show up a second time as a thumbnail at
// the end of the message in iPhone Mail and some other clients.
//
// IMPORTANT when updating: Deploy > Manage deployments > edit the EXISTING
// deployment > New version. That keeps the same /exec URL so OTP + badge both
// keep working and config.gas.sendOtpUrl needs no change. Access stays "Anyone".

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // -- Branch: event registration badge --------------------------------
    if (data.type === 'event_badge') {
      return sendEventBadge_(data);
    }

    // -- Branch: rep one-click sign-in link ------------------------------
    if (data.type === 'rep_link') {
      return sendRepLink_(data);
    }

    // -- Branch: questionnaire evaluation (stone) result ------------------
    if (data.type === 'stone_result') {
      return sendStoneResult_(data);
    }

    // -- Existing OTP path (unchanged) -----------------------------------
    var email = data.email;
    var otp = data.otp;

    if (!email || !otp) {
      return ContentService.createTextOutput(
        JSON.stringify({ success: false, error: 'Missing email or otp' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    var plainBody = 'Your StudyLink verification code is:\n\n'
      + otp + '\n\n'
      + 'This code expires in 10 minutes.\n\n'
      + '@192.168.50.40 #' + otp;

    MailApp.sendEmail({
      to: email,
      subject: 'StudyLink - Your Verification Code',
      body: plainBody,
      htmlBody: '<div style="font-family:Arial,sans-serif;max-width:400px;margin:0 auto;padding:20px;">'
        + '<h2 style="color:#2563eb;">StudyLink Verification</h2>'
        + '<p>Your verification code is:</p>'
        + '<div style="background:#f0f4ff;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">'
        + '<span style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1e40af;">' + otp + '</span>'
        + '</div>'
        + '<p style="color:#666;font-size:14px;">This code expires in 10 minutes.</p>'
        + '</div>'
    });

    return ContentService.createTextOutput(
      JSON.stringify({ success: true })
    ).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// -- Shared: stone banner block (congratulations + message) --------------
// Renders the questionnaire-evaluation banner. Used by both the badge email
// (when the student is already scored) and the stone_result email.
function stoneBlock_(data, imgWidth) {
  if (!data.stoneTier) return '';
  var img = data.stoneImageUrl
    ? '<img src="' + String(data.stoneImageUrl).replace(/"/g, '&quot;') + '" alt="'
      + (data.stoneLabel || data.stoneTier)
      + '" width="' + imgWidth + '" style="width:' + imgWidth + 'px;height:auto;border:0;margin:0 0 10px;"/>'
    : '';
  return '<div style="margin:24px 0 0;padding:20px;border:1px solid #f3d6da;border-radius:12px;background:#fdf4f5;text-align:center;">'
    + img
    + '<div style="font-size:18px;font-weight:bold;color:#c8102e;margin:0 0 8px;">'
    + 'Chúc mừng Bạn! — ' + (data.stoneLabel || data.stoneTier) + '</div>'
    + '<div style="font-size:14px;color:#374151;line-height:1.6;text-align:left;">'
    + (data.stoneMessage || '') + '</div>'
    + '</div>';
}

// -- Questionnaire evaluation (stone) result sender ----------------------
// Sent automatically every time the student submits the "Know you better"
// questionnaire: their UPDATED badge (stone-centred QR, hosted image), the
// stone banner, and a thank-you. { type:'stone_result', email, name,
// eventName, stoneTier, stoneLabel, stoneMessage, stoneImageUrl, profileUrl,
// badgeImageUrl }
function sendStoneResult_(data) {
  var to = data.email;

  if (!to || !data.stoneTier) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: 'Missing email or stoneTier' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var name = data.name || '';
  var eventName = data.eventName || '';
  var profileUrl = data.profileUrl || '';
  var safeProfile = String(profileUrl).replace(/"/g, '&quot;');
  var badgeImageUrl = data.badgeImageUrl || '';

  var subject = 'Kết quả đánh giá & thẻ tham dự mới của bạn'
    + (eventName ? ' — ' + eventName : '');

  // The updated badge, referenced by hosted URL (never attached).
  var badgeBlock = '';
  if (badgeImageUrl) {
    badgeBlock =
        '<div style="text-align:center;margin:20px 0;">'
      + '<img src="' + String(badgeImageUrl).replace(/"/g, '&quot;') + '" alt="Thẻ tham dự của bạn" style="max-width:320px;width:100%;height:auto;border:0;"/>'
      + '</div>'
      + '<p style="background:#fff1f2;border:1px solid #fed7aa;border-radius:8px;padding:12px;font-size:14px;color:#9a3412;margin:0 0 16px;">'
      + 'Đây là thẻ tham dự MỚI của bạn (viên đá của bạn nằm giữa mã QR). '
      + 'Trên điện thoại, nhấn giữ vào thẻ rồi chọn Lưu hình ảnh; sau đó xuất trình tại mỗi gian hàng.</p>';
  }

  var profileBtn = '';
  if (profileUrl) {
    profileBtn =
        '<div style="text-align:center;margin:24px 0 0;">'
      + '<a href="' + safeProfile + '" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:8px;font-size:16px;">Xem thẻ &amp; cập nhật câu trả lời</a>'
      + '</div>';
  }

  var html = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;color:#1a1a1a;">'
    + '<h2 style="color:#c8102e;margin:0 0 12px;">Kết Quả Đánh Giá Của Bạn</h2>'
    + (name ? '<p style="margin:0 0 12px;">Chào ' + name + ',</p>' : '')
    + '<p style="margin:0 0 16px;">Cảm ơn bạn đã đăng ký tham dự triển lãm của chúng tôi'
    + (eventName ? ' — <strong>' + eventName + '</strong>' : '')
    + ' — chúng tôi rất mong được đón tiếp bạn! Dưới đây là kết quả đánh giá và thẻ tham dự mới của bạn.</p>'
    + stoneBlock_(data, 110)
    + badgeBlock
    + profileBtn
    + '<p style="color:#888;font-size:12px;margin-top:24px;">StudyLink - Kiến tạo tương lai của bạn</p>'
    + '</div>';

  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: html,
    name: 'StudyLink'
  });

  return ContentService.createTextOutput(
    JSON.stringify({ success: true })
  ).setMimeType(ContentService.MimeType.JSON);
}

// -- Rep one-click sign-in link sender ---------------------------------
// Emails a rep a button + link that opens the booth scanner and signs them
// in automatically (the link carries their token + PIN).
//   { type:'rep_link', email, name, eventName, link }
function sendRepLink_(data) {
  var to = data.email;
  var link = data.link || '';

  if (!to || !link) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: 'Missing email or link' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var name = data.name || '';
  var eventName = data.eventName || '';
  var safeLink = String(link).replace(/"/g, '&quot;');

  var subject = 'Your StudyLink event sign-in link'
    + (eventName ? ' - ' + eventName : '');

  var html = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;color:#1a1a1a;">'
    + '<h2 style="color:#c8102e;margin:0 0 12px;">Your Event Sign-In Link</h2>'
    + (name ? '<p style="margin:0 0 12px;">Hi ' + name + ',</p>' : '')
    + '<p style="margin:0 0 16px;">Tap the button below to open the booth scanner'
    + (eventName ? ' for <strong>' + eventName + '</strong>' : '')
    + '. It signs you in automatically - no code to type.</p>'
    + '<div style="text-align:center;margin:24px 0;">'
    + '<a href="' + safeLink + '" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:8px;font-size:16px;">Open booth scanner</a>'
    + '</div>'
    + '<p style="font-size:13px;color:#666;margin:0 0 6px;">If the button does not work, paste this link into your browser:</p>'
    + '<p style="font-size:12px;color:#2563eb;word-break:break-all;margin:0 0 16px;">' + safeLink + '</p>'
    + '<p style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;font-size:13px;color:#9a3412;margin:0 0 16px;">'
    + 'Keep this link private - it signs in as you, and it stops working once the event ends.</p>'
    + '<p style="color:#888;font-size:12px;margin-top:24px;">StudyLink - Shaping your future</p>'
    + '</div>';

  MailApp.sendEmail({
    to: to,
    subject: subject,
    htmlBody: html,
    name: 'StudyLink'
  });

  return ContentService.createTextOutput(
    JSON.stringify({ success: true })
  ).setMimeType(ContentService.MimeType.JSON);
}

// -- Event registration badge sender -----------------------------------
// Emails the badge via its hosted image URL (preferred; no attachment so mail
// clients can't render a duplicate thumbnail). Falls back to inline cid if
// only badgePng is supplied. The questionnaire block adapts:
//   questionnaireComplete=false -> "please complete the remaining questions"
//   questionnaireComplete=true  -> "you can review/update your answers"
// When stoneTier is supplied (student already evaluated), the stone banner
// with the congratulatory message renders under the badge.
function sendEventBadge_(data) {
  var to = data.email;
  var badgeImageUrl = data.badgeImageUrl || '';
  var pngB64 = data.badgePng || '';

  if (!to || (!badgeImageUrl && !pngB64)) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: 'Missing email or badge image' })
    ).setMimeType(ContentService.MimeType.JSON);
  }

  var name = data.name || '';
  var eventName = data.eventName || '';
  var profileUrl = data.profileUrl || '';
  var safeProfile = String(profileUrl).replace(/"/g, '&quot;');
  var complete = data.questionnaireComplete === true || data.questionnaireComplete === 'true';

  var subject = 'Thẻ đăng ký StudyLink của bạn'
    + ' — Sự Kiện Quốc Tế VIP 18.7.2026';

  // Optional questionnaire block - only when a profileUrl is sent. Copy and
  // button depend on whether every required question is already answered.
  var profileBlock = '';
  if (profileUrl) {
    var pIntro, pButton;
    if (complete) {
      pIntro = '<h3 style="color:#c8102e;margin:0 0 8px;font-size:16px;">Câu trả lời của bạn đã đầy đủ</h3>'
        + '<p style="margin:0 0 16px;">Cảm ơn bạn đã hoàn thành bảng câu hỏi. '
        + 'Nếu có gì thay đổi, bạn có thể xem lại và cập nhật câu trả lời bất cứ lúc nào trước sự kiện — '
        + 'thẻ tham dự và kết quả đánh giá của bạn sẽ được cập nhật theo.</p>';
      pButton = 'Xem / cập nhật câu trả lời';
    } else {
      pIntro = '<h3 style="color:#c8102e;margin:0 0 8px;font-size:16px;">Giúp chúng tôi hiểu bạn hơn</h3>'
        + '<p style="margin:0 0 16px;">Chúng tôi đã bắt đầu hồ sơ của bạn với những thông tin hiện có. '
        + 'Vui lòng dành chút thời gian điền nốt phần còn lại để Cố vấn của chúng tôi có thể đưa ra lời khuyên tốt nhất cho bạn tại '
        + '<strong>Sự Kiện Quốc Tế VIP 18.7.2026</strong>. Việc này chỉ mất một chút thời gian.</p>';
      pButton = 'Hoàn tất hồ sơ của tôi';
    }
    profileBlock =
        '<div style="border-top:1px solid #eee;margin:24px 0 0;padding-top:18px;">'
      + pIntro
      + '<div style="text-align:center;margin:20px 0;">'
      + '<a href="' + safeProfile + '" style="display:inline-block;background:#c8102e;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:8px;font-size:16px;">' + pButton + '</a>'
      + '</div>'
      + '<p style="font-size:13px;color:#666;margin:0 0 6px;">Nếu nút này không hoạt động, vui lòng dán liên kết sau vào trình duyệt của bạn:</p>'
      + '<p style="font-size:12px;color:#2563eb;word-break:break-all;margin:0 0 16px;">' + safeProfile + '</p>'
      + '</div>';
  }

  var eventInfoBlock =
      '<div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:8px;padding:16px;margin:0 0 20px;font-size:14px;color:#1a1a1a;">'
    + '<p style="margin:0 0 8px;font-weight:bold;">Bạn nhớ đừng quên</p>'
    + '<p style="margin:0 0 4px;">📅 Thời gian: 14:00 – 17:30 | Thứ Bảy, 18/07/2026</p>'
    + '<p style="margin:0 0 12px;">📍 Địa điểm: Nhà khách Quốc Hội, 165 Nam Kỳ Khởi Nghĩa, Q.3, TP.HCM</p>'
    + '<p style="margin:0 0 4px;">Xem lại thông tin sự kiện tại:</p>'
    + '<p style="margin:0;"><a href="https://www.facebook.com/share/p/1NwkSnZFbe/" style="color:#2563eb;word-break:break-all;">https://www.facebook.com/share/p/1NwkSnZFbe/</a></p>'
    + '</div>';

  // Badge: hosted URL preferred; cid inline only as legacy fallback.
  var badgeImgTag = badgeImageUrl
    ? '<img src="' + String(badgeImageUrl).replace(/"/g, '&quot;') + '" alt="Thẻ đăng ký" style="max-width:320px;width:100%;height:auto;border:0;"/>'
    : '<img src="cid:badge" alt="Thẻ đăng ký" style="max-width:320px;width:100%;height:auto;border:0;"/>';

  var html = '<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:20px;color:#1a1a1a;">'
    + '<h2 style="color:#c8102e;margin:0 0 12px;">Thẻ Tham Dự Sự Kiện Quốc Tế VIP 18/7</h2>'
    + (name ? '<p style="margin:0 0 12px;">Chào ' + name + ',</p>' : '')
    + '<p style="margin:0 0 16px;">Đây là Thẻ Tham Dự Sự Kiện VIP – Xem Mắt Trường Đại Học của Bạn. '
    + 'Vui lòng xuất trình mã QR này tại Sự Kiện và tại mỗi gian hàng để được Trường cố vấn học bổng và lộ trình cho Bạn.</p>'
    + eventInfoBlock
    + '<div style="text-align:center;margin:20px 0;">'
    + badgeImgTag
    + '</div>'
    + '<p style="background:#fff1f2;border:1px solid #fed7aa;border-radius:8px;padding:12px;font-size:14px;color:#9a3412;margin:0 0 16px;">'
    + 'Để lưu lại: trên điện thoại, nhấn giữ vào thẻ ở trên rồi chọn Lưu hình ảnh; '
    + 'trên máy tính, nhấp chuột phải vào thẻ và chọn Lưu hình ảnh thành. Sau đó xuất trình tại mỗi gian hàng.</p>'
    + stoneBlock_(data, 96)
    + profileBlock
    + '<p style="color:#888;font-size:12px;margin-top:24px;">StudyLink - Kiến tạo tương lai của bạn</p>'
    + '</div>';

  var mail = {
    to: to,
    subject: subject,
    htmlBody: html,
    name: 'StudyLink'
  };
  if (!badgeImageUrl) {
    mail.inlineImages = {
      badge: Utilities.newBlob(Utilities.base64Decode(pngB64), 'image/png', 'studylink-registration-badge.png')
    };
  }
  MailApp.sendEmail(mail);

  return ContentService.createTextOutput(
    JSON.stringify({ success: true })
  ).setMimeType(ContentService.MimeType.JSON);
}
