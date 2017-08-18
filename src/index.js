#!/usr/bin/env node
const Apps = require('./apps');
const chown = require('chown');
const decompress = require('decompress');
const fatality = require('./fatality');
const fs = require('fs-extra');
const info = require('./log').info;
const lockfile = require('./lockfile');
const os = require('os');
const Path = require('path');
const redact = require('redact-basic-auth');
const trace = require('./log').trace;

// Include pouch in modular form or npm isn't happy
const PouchDB = require('pouchdb-core');
PouchDB.plugin(require('pouchdb-adapter-http'));

// const STAGING_URL = 'https://staging.dev.medicmobile.org/_couch/builds';

//////////////////////////////// HACK
const STAGING_URL = 'http://admin:pass@localhost:5984/builds';
//////////////////////////////// HACK

const MODES = {
  development: {
    chown_apps: false,
    deployments: './temp/deployments',
    start: [ 'bin/svc-start', './temp/deployments', '{{app}}' ],
    stop: [ 'bin/svc-stop', '{{app}}' ],
    startAppsOnStartup: true,
  },
  local: {
    chown_apps: false,
    deployments: `${os.homedir()}/.horticulturalist/deployments`,
    start: [ 'horti-svc-start', `${os.homedir()}/.horticulturalist/deployments`, '{{app}}' ],
    stop: [ 'horti-svc-stop', '{{app}}' ],
    startAppsOnStartup: true,
  },
  medic_os: {
    chown_apps: true,
    deployments: '/srv/software',
    start: ['svc-start', '{{app}}' ],
    stop: ['svc-stop', '{{app}}' ],
    startAppsOnStartup: false,
  },
};

const args = process.argv.slice(2);

if(args[0] === '--version') {
  const version = require('../package').version;
  console.log(`horticulturalist-${version}`);
  return;
}

const mode = args.includes('--dev')   ? MODES.development :
             args.includes('--local') ? MODES.local : MODES.medic_os;

const shouldBootstrapDdoc = args.includes('--bootstrap');

const COUCH_URL = process.env.COUCH_URL;
if(!COUCH_URL) throw new Error('COUCH_URL env var not set.');

const DDOC = '_design/medic';
const STAGED_DDOC = '_design/medic:staged';

if(lockfile.exists()) {
  throw new Error(`Lock file already exists at ${lockfile.path()}.  Cannot start horticulturalising.`);
}

fs.mkdirs(mode.deployments);

const db = new PouchDB(COUCH_URL);
const apps = Apps(mode.start, mode.stop);

info('Starting Horticulturalist');
Promise.resolve()
  // If we're bootstrapping pull down the DDOC, process and deploy it
  .then(() => shouldBootstrapDdoc && bootstrap())
  .catch(fatality)
  // If we're not boostrapping but we want to start apps do that
  .then(() => !shouldBootstrapDdoc && mode.startAppsOnStartup && startApps())
  // In case there is an existing staged ddoc to be deployed deal with it
  .then(() => db.get(STAGED_DDOC))
  .catch(err => {
    if (err.status !== 404) {
      throw err;
    }

    info('No deployments to make upon boot');
  })
  .then(ddoc => ddoc && processDdoc(ddoc))
  // Listen for new staged deployments and process them
  .then(() => {
    info(`Starting change feed listener at ${redact(COUCH_URL)}…`);
    db
      .changes({
        live: true,
        since: 'now',
        doc_ids: [ STAGED_DDOC ],
        include_docs: true,
        attachments: true,
        timeout: false,
      })
      .on('change', change => {
        trace(`Change in ${STAGED_DDOC} detected`);
        if (!change.doc._deleted) {
            return processDdoc(change.doc).catch(fatality);
        } else {
          trace('Ignoring our own delete');
        }
      })
      .on('error', fatality);
  })
  .catch(fatality);


function processDdoc(ddoc, firstRun) {
  info(`Processing ddoc ${ddoc._id}`);

  const changedApps = getChangedApps(ddoc);

  if(changedApps.length) {
    return lockfile.wait()

      .then(() => info(`Unzipping changed apps to ${mode.deployments}…`, changedApps))
      .then(() => unzipChangedApps(changedApps))
      .then(() => info('Changed apps unzipped.'))

      .then(() => info('Stopping all apps…', apps.APPS))
      .then(() => apps.stop())
      .then(() => info('All apps stopped.'))

      .then(() => deployDdoc(ddoc))

      .then(() => info('Updating symlinks for changed apps…', changedApps))
      .then(() => updateSymlinkAndRemoveOldVersion(changedApps))
      .then(() => info('Symlinks updated.'))

      .then(startApps)

      .then(() => lockfile.release());
  } else {
    info('No apps have changed.');

    if (firstRun) {
      return startApps();
    } else {
      return Promise.resolve();
    }
  }
}


function bootstrap() {
  info('Bootstrap requested.');
  trace(`Fetching new ddoc from ${STAGING_URL}…`);
  return new PouchDB(STAGING_URL)
    .get('medic:medic:master', { attachments:true }) // TODO parameterise master
    .then(newDdoc => {
      trace('New ddoc fetched.');
      newDdoc._id = STAGED_DDOC;
      newDdoc.deploy_info = {
        timestamp: new Date().toString(),
        user: 'horticulturalist (bootstrap)',
        version: 'master', // TODO parameterise master
      };
      delete newDdoc._rev;
      trace('Fetching old staged ddoc from local db…');
      return db
        .get(STAGED_DDOC)
        .then(oldDdoc => newDdoc._rev = oldDdoc._rev)
        .catch(err => {
          if (err.status === 404) trace('No old staged ddoc found locally.');
          else throw err;
        })
        .then(() => trace('Uploading new ddoc to local db…'))
        .then(() => db.put(newDdoc))
        .then(() => db.get(STAGED_DDOC, {attachments: true}))
        .then(ddoc => processDdoc(ddoc, true))
        .then(() => trace('Bootstrap complete.'));
    });
}


function startApps() {
  info('Starting all apps…', apps.APPS);
  return apps.start()
    .then(() => info('All apps started.'));
}

const appNameFromModule = module =>
  module.substring(0, module.lastIndexOf('-'));

const appNotAlreadyUnzipped = app =>
  !fs.existsSync(deployPath(app));

const getChangedApps = ddoc =>
  ddoc.node_modules ?
    ddoc.node_modules
        .split(',')
        .map(module => moduleToApp(ddoc, module))
        .filter(appNotAlreadyUnzipped) :
    [];

const moduleToApp = (ddoc, module) =>
  ({
    name: appNameFromModule(module),
    attachmentName: module,
    digest: ddoc._attachments[module].digest,
  });

const deployDdoc = stagedDdoc => {
  info(`Deploy staged ddoc ${stagedDdoc._id} to ${DDOC}`);

  const deletedStagedDdoc = {
    _id: stagedDdoc._id,
    _rev: stagedDdoc._rev,
    _deleted: true
  };

  info('Getting currently live DDOC');
  return db.get(DDOC)
    .catch(err => {
      if (err.status !== 404) {
        throw err;
      }

      info('No existing live DDOC');
    })
    .then(liveDdoc => {
      info('Preparing staged ddoc for deployment');
      stagedDdoc._id = DDOC;

      if (liveDdoc) {
        stagedDdoc._rev = liveDdoc._rev;
        stagedDdoc.app_settings = liveDdoc.app_settings;

        trace(`Copied id(${stagedDdoc._id}), rev(${stagedDdoc._rev}) and app_settings from current DDOC into staged`);
      } else {
        delete stagedDdoc._rev;
      }

      trace('Storing modified staged DDOC in production location');
      return stagedDdoc;
    })
    .then(ddoc => db.put(ddoc))
    .then(result => trace('Modified staged DDOC PUT result:', result))
    .then(() => info('Modified staged DDOC deployed successfully'))
    .then(() => info(`Deleting ${deletedStagedDdoc._id}`))
    .then(() => db.remove(deletedStagedDdoc))
    .then(result => trace('Original Staged DDOC DELETE result:', result))
    .then(() => info('Original Staged DDOC deleted successfully'))
    .then(() => info('Ddoc deployed'));
};

const deployPath = (app, identifier) => {
  identifier = identifier || app.digest.replace(/\//g, '');
  return Path.resolve(Path.join(mode.deployments, app.name, identifier));
};

const unzipChangedApps = changedApps =>
  Promise.all(changedApps.map(app =>
    db.getAttachment(STAGED_DDOC, app.attachmentName)
      .catch(fatality)
      .then(attachment =>
        decompress(attachment, deployPath(app), {
          map: file => {
            file.path = file.path.replace(/^package/, '');
            return file;
          },
        })
      )
      .then(() => mode.chown_apps && chown(deployPath(app), app.name))));

const updateSymlinkAndRemoveOldVersion = changedApps =>
  Promise.all(changedApps.map(app => {
    const livePath = deployPath(app, 'current');

    if(fs.existsSync(livePath)) {
      const linkString = fs.readlinkSync(livePath);

      if(fs.existsSync(linkString)) {
        trace(`Deleting old ${app.name} from ${linkString}…`);
        fs.removeSync(linkString);
      } else trace(`Old app not found at ${linkString}.`);

      fs.unlinkSync(livePath);
    }

    fs.symlinkSync(deployPath(app), livePath);

    return Promise.resolve();
  }));
