const decompress = require('decompress'),
      fs = require('fs-extra'),
      path = require('path');

const { info, debug } = require('../log'),
      DB = require('../dbs');

const utils = require('../utils');

module.exports = (apps, mode, deployDoc) => {
  const appNameFromModule = module =>
    module.substring(0, module.lastIndexOf('-'));

  const deployPath = (app, identifier) => {
    identifier = identifier || app.digest.replace(/\//g, '');
    return path.resolve(path.join(mode.deployments, app.name, identifier));
  };

  const appNotAlreadyUnzipped = app =>
    !fs.existsSync(deployPath(app));

  const moduleToApp = (ddoc, module) => {
    if (!ddoc._attachments[module]) {
      throw Error(`${module} was specified in build_info.node_modules but is not attached`);
    }

    const app = {
      name: appNameFromModule(module),
      attachmentName: module,
      digest: ddoc._attachments[module].digest,
    };

    return app;
  };

  const getChangedApps = ddoc => {
    let apps = [];
    if (ddoc.node_modules) {
      // Legacy Kanso data location
      apps = ddoc.node_modules
              .split(',')
              .map(module => moduleToApp(ddoc, module));
    } else if (ddoc.build_info) {
      // New horticulturalist layout
      apps = ddoc.build_info.node_modules
              .map(module => moduleToApp(ddoc, module));
    }

    debug(`Found ${JSON.stringify(apps)}`);
    apps = apps.filter(appNotAlreadyUnzipped);
    debug(`Apps that aren't unzipped: ${JSON.stringify(apps)}`);

    return apps;
  };

  const unzipChangedApps = (ddoc, changedApps) =>
    Promise.all(changedApps.map(app => {
      const attachment = ddoc._attachments[app.attachmentName].data;
      return decompress(attachment, deployPath(app), {
        map: file => {
          file.path = file.path.replace(/^package/, '');
          return file;
        }
      });
    }));

  const startApps = () => {
    info('Starting all apps…', apps.APPS);
    return apps.start()
      .then(() => info('All apps started.'));
  };

  const loadStagedDdocs = () => {
    return utils.getStagedDdocs(true, true)
      .then(stagedDdocs => {
        const stagedMainDdocId = utils.getStagedDdocId(utils.mainDdocId(deployDoc));

        return stagedDdocs.reduce((acc, ddoc) => {
          if (ddoc._id === stagedMainDdocId) {
            acc.primaryDdoc = ddoc;
          } else {
            acc.secondaryDdocs.push(ddoc);
          }

          return acc;
        }, {secondaryDdocs: []});
      });
  };

  const deploySecondaryDdocs = secondaryDdocs => {
    debug(`Secondary ddocs: ${secondaryDdocs.map(d => d._id)}`);
    debug('Getting currently deployed secondary ddocs');

    const deployIds = secondaryDdocs
      .map(ddoc => ddoc._id)
      .map(utils.getDeployedDdocId);

    return DB.app.allDocs({keys: deployIds})
      .then(({rows: deployedStubs}) => {
        debug(`Found ${deployedStubs.length}`);

        secondaryDdocs.forEach(ddoc => {
          ddoc._id = utils.getDeployedDdocId(ddoc._id);

          const currentlyDeployed = deployedStubs.find(d => d.id === ddoc._id);
          if (currentlyDeployed) {
            debug(`${ddoc._id} already exists, overwriting`);
            ddoc._rev = currentlyDeployed.value.rev;
          } else {
            debug(`${ddoc._id} is new, adding`);
            delete ddoc._rev;
          }
        });

        debug('Writing secondary ddocs');
        return utils.strictBulkDocs(secondaryDdocs)
          .then(results => debug(`Secondary ddocs written: ${JSON.stringify(results)}`));
      });
  };

  const deployPrimaryDdoc = primaryDdoc => {
    debug(`Primary ddoc: ${primaryDdoc._id}`);
    debug('Checking to see if primary exists already');

    primaryDdoc._id = utils.getDeployedDdocId(primaryDdoc._id);

    return DB.app.get(primaryDdoc._id)
      .catch(err => {
        if (err.status !== 404) {
          throw err;
        }
      })
      .then(deployedDdoc => {
        if (deployedDdoc) {
          debug('It does');
          primaryDdoc.app_settings = deployedDdoc.app_settings;
          primaryDdoc._rev = deployedDdoc._rev;
        } else {
          debug('It does not');
          delete primaryDdoc._rev;
        }

        debug('Writing primary ddoc');
        return DB.app.put(primaryDdoc)
          .then(() => debug('Primary ddoc written'));
      });
  };

  const deployStagedDdocs = (secondaryOnly=false) => {
    info(`Deploying staged ddocs`);

    return moduleWithContext._loadStagedDdocs()
      .then(({primaryDdoc, secondaryDdocs}) => {
        return moduleWithContext._deploySecondaryDdocs(secondaryDdocs)
          .then(() => {
            if(!secondaryOnly) {
              moduleWithContext._deployPrimaryDdoc(primaryDdoc);
            }
          });
      });
  };

  const updateSymlink = changedApps => {
    return Promise.all(changedApps.map(app => {
      const livePath = deployPath(app, 'current');

      if(fs.existsSync(livePath)) {
        const linkString = fs.readlinkSync(livePath);

        if(fs.existsSync(linkString)) {
          fs.symlinkSync(linkString, deployPath(app, 'old'));
        } else debug(`Old app not found at ${linkString}.`);

        fs.unlinkSync(livePath);
      }

      fs.symlinkSync(deployPath(app), livePath);
    }));
  };

  const removeOldVersion = changedApps => {
    return Promise.all(changedApps.map(app => {
      const oldPath = deployPath(app, 'old');

      if(fs.existsSync(oldPath)) {
        const linkString = fs.readlinkSync(oldPath);

        if(fs.existsSync(linkString)) {
          debug(`Deleting old ${app.name} from ${linkString}…`);
          fs.removeSync(linkString);
        } else debug(`Old app not found at ${linkString}.`);

        fs.unlinkSync(oldPath);
      }
    }));
  };

  const processDdoc = (ddoc, firstRun) => {
    const changedApps = getChangedApps(ddoc);
    const appsToDeploy = changedApps.length;

    return Promise.resolve()
      .then(() => {
        if (appsToDeploy) {
          return Promise.resolve()
            .then(() => info(`Unzipping changed apps to ${mode.deployments}…`, changedApps))
            .then(() => unzipChangedApps(ddoc, changedApps))
            .then(() => info('Changed apps unzipped.'))
            .then(() => deployStagedDdocs(true))
            .then(() => {
              if (mode.daemon) {
                return Promise.resolve()
                  .then(() => info('Stopping all apps…', apps.APPS))
                  .then(() => apps.stop())
                  .then(() => info('All apps stopped.'));
              }
            });
        } else {
          debug('No apps to deploy');
        }
      })

      .then(() => deployStagedDdocs())

      .then(() => {
        if (appsToDeploy) {
          return Promise.resolve()
            .then(() => info('Updating symlinks for changed apps…', changedApps))
            .then(() => updateSymlink(changedApps))
            .then(() => info('Symlinks updated.'));
        }
      })

      .then(() => {
        if (mode.daemon && (appsToDeploy || firstRun)) {
          return startApps().then(() => {
            return changedApps;
          });
        }
      });
  };

  const moduleWithContext = {
    run: (ddoc, firstRun) => {
      return processDdoc(ddoc, firstRun);
    },
    removeOldVersion: (changedApps) => removeOldVersion(changedApps),
    _deployStagedDdocs: deployStagedDdocs,
    _loadStagedDdocs: loadStagedDdocs,
    _deploySecondaryDdocs: deploySecondaryDdocs,
    _deployPrimaryDdoc: deployPrimaryDdoc
  };

  return moduleWithContext;
};
