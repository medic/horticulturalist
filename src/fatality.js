const lockfile = require('./lockfile');

module.exports = err => {
  console.error(err);
  lockfile.release()
    .then(() => process.exit(1));
};
