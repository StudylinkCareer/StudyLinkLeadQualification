const app = require('./app');
const config = require('./config');
const zaloDeliveryPoller = require('./services/zaloDeliveryPoller');
const weeklySnapshotScheduler = require('./services/weeklySnapshotScheduler');

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
  // Phase 2: pull ZNS delivery status (the delivery webhook is geo-blocked on
  // our US IP), flipping 'accepted' badges to 'delivered' every couple minutes.
  try { zaloDeliveryPoller.start(); } catch (e) { console.error('[zalo-poll] start failed:', e.message); }
  // Freeze the Weekly Report every Monday 08:00 VN (with weekend-restart catch-up).
  try { weeklySnapshotScheduler.start(); } catch (e) { console.error('[weekly-snapshot] start failed:', e.message); }
});
