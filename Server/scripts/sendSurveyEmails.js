// Throwaway script: sends the post-event survey email (Apps Script `type:
// 'survey'`) to every recipient in a registrant CSV produced by
// getEventRegistrants.js. Paces requests to be gentle on the Apps Script
// mail quota, logs progress, and writes any failures to a file so nothing
// silently gets lost across ~550 sends.
//
// Usage:
//   Dry run (only sends to yourself, does not touch the CSV):
//     GAS_URL="https://script.google.com/.../exec" node scripts/sendSurveyEmails.js --test you@email.com
//
//   Real send (every row in the CSV):
//     GAS_URL="https://script.google.com/.../exec" node scripts/sendSurveyEmails.js output/event_36_registrants.csv
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const gasUrl = process.env.GAS_URL || process.env.GAS_SEND_OTP_URL;
if (!gasUrl) {
  console.error('Set GAS_URL to the Apps Script /exec URL, e.g.: GAS_URL="..." node scripts/sendSurveyEmails.js ...');
  process.exit(1);
}

// Randomized delay between sends (min-max ms) - spreads the batch out over a
// longer, less bursty window so it reads more like organic sending than an
// automated blast, which helps with spam-filter heuristics at the receiving
// end. Default averages ~4s/send (~550 recipients -> ~35-40 min total).
const DELAY_MIN_MS = 2000;
const DELAY_MAX_MS = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomDelay = () => DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS));

async function sendOne(email, name) {
  const res = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'survey', email, name }),
  });
  return res.json().catch(() => ({ success: false, error: 'bad JSON response' }));
}

// Minimal CSV parser matching the exact format getEventRegistrants.js writes
// (double-quoted fields, "" escaping) — not a general-purpose CSV parser.
function parseCsv(text) {
  return text.trim().split(/\r?\n/).slice(1).map((line) => {
    const fields = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else { cur += c; }
      } else if (c === '"') { inQuotes = true; }
      else if (c === ',') { fields.push(cur); cur = ''; }
      else { cur += c; }
    }
    fields.push(cur);
    return { fullName: fields[0], email: fields[1], phone: fields[2] };
  });
}

(async () => {
  const args = process.argv.slice(2);

  if (args[0] === '--test') {
    const testEmail = args[1];
    if (!testEmail) { console.error('Usage: --test you@email.com'); process.exit(1); }
    console.log('Sending TEST survey email to', testEmail);
    console.log(await sendOne(testEmail, 'Test'));
    return;
  }

  const csvArg = args[0];
  if (!csvArg) { console.error('Usage: node scripts/sendSurveyEmails.js <path-to-csv>'); process.exit(1); }

  const csvPath = path.isAbsolute(csvArg) ? csvArg : path.join(__dirname, csvArg);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8')).filter((r) => r.email);
  const avgSec = (DELAY_MIN_MS + DELAY_MAX_MS) / 2 / 1000;
  const estMinutes = Math.round((rows.length * avgSec) / 60);
  console.log(`Loaded ${rows.length} recipients from ${csvArg}`);
  console.log(`Estimated total time: ~${estMinutes} minutes (randomized ${DELAY_MIN_MS / 1000}-${DELAY_MAX_MS / 1000}s between sends).`);
  console.log('Starting real send in 5 seconds - Ctrl+C now to abort...');
  await sleep(5000);

  const failures = [];
  for (let i = 0; i < rows.length; i++) {
    const { fullName, email } = rows[i];
    try {
      const result = await sendOne(email, fullName);
      if (!result.success) failures.push({ email, error: result.error });
      console.log(`[${i + 1}/${rows.length}] ${email} -> ${result.success ? 'OK' : 'FAILED: ' + result.error}`);
    } catch (e) {
      failures.push({ email, error: e.message });
      console.log(`[${i + 1}/${rows.length}] ${email} -> ERROR: ${e.message}`);
    }
    await sleep(randomDelay());
  }

  console.log(`\nDone. ${rows.length - failures.length} sent, ${failures.length} failed.`);
  if (failures.length) {
    const failPath = path.join(__dirname, 'output', 'survey_send_failures.json');
    fs.writeFileSync(failPath, JSON.stringify(failures, null, 2));
    console.log('Failures written to:', failPath, '- review and retry those individually.');
  }
})();
