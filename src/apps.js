const child_process = require('child_process');

const APPS = [ 'medic-api', 'medic-sentinel' ];


const exec = cmd =>
  new Promise((resolve, reject) =>
    child_process.exec(cmd, err => {
      if(err) reject(err);
      else resolve(err);
    }));

const startApps = () =>
  APPS.reduce(
      (p, app) => p.then(exec(`sudo svc-start ${app}`)),
      Promise.resolve());

const stopApps = () =>
  Promise.all(APPS.map(app => exec(`sudo svc-stop ${app}`)));

module.exports = {
  APPS: APPS,
  start: startApps,
  stop: stopApps,
};
