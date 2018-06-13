const spawn = require('child_process').spawn;

const { APP_URL, API_PORT } = require('./constants');

module.exports = {
/**
  * Starts horticulturalist with the given arguments.
  *
  * Returns a completed promise depending on the value of waitUntil:
  *  - false: return once it has spawned the process
  *  - true: once the process exits with code 0
  *  - 'string' || /regex/: once this is seen in the logs or the process exits
  *    with code 0
  */
  start: (args, waitUntil) => {
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['src/index.js'].concat(args), {
        // cwd: serviceName,
        env: {
          API_PORT: API_PORT,
          COUCH_URL: APP_URL,
          COUCH_NODE_NAME: process.env.COUCH_NODE_NAME,
          PATH: process.env.PATH
        }
      });

      if (waitUntil === false) {
        return resolve(child);
      }

      if (waitUntil !== true) {
        child.stdout.on('data', data => {
          if (data.toString().match(waitUntil)) {
            resolve(child);
          }
        });
      }

      child.on('exit', code => {
        if (code === 0) {
          resolve(child);
        } else {
          reject(new Error('Horti exited with a nonzero code: ' + code));
        }
      });
    });
  }
};
