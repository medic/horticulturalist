const child_process = require('child_process');

const APPS = [ 'medic-api', 'medic-sentinel' ];


const execForApp = (cmd, app) => {
  cmd = cmd.replace(/{{app}}/g, app);

  return new Promise((resolve, reject) =>
    child_process.exec(cmd, err => {
      if(err) reject(err);
      else resolve(err);
    }));
};

module.exports = (startCmd, stopCmd) => {
  const startApps = () =>
    APPS.reduce(
        (p, app) => p
          .then(() => console.log(`Starting app: ${app} with command: ${startCmd}…`))
          .then(() => execForApp(startCmd, app))
          .then(() => console.log(`Started: ${app}`)),
        Promise.resolve());

  const stopApps = () =>
    Promise.all(APPS.map(app => execForApp(stopCmd, app)));

  return {
    APPS: APPS,
    start: startApps,
    stop: stopApps,
  };
};
