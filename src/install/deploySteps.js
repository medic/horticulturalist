const fs = require('fs-extra'),
      apps = require('../apps'),
      ddocWrapper = require('./ddocWrapper');

const { info, debug } = require('../log'),
      DB = require('../dbs');

const utils = require('../utils');

module.exports = (mode, deployDoc) => {

  const startApps = (mode) => {
    info('Starting all apps…', mode.appsToDeploy);
    return apps.start(mode.start, mode.appsToDeploy)
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
        return utils.betterBulkDocs(secondaryDdocs)
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

  const deployStagedDdocs = () => {
    info(`Deploying staged ddocs`);

    return moduleWithContext._loadStagedDdocs()
      .then(({primaryDdoc, secondaryDdocs}) => {
        return moduleWithContext._deploySecondaryDdocs(secondaryDdocs)
          .then(() => moduleWithContext._deployPrimaryDdoc(primaryDdoc));
      });
  };

  const updateSymlink = changedApps => {
    return Promise.all(changedApps.map(app => {
      const livePath = app.deployPath('current');

      if(fs.existsSync(livePath)) {
        const linkString = fs.readlinkSync(livePath);

        if(fs.existsSync(linkString)) {
          const oldLinkString = app.deployPath('old');
          if (fs.existsSync(oldLinkString)) {
            fs.unlinkSync(oldLinkString);
          }
          fs.symlinkSync(linkString, oldLinkString);
        } else debug(`Old app not found at ${linkString}.`);

        fs.unlinkSync(livePath);
      }

      fs.symlinkSync(app.deployPath(), livePath);
    }));
  };

  const processDdoc = (ddoc, firstRun) => {
    const wrappedDdoc = ddocWrapper(ddoc, mode);
    const changedApps = wrappedDdoc.getChangedApps();

    // deploy the intersection of changed apps and desired apps
    const appsToDeploy = changedApps.filter(changed => mode.appsToDeploy.includes(changed.name));
    const deployCount = appsToDeploy.length;

    return Promise.resolve()
      .then(() => {
        if (deployCount) {
          return Promise.resolve()
            .then(() => info(`Unzipping changed apps to ${mode.deployments}…`, appsToDeploy))
            .then(() => wrappedDdoc.unzipChangedApps(appsToDeploy))
            .then(() => info('Changed apps unzipped.'))
            .then(() => {
              if (mode.daemon) {
                return Promise.resolve()
                  .then(() => info('Stopping all apps…', apps.APPS))
                  .then(() => apps.stop(mode.stop, mode.appsToDeploy))
                  .then(() => info('All apps stopped.'));
              }
            });
        } else {
          debug('No apps to deploy');
        }
      })

      .then(() => mode.stageDeployment ? deployStagedDdocs() : undefined)

      .then(() => {
        if (deployCount) {
          return Promise.resolve()
            .then(() => info('Updating symlinks for changed apps…', appsToDeploy))
            .then(() => updateSymlink(appsToDeploy))
            .then(() => info('Symlinks updated.'));
        }
      })

      .then(() => {
        if (mode.daemon && (deployCount || firstRun)) {
          return startApps(mode).then(() => {
            return appsToDeploy;
          });
        }
      });
  };

  const moduleWithContext = {
    run: (ddoc, firstRun) => {
      return processDdoc(ddoc, firstRun);
    },
    _deployStagedDdocs: deployStagedDdocs,
    _loadStagedDdocs: loadStagedDdocs,
    _deploySecondaryDdocs: deploySecondaryDdocs,
    _deployPrimaryDdoc: deployPrimaryDdoc,
    _updateSymlink: updateSymlink
  };

  return moduleWithContext;
};
