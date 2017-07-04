const child_process = require('child_process');
const fatality = require('./fatality');

const APPS = [ 'medic-api', 'medic-sentinel' ];


module.exports = (startCmd, stopCmd, async) => {

  const execForApp = (cmd, app) => {
    cmd = cmd.replace(/{{app}}/g, app);

    if(async) {
      child_process.exec(cmd, err => {
        if(err) {
          console.log(`Error caught when executing: ${app}.  Stopping all apps and quitting horticulturalist.  Error will follow.`);
          stopApps()
            .then(() => fatality(err));
        }
      });
      return Promise.resolve();
    } else {
      return new Promise((resolve, reject) =>
        child_process.exec(cmd, err => {
          if(err) reject(err);
          else resolve(err);
        }));
    }
  };

  const startApps = () =>
    APPS.reduce(
        (p, app) => p
          .then(() => console.log(`Starting app: ${app} with command: ${startCmd}…`))
          .then(() => execForApp(startCmd, app))
          .then(() => console.log(`Started: ${app} in the background.`)),
        Promise.resolve());

  const stopApps = () =>
    Promise.all(APPS.map(app => execForApp(stopCmd, app)));

  return {
    APPS: APPS,
    start: startApps,
    stop: stopApps,
  };
};
