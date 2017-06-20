const apps = require('./apps');
const decompress = require('decompress');
const fs = require('fs-extra');
const lockfile = require('./lockfile');
const Path = require('path');
const PouchDB = require('pouchdb');


const COUCH_URL = process.env.COUCH_URL;
const DEPLOYMENTS_DIR = 'deployments';
const DDOC = '_design/medic';


if(!COUCH_URL) throw new Error('COUCH_URL env var not set.');


try {
  fs.mkdirSync(DEPLOYMENTS_DIR);
} catch(e) {
  if(e.code !== 'EEXIST') throw e;
}

if(lockfile.exists()) {
  throw new Error(`Lock file already exists at ${lockfile.path()}.  Cannot start horticulturalising.`);
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
        processDdoc(change.doc);
      })
      .on('error', fatality);
  })
  .catch(fatality);


function processDdoc(ddoc) {
  console.log('Processing ddoc...');
  const changedApps = getChangedApps(ddoc);

  if(changedApps.length) {
    lockfile.wait()

      .then(() => console.log('Unzipping changed apps…', changedApps))
      .then(() => unzipChangedApps(changedApps))
      .then(() => console.log('Changed apps unzipped.'))

      .then(() => console.log('Stopping all apps…', apps.APPS))
      .then(() => apps.stop())
      .then(() => console.log('All apps stopped.'))

      .then(() => console.log('Updating symlinks for changed apps…', changedApps))
      .then(() => updateSymlinkAndRemoveOldVersion(changedApps))
      .then(() => console.log('.'))

      .then(() => console.log('Starting all apps…', apps.APPS))
      .then(() => apps.start())
      .then(() => console.log('All apps started.'))

      .then(() => lockfile.release())

      .catch(fatality);
  } else console.log('No apps have changed.');
}

const getChangedApps = ddoc =>
  ddoc.node_modules
    .split(',')
    .map(module => moduleToApp(ddoc, module))
    .filter(appNotAlreadyUnzipped);

const moduleToApp = (ddoc, module) =>
  ({
    name: appNameFromModule(module),
    attachmentName: module,
    digest: ddoc._attachments[module].digest,
  });

const appNotAlreadyUnzipped = app =>
  !fs.existsSync(path(app.name, app.digest));

const appNameFromModule = module =>
  module.substring(0, module.lastIndexOf('-'));

const unzipChangedApps = changedApps =>
  Promise.all(changedApps.map(app => db.getAttachment(DDOC, app.attachmentName)
    .then(attachment => decompress(attachment, path(app.name, app.digest)))));

const updateSymlinkAndRemoveOldVersion = changedApps =>
  Promise.all(changedApps.map(app => {
    const livePath = path(app.name, 'live');

    if(fs.existsSync(livePath)) {
      const linkString = fs.readlinkSync(livePath);

      if(fs.existsSync(linkString)) {
        console.log(`Deleting old ${app} from ${linkString}…`);
        fs.removeSync(linkString);
      } else console.log(`Old app not found at ${linkString}.`);

      fs.unlinkSync(livePath);
    }

    fs.symlinkSync(path(app.name, app.digest), livePath);

    return Promise.resolve();
  }));

const path = (app, version) => Path.resolve(DEPLOYMENTS_DIR, app, version);

function fatality(err) {
  console.error(err);
  lockfile.release()
    .then(() => process.exit(1));
}
