// Server/src/services/releaseTranche.js
//
// CLI test harness for the distribution engine. Run from the Server/ directory.
//
//   Show what's waiting in the pool:
//     node src/services/releaseTranche.js pool
//
//   Preview a release WITHOUT writing (recommended first):
//     node src/services/releaseTranche.js "Da Nang" --dry-run
//     node src/services/releaseTranche.js "Da Nang" 50 --dry-run
//
//   Do it for real (writes counselor + audit log):
//     node src/services/releaseTranche.js "Da Nang"
//     node src/services/releaseTranche.js "Da Nang" 50 --by "Lam Nguyen"
//
//   Recall a departing counsellor's open leads back into the pool:
//     node src/services/releaseTranche.js recall "Trần Khiết Oanh" --dry-run

require('dotenv').config();
const svc = require('./distributionService');

function printTable(rows) {
  rows.forEach((r) => console.log('   ' + JSON.stringify(r)));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const byIdx = args.indexOf('--by');
  const assignedBy = byIdx !== -1 ? args[byIdx + 1] : 'system';

  const cmd = args[0];

  if (cmd === 'pool') {
    const summary = await svc.getPoolSummary();
    console.log('Pool (distribution_status = pool):');
    printTable(summary);
    return;
  }

  if (cmd === 'recall') {
    const name = args[1];
    if (!name) { console.error('Usage: releaseTranche.js recall "<full name>" [--dry-run]'); process.exit(1); }
    const res = await svc.recallCounsellorLeads(name, { dryRun });
    console.log(res);
    return;
  }

  // Otherwise: cmd is the office name.
  const office = cmd;
  if (!office) {
    console.error('Usage: releaseTranche.js "<office>" [perHead] [--dry-run] [--by "Name"]');
    process.exit(1);
  }
  // perHead = first numeric arg after the office, default 50.
  const perHeadArg = args.slice(1).find((a) => /^\d+$/.test(a));
  const perHead = perHeadArg ? Number(perHeadArg) : 50;

  const result = await svc.releaseTranche({ office, perHead, dryRun, assignedBy,
    source: 'upload' });

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Release for "${office}" (perHead=${perHead}):`);
  console.log(`  pool size:   ${result.poolSize ?? 0}`);
  console.log(`  released:    ${result.released}`);
  console.log(`  left in pool:${result.leftInPool}`);
  if (result.message) console.log(`  note:        ${result.message}`);
  if (result.batchId) console.log(`  batch_id:    ${result.batchId}`);
  console.log('  per counsellor:');
  printTable(result.perCounsellor || []);
  console.log('  tier mix:', result.tierMix || {});
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Error:', err.message); process.exit(1); });
