#!/usr/bin/env node
const apps = require('./apps');
const chown = require('chown');
const decompress = require('decompress');
const fs = require('fs-extra');
const lockfile = require('./lockfile');
const Path = require('path');

// Include pouch in modular form or npm isn't happy
const PouchDB = require('pouchdb-core');
PouchDB.plugin(require('pouchdb-adapter-http'));


const COUCH_URL = process.env.COUCH_URL;
const DDOC = '_design/medic';


if(!COUCH_URL) throw new Error('COUCH_URL env var not set.');



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
        processDdoc(change.doc)
          .catch(fatality);
      })
      .on('error', fatality);
  })
  .catch(fatality);


function processDdoc(ddoc) {
  console.log('Processing ddoc...');
  const changedApps = getChangedApps(ddoc);

  if(changedApps.length) {
    return lockfile.wait()

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

      .then(() => lockfile.release());
  } else {
    console.log('No apps have changed.');
    return Promise.resolve();
  }
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
  return Path.join('/srv/software', app.name, identifier);
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
      .then(() => chown(deployPath(app), app.name))));

const updateSymlinkAndRemoveOldVersion = changedApps =>
  Promise.all(changedApps.map(app => {
    const livePath = deployPath(app, 'current');

    if(fs.existsSync(livePath)) {
      const linkString = fs.readlinkSync(livePath);

      if(fs.existsSync(linkString)) {
        console.log(`Deleting old ${app.name} from ${linkString}…`);
        fs.removeSync(linkString);
      } else console.log(`Old app not found at ${linkString}.`);

      fs.unlinkSync(livePath);
    }

    fs.symlinkSync(deployPath(app), livePath);

    return Promise.resolve();
  }));


function fatality(err) {
  console.error(err);
  lockfile.release()
    .then(() => process.exit(1));
}
