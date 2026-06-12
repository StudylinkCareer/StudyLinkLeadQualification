const app = require('./app');
const config = require('./config');

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Server running in ${config.nodeEnv} mode on port ${config.port}`);
});
