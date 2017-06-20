const decompress = require('decompress');
const fs = require('fs');
const PouchDB = require('pouchdb');
const lockfile = require('lockfile');

const LOCK_FILE = 'horticulturalist.lock';

const COUCH_URL = 'http://admin:pass@localhost:5984/medic';
const DDOC = '_design/medic';
const APPS = [ 'medic-api', 'medic-sentinel' ];

if(lockFileExists()) {
  throw new Error('Lock file already exists.  Cannot start horticulturalisting.');
}

const db = new PouchDB(COUCH_URL);

db.get(DDOC)
  .then(processDdoc)
  .then(() => {
    db
      .changes({
        live: true,
        since: 'now',
        doc_ids: [ DDOC ],
        include_docs: true,
        timeout: false,
      })
      .on('change', change => {
        console.log('change listener fired for', JSON.stringify(Object.keys(change)));
        processDdoc(change.doc);
      })
      .on('error', fatality);
  })
  .catch(fatality);

function fatality(err) {
  console.error(err);
  process.exit(1);
}

function processDdoc(ddoc) {
  console.log('processDdoc()');

  const changedApps = getChangedApps(ddoc);

  console.log('processDdoc()', 'changed:', changedApps);

  if(changedApps.length) {
    waitForLock()
      .then(() => unzipChangedApps(changedApps))
      .then(() => stopApps())
      .then(() => updateSymLinks(changedApps))
      .then(() => startApps())
      .then(() => cleanUpOldApps(ddoc))
      .catch(fatality);
  }
}

const cleanUpOldApps = ddoc =>
  Promise.all(ddoc.node_modules
    .split(',')
    .map(module => {
      // TODO delete app dirs which do not match the current digest
    }));

function lockFileExists() {
  return lockfile.checkSync(LOCK_FILE);
}

const waitForLock = () =>
  new Promise((resolve, reject) => {
    lockfile.lock(LOCK_FILE, err => {
      if(err) reject(err);
      else resolve();
    });
  });

const getChangedApps = ddoc =>
  ddoc.node_modules
    .split(',')
    .map(module => moduleToApp(ddoc, module))
    .filter(appAlreadyUnzipped);

const moduleToApp = (ddoc, module) =>
  ({
    name: appNameFromModule(module),
    attachmentName: module,
    digest: ddoc._attachments[module].digest,
  });

const appAlreadyUnzipped = app =>
  fs.existsSync(path(app.name, app.digest));

const appNameFromModule = module =>
  module.substring(0, module.lastIndexOf('-'));

const unzipChangedApps = changedApps =>
  Promise.all(changedApps.map(app => db.getAttachment(DDOC, app.attachmentName)
    .then(attachment => decompress(attachment, path(app.name, app.digest)))));

const updateSymLinks = changedApps =>
  Promise.all(changedApps.map(app =>
      fs.symlinkSync(path(app.name, 'live'), path(app.name, app.digest))));

const stopApps = () =>
  Promise.all(APPS.map(app => exec(`svc-stop ${app}`)));

const startApps = () =>
  APPS.reduce(
      (p, app) => p.then(exec(`svc-start ${app}`)),
      Promise.resolve);

const exec = cmd =>
  new Promise((resolve, reject) =>
    child_process.exec(cmd, err => {
      if(err) reject(err);
      else resolve(err);
    }));

const path = (app, version) => `${app}/${version}`;
