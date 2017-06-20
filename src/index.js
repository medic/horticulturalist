const decompress = require('decompress');
const fs = require('fs');
const PouchDB = require('pouchdb');
const lockfile = require('lockfile');

const COUCH_URL = 'http://localhost:5984/medic';
const DDOC = '_design/medic';
const APPS = [ 'medic-api', 'medic-sentinel' ];

if(lockFileExists()) {
  throw new Error('Lock file already exists.  Cannot start horticulturalisting.');
}

new PouchDB(COUCH_URL)
  .changes({
    live: true,
    since: 'now',
    doc_ids: [ DDOC ],
    timeout: false,
  })
  .on('change', change => {
    const ddoc = change.changes[0].doc;
    const changedApps = getChangedApps(ddoc);
    if(changedApps.length) {
      waitForLock()
        .then(() => unzipChangedApps(changedApps))
        .then(() => stopApps())
        .then(() => updateSymLinks(changedApps))
        .then(() => startApps())
        .then(() => cleanUpOldApps(ddoc));
    }
  })
  .on('error', err => { throw err; });

const cleanUpOldApps = ddoc =>
  Promise.all(ddoc.node_modules.map(module => {
    // TODO delete app dirs which do not match the current digest
  }));

function lockFileExists() {
  return lockFile.checkSync(LOCK_FILE);
}

const waitForLock = () => new Promise((resolve, reject) => {
  lockfile.lock(LOCK_FILE, err => {
    if(err) reject(err);
    else resolve();
  });
});

const getChangedApps = ddoc =>
  ddoc.node_modules
    .map(moduleToApp)
    .filter(appAlreadyUnzipped);

const moduleToApp = module =>
  ({
    name: appNameFromNodeModule(module),
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

const exec = cmd => new Promise((resolve, reject) =>
  child_process.exec(cmd, err => {
    if(err) reject(err);
    else resolve(err);
  }));
