const lockfile = require('lockfile');
const path = require('path');

const LOCK_FILE = path.join(os.homedir(), '.horticulturalist/horticulturalist.lock');


function lockFileExists() {
  return lockfile.checkSync(LOCK_FILE);
}

function releaseLock() {
  return new Promise(resolve =>
    lockfile.unlock(LOCK_FILE, err => {
      if(err) {
        console.error(err);
        process.exit(1);
      } else resolve();
    }));
}

const waitForLock = () =>
  new Promise((resolve, reject) => {
    lockfile.lock(LOCK_FILE, err => {
      if(err) reject(err);
      else resolve();
    });
  });

module.exports = {
  exists: lockFileExists,
  path: () => path.resolve(LOCK_FILE),
  release: releaseLock,
  wait: waitForLock,
};
