const child_process = require('child_process');
const fatality = require('./fatality');

const APPS = [ 'medic-api', 'medic-sentinel' ];


module.exports = (startCmd, stopCmd) => {

  const execForApp = (cmd, app) => {
    cmd = cmd.replace(/{{app}}/g, app);

    return new Promise((resolve, reject) =>
      child_process.exec(cmd, err => {
        if(err) reject(err);
        else resolve(err);
      }));
  };

  const startApps = () =>
    APPS.reduce(
        (p, app) => p
          .then(() => console.log(`Starting app: ${app} with command: ${startCmd}…`))
          .then(() => execForApp(startCmd, app))
          .then(() => console.log(`Started ${app} in the background.`)),
        Promise.resolve());

  const stopApps = () =>
    Promise.all(APPS.map(app => execForApp(stopCmd, app)));

  return {
    APPS: APPS,
    start: startApps,
    stop: stopApps,
  };
};

const sleep = seconds => new Promise(resolve =>
  setTimeout(resolve, seconds * 1000));
