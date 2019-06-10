const decompress = require('decompress');
const fs = require('fs-extra');
const { debug } = require('../log');
const app = require('./app');

module.exports = (ddoc, mode, currentDdoc) => {

  const moduleToApp = module => {
    if (!ddoc._attachments[module]) {
      throw Error(`${module} was specified in build_info.node_modules but is not attached`);
    }

    return app(module, ddoc._attachments[module].digest, mode);
  };

  const appNotAlreadyUnzipped = app => !fs.existsSync(app.deployPath());

  const appChanged = (app, currentApps) => {
    const currentApp = currentApps.find(currentApp => currentApp.name === app.name);
    return !currentApp || currentApp.digest !== app.digest;
  };

  const getDdocApps = (ddoc) => {
    if (ddoc && ddoc.node_modules) {
      // Legacy Kanso data location
      return ddoc.node_modules
        .split(',')
        .map(module => moduleToApp(module));
    }

    if (ddoc && ddoc.build_info) {
      // New horticulturalist layout
      return ddoc.build_info.node_modules
        .map(module => moduleToApp(module));
    }

    return [];
  };

  const getApps = () => getDdocApps(ddoc);
  const getCurrentApps = () => getDdocApps(currentDdoc);

  const getChangedApps = () => {
    let changedApps = getApps();
    const currentApps = getCurrentApps();
    debug(`Found ${JSON.stringify(changedApps)}`);
    changedApps = changedApps.filter(app => appChanged(app, currentApps) || appNotAlreadyUnzipped(app));
    debug(`Apps that are changed: ${JSON.stringify(changedApps)}`);

    return changedApps;
  };

  const unzipChangedApps = (changedApps) =>
    Promise.all(changedApps.filter(appNotAlreadyUnzipped).map(app => {
      const attachment = ddoc._attachments[app.attachmentName].data;
      return decompress(attachment, app.deployPath(), {
        map: file => {
          file.path = file.path.replace(/^package/, '');
          return file;
        }
      });
    }));

  return {
    ddoc: ddoc,
    mode: mode,
    getChangedApps: () => getChangedApps(),
    unzipChangedApps: (apps) => unzipChangedApps(apps),
    getApps: () => getApps()
  };
};
