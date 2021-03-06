const decompress = require('decompress');
const fs = require('fs-extra');
const { debug } = require('../log');
const app = require('./app');

module.exports = (ddoc, mode) => {

  const moduleToApp = module => {
    if (!ddoc._attachments[module]) {
      throw Error(`${module} was specified in build_info.node_modules but is not attached`);
    }

    return app(module, ddoc._attachments[module].digest, mode);
  };

  const appNotAlreadyUnzipped = app => !fs.existsSync(app.deployPath());

  const appNotCurrent = app => {
    const currentPath = app.deployPath('current');
    if (!fs.existsSync(currentPath)) {
      return true;
    }
    const linkString = fs.readlinkSync(currentPath);
    if(!fs.existsSync(linkString)) {
      return true;
    }

    return linkString !== app.deployPath();
  };

  const getApps = () => {
    if (ddoc.node_modules) {
      // Legacy Kanso data location
      return ddoc.node_modules
        .split(',')
        .map(module => moduleToApp(module));
    }

    if (ddoc.build_info) {
      // New horticulturalist layout
      return ddoc.build_info.node_modules
        .map(module => moduleToApp(module));
    }

    return [];
  };

  const getChangedApps = () => {
    let changedApps = getApps();
    debug(`Found ${JSON.stringify(changedApps)}`);
    changedApps = changedApps.filter(appNotCurrent);
    debug(`Apps that are changed: ${JSON.stringify(changedApps)}`);

    return changedApps;
  };

  const unzipChangedApps = (changedApps) => {
    const appsToUnzip = changedApps.filter(appNotAlreadyUnzipped);
    return Promise.all(appsToUnzip.map(app => {
      const attachment = ddoc._attachments[app.attachmentName].data;
      return decompress(attachment, app.deployPath(), {
        map: file => {
          file.path = file.path.replace(/^package/, '');
          return file;
        }
      });
    }));
  };

  return {
    ddoc: ddoc,
    mode: mode,
    getChangedApps: () => getChangedApps(),
    unzipChangedApps: (apps) => unzipChangedApps(apps),
    getApps: () => getApps()
  };
};
