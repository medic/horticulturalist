const lockfile = require('lockfile');
const os = require('os');
const path = require('path');

const LOCK_FILE = path.join(os.homedir(), '.horticulturalist.lock');


function lockFileExists() {
  return lockfile.checkSync(LOCK_FILE);
}

const waitForLock = () =>
  new Promise((resolve, reject) => {
    lockfile.lock(LOCK_FILE, err => err ? reject(err) : resolve());
  });

module.exports = {
  exists: lockFileExists,
  path: () => path.resolve(LOCK_FILE),
  wait: waitForLock,
};
