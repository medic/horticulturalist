const child_process = require('child_process');
const debug = require('./log').debug;

const APPS = [ 'medic-api', 'medic-sentinel' ];

const execForApp = (cmd, app) => {
  cmd = cmd.map(sub => sub.replace(/{{app}}/g, app));

  return new Promise((resolve, reject) => {
    const proc = child_process.spawn(cmd.shift(), cmd, {
      stdio: [ 'ignore', process.stdout, process.stderr ],
    });

    proc.on('close', status => status ? reject(`${app} existed with status ${status}`) : resolve());
  });
};

const startApps = (cmd) =>
  APPS.reduce(
      (p, app) => p
        .then(() => debug(`Starting app: ${app} with command: ${cmd}…`))
        .then(() => execForApp(cmd, app))
        .then(() => debug(`Started ${app} in the background.`)),
      Promise.resolve());

const stopApps = (cmd) =>
  APPS.reduce(
      (p, app) => p
        .then(() => debug(`Stopping app: ${app} with command: ${cmd}…`))
        .then(() => execForApp(cmd, app))
        .then(() => debug(`Stopped ${app}.`)),
      Promise.resolve());

const stopSync = (cmd) => {
  APPS.forEach(app => {
    execForApp(cmd, app);
  });
};

module.exports = {
  APPS: APPS,
  start: (cmd) => startApps(cmd),
  stop: (cmd) => stopApps(cmd),
  stopSync: (cmd) => stopSync(cmd),
};
