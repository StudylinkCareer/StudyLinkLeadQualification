const app = require('./app');
const config = require('./config');
const zaloDeliveryPoller = require('./services/zaloDeliveryPoller');

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
  // Phase 2: pull ZNS delivery status (the delivery webhook is geo-blocked on
  // our US IP), flipping 'accepted' badges to 'delivered' every couple minutes.
  try { zaloDeliveryPoller.start(); } catch (e) { console.error('[zalo-poll] start failed:', e.message); }
});
