const lockfile = require('./lockfile'),
      log = require('./log');

module.exports = err => {
  log.error('********FATAL********');
  log.error(err);

  lockfile.release()
    .then(() => process.exit(1));
};
