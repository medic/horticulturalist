const child_process = require('child_process');
const debug = require('./log').debug;

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
          .then(() => debug(`Starting app: ${app} with command: ${startCmd}…`))
          .then(() => execForApp(startCmd, app))
          .then(() => debug(`Started ${app} in the background.`)),
        Promise.resolve());

  const stopApps = () =>
    APPS.reduce(
        (p, app) => p
          .then(() => debug(`Stopping app: ${app} with command: ${startCmd}…`))
          .then(() => execForApp(stopCmd, app))
          .then(() => debug(`Stopped ${app}.`)),
        Promise.resolve());


  return {
    APPS: APPS,
    start: startApps,
    stop: stopApps,
  };
};
