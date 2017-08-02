const child_process = require('child_process');
const trace = require('./log').trace;

const APPS = [ 'medic-api', 'medic-sentinel' ];


module.exports = (startCmd, stopCmd) => {

  const execForApp = (cmd, app) => {
    cmd = cmd.map(sub => sub.replace(/{{app}}/g, app));

    return new Promise((resolve, reject) => {
      const proc = child_process.spawn(cmd.shift(), cmd, {
        stdio: [ 'ignore', process.stdout, process.stderr ],
      });

      proc.on('close', status => status ? reject(`${app} existed with status ${status}`) : resolve());
    });
  };

  const startApps = () =>
    APPS.reduce(
        (p, app) => p
          .then(() => trace(`Starting app: ${app} with command: ${startCmd}…`))
          .then(() => execForApp(startCmd, app))
          .then(() => trace(`Started ${app} in the background.`)),
        Promise.resolve());

  const stopApps = () =>
    Promise.all(APPS.map(app => execForApp(stopCmd, app)));

  return {
    APPS: APPS,
    start: startApps,
    stop: stopApps,
  };
};
