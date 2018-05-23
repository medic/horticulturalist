const log = require('./log');

module.exports = err => {
  log.error('********FATAL********');
  log.error(err);

  process.exit(1);
};
