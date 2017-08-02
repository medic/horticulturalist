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

const STAGING_URL = 'https://staging.dev.medicmobile.org/_couch/builds';

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


if(lockfile.exists()) {
  throw new Error(`Lock file already exists at ${lockfile.path()}.  Cannot start horticulturalising.`);
}

fs.mkdirs(mode.deployments);


const db = new PouchDB(COUCH_URL);
const apps = Apps(mode.start, mode.stop);

Promise.resolve()
  .then(bootstrapDdoc)
  .then(() => mode.startAppsOnStartup && startApps())
  .then(() => db.get(DDOC))
  .then(processDdoc)
  .then(() => {
    info(`Starting change feed listener at ${redact(COUCH_URL)}…`);
    db
      .changes({
        live: true,
        since: 'now',
        doc_ids: [ DDOC ],
        include_docs: true,
        timeout: false,
      })
      .on('change', change => {
        processDdoc(change.doc)
          .catch(fatality);
      })
      .on('error', fatality);
  })
  .catch(fatality);


function processDdoc(ddoc) {
  info('Processing ddoc…');
  const changedApps = getChangedApps(ddoc);

  if(changedApps.length) {
    return lockfile.wait()

      .then(() => info(`Unzipping changed apps to ${mode.deployments}…`, changedApps))
      .then(() => unzipChangedApps(changedApps))
      .then(() => info('Changed apps unzipped.'))

      .then(() => info('Stopping all apps…', apps.APPS))
      .then(() => apps.stop())
      .then(() => info('All apps stopped.'))

      .then(() => info('Updating symlinks for changed apps…', changedApps))
      .then(() => updateSymlinkAndRemoveOldVersion(changedApps))
      .then(() => info('Symlinks updated.'))

      .then(startApps)

      .then(() => lockfile.release());
  } else {
    info('No apps have changed.');
    return Promise.resolve();
  }
}


function bootstrapDdoc() {
  if(!shouldBootstrapDdoc) {
    return info('No bootstrap requested.');
  } else {
    info('Bootstrap requested.');
    trace(`Fetching new ddoc from ${STAGING_URL}…`);
    return new PouchDB(STAGING_URL)
      .get('master', { attachments:true })
      .then(newDdoc => {
        trace('New ddoc fetched.');
        newDdoc._id = '_design/medic';
        delete newDdoc._rev;
        trace('Fetching old ddoc from local db…');
        return db
          .get(DDOC)
          .then(oldDdoc => newDdoc._rev = oldDdoc._rev)
          .catch(err => {
            if(err.status === 404) trace('No old ddoc found locally.');
            else throw err;
          })
          .then(() => trace('Uploading new ddoc to local db…'))
          .then(() => db.put(newDdoc))
          .then(() => trace('Bootstrap complete.'));
      });
  }
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

const deployPath = (app, identifier) => {
  identifier = identifier || app.digest.replace(/\//g, '');
  return Path.resolve(Path.join(mode.deployments, app.name, identifier));
};

const unzipChangedApps = changedApps =>
  Promise.all(changedApps.map(app =>
    db.getAttachment(DDOC, app.attachmentName)
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
