const child_process = require('child_process');
const debug = require('./log').debug;

const execForApp = (cmd, app) => {
  cmd = cmd.map(sub => sub.replace(/{{app}}/g, app));

  return new Promise((resolve, reject) => {
    const proc = child_process.spawn(cmd.shift(), cmd, {
      stdio: [ 'ignore', process.stdout, process.stderr ],
    });

    proc.on('close', status => status ? reject(`${app} existed with status ${status}`) : resolve());
  });
};

const startApps = (cmd, apps) =>
  apps.reduce(
    (p, app) => p
      .then(() => debug(`Starting app: ${app} with command: ${cmd}…`))
      .then(() => execForApp(cmd, app))
      .then(() => debug(`Started ${app} in the background.`)),
    Promise.resolve());

const stopApps = (cmd, apps) =>
  apps.reduce(
    (p, app) => p
      .then(() => debug(`Stopping app: ${app} with command: ${cmd}…`))
      .then(() => execForApp(cmd, app))
      .then(() => debug(`Stopped ${app}.`)),
    Promise.resolve());

const stopSync = (cmd, apps) => {
  apps.forEach(app => {
    execForApp(cmd, app);
  });
};

module.exports = {
  start: startApps,
  stop: stopApps,
  stopSync: stopSync,
};
