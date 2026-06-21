// Client/src/utils/badgeRenderer.js
// ---------------------------------------------------------------------
// Shared StudyLink badge/QR renderer. Produces the framed badge (rounded
// dark dots, red extra-rounded finder corners, centre SL logo, thick red
// rounded frame, "SCAN ME" banner, and a caption below) as a PNG data URL.
//
// Single source of truth for the badge look, used by:
//   - Marketing Events  -> data = event campaign URL
//   - Event Console "Badge" action -> data = student attendance_token
//   - the public /badge/<token> page -> data = student attendance_token
//
// Pure browser code (qr-code-styling + Canvas). The caller passes already-
// formatted caption strings, so this helper stays language-agnostic.
// Matches the MarketingEvents output pixel-for-pixel (same constants).
// ---------------------------------------------------------------------
import QRCodeStyling from 'qr-code-styling';

const DOT_COLOR    = '#1a1a1a';             // QR module (square) colour
const ACCENT       = '#c8102e';             // frame, banner, finder corners (StudyLink red)
const BANNER_TEXT  = 'SCAN ME';
const DEFAULT_LOGO = '/studylinklogo.png';  // lives in LeadManagement/public/

function qrOptions(data, logoUrl, withImage) {
  const opts = {
    width: 600, height: 600, type: 'canvas', margin: 0,
    data,
    qrOptions: { errorCorrectionLevel: 'H' },   // high EC so the centre logo doesn't break scanning
    dotsOptions:          { color: DOT_COLOR, type: 'rounded' },
    cornersSquareOptions: { color: ACCENT, type: 'extra-rounded' },
    cornersDotOptions:    { color: ACCENT },
    backgroundOptions:    { color: '#ffffff' },
  };
  if (withImage) {
    opts.image = logoUrl;
    opts.imageOptions = { crossOrigin: 'anonymous', margin: 8, imageSize: 0.25, hideBackgroundDots: true };
  }
  return opts;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = URL.createObjectURL(blob);
  });
}

function loadOk(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(true);
    im.onerror = () => resolve(false);
    im.src = src;
  });
}

// Render the framed badge as a PNG data URL.
//   data      - the string encoded in the QR (event URL or attendance_token)
//   title     - bold caption under the QR (event name or student name); wraps to 2 lines
//   metaLines - array of secondary caption lines, e.g. [eventName, dateRange]
//   logoUrl   - centre logo (defaults to /studylinklogo.png)
export async function renderBadgePng({ data, title = '', metaLines = [], logoUrl = DEFAULT_LOGO }) {
  if (!data) throw new Error('renderBadgePng: data is required');

  const withImage = await loadOk(logoUrl);
  const qr = new QRCodeStyling(qrOptions(data, logoUrl, withImage));
  const blob = await qr.getRawData('png');
  if (!blob) throw new Error('QR generation failed');
  const qrImg = await blobToImage(blob);

  // layout (logical px; canvas rendered at 2x for a crisp image)
  const S = 2, QR = 300, PAD = 22, BORDER = 16, RADIUS = 28;
  const BANNER_W = 150, BANNER_H = 50, TAIL = 12;
  const innerTop = BANNER_H * 0.55;
  const W = QR + PAD * 2 + BORDER * 2;

  const meas = document.createElement('canvas').getContext('2d');
  const NAME_FONT = '700 18px Arial, Helvetica, sans-serif';
  const META_FONT = '400 14px Arial, Helvetica, sans-serif';

  const wrapTitle = (text, maxW) => {
    meas.font = NAME_FONT;
    const words = String(text || '').trim().split(' ').filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
      const tline = cur ? cur + ' ' + w : w;
      if (meas.measureText(tline).width <= maxW || !cur) cur = tline;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 2);
  };

  const titleLines = wrapTitle(title, QR);
  const metas = (Array.isArray(metaLines) ? metaLines : []).filter(Boolean);

  const NAME_LH = 23, META_LH = 19, TEXT_GAP = 16;
  let textH = (titleLines.length ? TEXT_GAP + titleLines.length * NAME_LH : 0);
  textH += metas.length * META_LH;

  const H = innerTop + QR + textH + PAD * 2 + BORDER * 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * S; canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);

  // frame: white fill + thick red rounded border
  const fx = BORDER / 2, fy = innerTop + BORDER / 2, fw = W - BORDER, fh = H - innerTop - BORDER;
  ctx.fillStyle = '#ffffff'; roundRectPath(ctx, fx, fy, fw, fh, RADIUS); ctx.fill();
  ctx.lineWidth = BORDER; ctx.strokeStyle = ACCENT; roundRectPath(ctx, fx, fy, fw, fh, RADIUS); ctx.stroke();

  // QR near the top of the frame
  const qx = (W - QR) / 2, qy = fy + PAD;
  ctx.drawImage(qrImg, qx, qy, QR, QR);

  // caption: title (bold) then meta lines
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let ty = qy + QR + TEXT_GAP;
  ctx.fillStyle = '#1a1a1a'; ctx.font = NAME_FONT;
  for (const ln of titleLines) { ctx.fillText(ln, W / 2, ty); ty += NAME_LH; }
  ctx.fillStyle = '#555555'; ctx.font = META_FONT;
  for (const ln of metas) { ctx.fillText(ln, W / 2, ty); ty += META_LH; }

  // banner pill + tail, centred at top
  const bx = (W - BANNER_W) / 2;
  ctx.fillStyle = ACCENT; roundRectPath(ctx, bx, 0, BANNER_W, BANNER_H, 14); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W / 2 - 12, BANNER_H - 2); ctx.lineTo(W / 2 + 12, BANNER_H - 2); ctx.lineTo(W / 2, BANNER_H + TAIL);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.font = '700 22px Arial, Helvetica, sans-serif';
  ctx.fillText(BANNER_TEXT, W / 2, BANNER_H / 2 + 1);

  return canvas.toDataURL('image/png');
}

// Strip the data-URL prefix to get raw base64 (for sending to the email relay).
export function dataUrlToBase64(dataUrl) {
  return String(dataUrl || '').replace(/^data:image\/\w+;base64,/, '');
}
