// A Big ball of mud, to be made smaller step by step
const decompress = require('decompress'),
      fs = require('fs-extra'),
      path = require('path');

const { info, debug } = require('../log'),
      fatality = require('../fatality'),
      lockfile = require('../lockfile');

const DDOC_ID = '_design/medic';
const STAGED_DDOC_ID = '_design/medic:staging';

module.exports = (db, apps, mode) => {
  const appNameFromModule = module =>
    module.substring(0, module.lastIndexOf('-'));

  const deployPath = (app, identifier) => {
    identifier = identifier || app.digest.replace(/\//g, '');
    return path.resolve(path.join(mode.deployments, app.name, identifier));
  };

  const appNotAlreadyUnzipped = app =>
    !fs.existsSync(deployPath(app));

  const moduleToApp = (ddoc, module) =>
    ({
      name: appNameFromModule(module),
      attachmentName: module,
      digest: ddoc._attachments[module].digest,
    });

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

    debug(`Found ${apps}`);
    apps = apps.filter(appNotAlreadyUnzipped);
    debug(`Apps that aren't unzipped: ${apps}`);

    return apps;
  };

  const unzipChangedApps = changedApps =>
    Promise.all(changedApps.map(app =>
      db.getAttachment(STAGED_DDOC_ID, app.attachmentName)
        .catch(fatality)
        .then(attachment =>
          decompress(attachment, deployPath(app), {
            map: file => {
              file.path = file.path.replace(/^package/, '');
              return file;
            },
          })
        )
    ));

  const startApps = () => {
    info('Starting all apps…', apps.APPS);
    return apps.start()
      .then(() => info('All apps started.'));
  };

  // Takes a staged DDOC and correctly moves it into its production location
  const deployDdoc = stagedDdoc => {
    info(`Deploy staged ddoc ${STAGED_DDOC_ID} to ${DDOC_ID}`);

    const stagedStub = {
      _id: stagedDdoc._id,
      _rev: stagedDdoc._rev
    };

    info('Getting currently live DDOC');
    return db.get(DDOC_ID)
      .catch(err => {
        if (err.status !== 404) {
          throw err;
        }

        info('No existing live DDOC');
      })
      .then(liveDdoc => {
        info('Preparing staged ddoc for deployment');
        stagedDdoc._id = DDOC_ID;

        if (liveDdoc) {
          stagedDdoc._rev = liveDdoc._rev;
          stagedDdoc.app_settings = liveDdoc.app_settings;

          debug(`Copied id(${stagedDdoc._id}), rev(${stagedDdoc._rev}) and app_settings from current DDOC into staged`);
        } else {
          delete stagedDdoc._rev;
        }

        debug('Storing modified staged DDOC in production location');
        return stagedDdoc;
      })
      .then(ddoc => db.put(ddoc))
      .then(result => debug('Modified staged DDOC PUT result:', result))
      .then(() => info('Modified staged DDOC deployed successfully'))
      .then(() => info(`Deleting ${stagedStub._id}`))
      .then(() => db.remove(stagedStub))
      .then(result => debug('Original Staged DDOC DELETE result:', result))
      .then(() => info('Original Staged DDOC deleted successfully'))
      .then(() => info('Ddoc deployed'));
  };

const updateSymlinkAndRemoveOldVersion = changedApps =>
  Promise.all(changedApps.map(app => {
    const livePath = deployPath(app, 'current');

    if(fs.existsSync(livePath)) {
      const linkString = fs.readlinkSync(livePath);

      if(fs.existsSync(linkString)) {
        debug(`Deleting old ${app.name} from ${linkString}…`);
        fs.removeSync(linkString);
      } else debug(`Old app not found at ${linkString}.`);

      fs.unlinkSync(livePath);
    }

    fs.symlinkSync(deployPath(app), livePath);

    return Promise.resolve();
  }));


  const processDdoc = (ddoc, firstRun) => {
    info(`Processing ddoc ${ddoc._id}`);

    const changedApps = getChangedApps(ddoc);
    const appsToDeploy = changedApps.length;

    return lockfile.wait()
      .then(() => {
        if (appsToDeploy) {
          return Promise.resolve()
            .then(() => info(`Unzipping changed apps to ${mode.deployments}…`, changedApps))
            .then(() => unzipChangedApps(changedApps))
            .then(() => info('Changed apps unzipped.'))

            .then(() => info('Stopping all apps…', apps.APPS))
            .then(() => apps.stop())
            .then(() => info('All apps stopped.'));
        } else {
          debug('No apps to deploy');
        }
      })

      .then(() => deployDdoc(ddoc))

      .then(() => {
        if (appsToDeploy) {
          return Promise.resolve()
            .then(() => info('Updating symlinks for changed apps…', changedApps))
            .then(() => updateSymlinkAndRemoveOldVersion(changedApps))
            .then(() => info('Symlinks updated.'));
        }
      })

      .then(() => (appsToDeploy || firstRun) && startApps())
      .then(() => lockfile.release())
      .then(() => true);
  };


  return (ddoc, firstRun) => {
    return processDdoc(ddoc, firstRun);
  };
};
