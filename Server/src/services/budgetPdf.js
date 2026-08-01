// Server/src/services/budgetPdf.js
// ─────────────────────────────────────────────────────────────────────
// Renders a single event's Planned or Actual budget (the same figures shown
// in the Event Report's merged budget table) as a PDF, for the "Duyệt"
// email attachment. Pure pdfkit (no headless browser) — this app deploys
// straight to production on push with no staging, so a heavy
// Puppeteer/Chromium dependency is a real risk of silently failing only in
// prod; pdfkit is a small pure-Node dependency that draws the table itself.
//
// pdfkit's built-in standard-14 fonts (Helvetica etc.) don't render
// Vietnamese diacritics — nearly every string in this document is
// Vietnamese, so a Unicode TTF (Noto Sans, Apache/OFL, from
// github.com/notofonts/notofonts.github.io) is bundled under
// Server/assets/fonts/ and registered below instead of relying on defaults.
// ─────────────────────────────────────────────────────────────────────
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_REGULAR = path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSans-Regular.ttf');
const FONT_BOLD = path.join(__dirname, '..', '..', 'assets', 'fonts', 'NotoSans-Bold.ttf');

function fmtVnd(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('vi-VN') + ' đ';
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('vi-VN');
}

const BUDGET_TYPE_LABEL = { planned: 'Kế hoạch', actual: 'Thực tế' };

// items: [{ category, lineItem, unit, unitPrice, quantity, amount, approvalNote, approvalNoteBy }]
// Returns a Buffer (caller base64-encodes it for the Resend attachment).
function buildBudgetApprovalPdf({ event, budgetType, items, total, approvedBy, approvedAt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 36, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('NotoSans', FONT_REGULAR);
    doc.registerFont('NotoSans-Bold', FONT_BOLD);
    doc.font('NotoSans');

    doc.font('NotoSans-Bold').fontSize(16).fillColor('#c8102e').text('StudyLink', { continued: false });
    doc.font('NotoSans-Bold').fontSize(13).fillColor('#111827')
      .text(`Ngân sách sự kiện — ${BUDGET_TYPE_LABEL[budgetType] || budgetType}`);
    doc.moveDown(0.3);
    doc.font('NotoSans').fontSize(11).fillColor('#374151')
      .text(`Sự kiện: ${event.name || '—'}`)
      .text(`Ngày sự kiện: ${fmtDate(event.startDate)}`)
      .text(`Duyệt bởi: ${approvedBy || '—'} · Ngày duyệt: ${fmtDate(approvedAt)}`);
    doc.moveDown(0.8);

    const tableData = items.map((it) => [
      it.category || '',
      it.lineItem || '',
      it.unit || '',
      fmtVnd(it.unitPrice),
      it.quantity != null ? String(it.quantity) : '',
      fmtVnd(it.amount),
      it.approvalNote ? `${it.approvalNote}${it.approvalNoteBy ? ` (${it.approvalNoteBy})` : ''}` : '',
    ]);
    const totalRowIndex = tableData.length + 1; // header is row 0

    doc.table({
      columnStyles: [
        { width: 70 },   // Hạng mục
        { width: 130 },  // Nội dung
        { width: 45 },   // Đơn vị
        { width: 70, align: 'right' },  // Đơn giá
        { width: 35, align: 'right' },  // SL
        { width: 70, align: 'right' },  // Thành tiền
        { width: '*', minWidth: 80 },   // Ghi chú duyệt (mom's approval note)
      ],
      rowStyles: (i) => (i === 0 || i === totalRowIndex)
        ? { font: { src: FONT_BOLD }, backgroundColor: '#f3f4f6' }
        : {},
      defaultStyle: {
        font: { src: FONT_REGULAR, size: 9 },
        padding: 4,
        border: 0.5,
        borderColor: '#d1d5db',
      },
      data: [
        ['Hạng mục', 'Nội dung', 'Đơn vị', 'Đơn giá', 'SL', 'Thành tiền', 'Ghi chú duyệt (mẹ)'],
        ...tableData,
        ['', 'TỔNG', '', '', '', fmtVnd(total), ''],
      ],
    });

    doc.end();
  });
}

module.exports = { buildBudgetApprovalPdf };
