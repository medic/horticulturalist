const fs = require('fs-extra'),
      { promisify } = require('util'),
      { spawn } = require('child_process'),
      path = require('path');

const { APP_URL, API_PORT, BUILDS_URL } = require('./constants');

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
  start: (args, {waitUntil, log, buildServer} = {}) => {
    return new Promise((resolve, reject) => {
      if (log) {
        console.log('Starting horti with', JSON.stringify(args, null, 2));
      }

      const child = spawn('node', ['src/index.js'].concat(args), {
        env: {
          API_PORT: API_PORT,
          COUCH_URL: APP_URL,
          COUCH_NODE_NAME: process.env.COUCH_NODE_NAME,
          PATH: process.env.PATH,
          HORTI_BUILDS_SERVER: buildServer || BUILDS_URL
        }
      });

      if (log) {
        child.stdout.on('data', data => process.stdout.write(data.toString()));
        child.stderr.on('data', data => process.stdout.write(data.toString()));
      }

      if (waitUntil === false) {
        return resolve(child);
      }

      if (waitUntil !== true) {
        child.stdout.on('data', data => {
          const sdata = data.toString();

          if (sdata.match(waitUntil)) {
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
  },
  cleanWorkingDir: () => promisify(fs.remove)('./test-workspace'),
  getCurrentAppDir: (app) => {
    return promisify(fs.realpath)(`./test-workspace/deployments/${app}/current`).then(path.basename);
  },
  getDDocAppDigest: (app, ddoc) => {
    const attName = Object.keys(ddoc._attachments).find(attachment => attachment.indexOf(app) === 0);
    return attName && ddoc._attachments[attName].digest.replace(/\//g, '');
  }
};
