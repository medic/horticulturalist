#!/usr/bin/env node
const chown = require('chown'),
      decompress = require('decompress'),
      fs = require('fs-extra'),
      os = require('os'),
      parseArgs = require('minimist'),
      path = require('path'),
      redact = require('redact-basic-auth');

const Apps = require('./apps'),
      fatality = require('./fatality'),
      help = require('./help'),
      lockfile = require('./lockfile');

const error = require('./log').error,
      info = require('./log').info,
      trace = require('./log').trace;

// Include pouch in modular form or npm isn't happy
const PouchDB = require('pouchdb-core');
PouchDB.plugin(require('pouchdb-adapter-http'));
PouchDB.plugin(require('pouchdb-mapreduce'));

const STAGING_URL = 'https://staging.dev.medicmobile.org/_couch/builds';

const MODES = {
  development: {
    name: 'development',
    chown_apps: false,
    deployments: './temp/deployments',
    start: [ 'bin/svc-start', './temp/deployments', '{{app}}' ],
    stop: [ 'bin/svc-stop', '{{app}}' ],
    startAppsOnStartup: true,
  },
  local: {
    name: 'local',
    chown_apps: false,
    deployments: `${os.homedir()}/.horticulturalist/deployments`,
    start: [ 'horti-svc-start', `${os.homedir()}/.horticulturalist/deployments`, '{{app}}' ],
    stop: [ 'horti-svc-stop', '{{app}}' ],
    startAppsOnStartup: true,
  },
  medic_os: {
    name: 'Medic OS',
    chown_apps: true,
    deployments: '/srv/software',
    start: ['svc-start', '{{app}}' ],
    stop: ['svc-stop', '{{app}}' ],
    startAppsOnStartup: false,
  },
};

const argv = parseArgs(process.argv);

if ([argv.dev, argv.local, argv['medic-os']].filter(x => !!x).length !== 1) {
  help.outputHelp();
  error('You must pick one mode to run in.');
  return;
}

const mode = argv.dev         ? MODES.development :
             argv.local       ? MODES.local :
             argv['medic-os'] ? MODES.medic_os :
             undefined;

if (argv.version || argv.v) {
  help.outputVersion();
  return;
}

if (!mode || argv.help || argv.h) {
  help.outputHelp();
  return;
}

let bootstrapVersion = argv.bootstrap || argv['only-bootstrap'];
if (bootstrapVersion === true) {
  bootstrapVersion = 'master';
}
const latestBuild = bootstrapVersion && bootstrapVersion.startsWith('@');
if (latestBuild) {
  bootstrapVersion = bootstrapVersion.substring(1);
}

const daemonMode = !argv['only-bootstrap'];

const COUCH_URL = process.env.COUCH_URL;
if(!COUCH_URL) throw new Error('COUCH_URL env var not set.');

const DDOC_ID = '_design/medic';
const STAGED_DDOC_ID = '_design/medic:staged';

if(lockfile.exists()) {
  throw new Error(`Lock file already exists at ${lockfile.path()}.  Cannot start horticulturalising.`);
}

fs.mkdirs(mode.deployments);

const db = new PouchDB(COUCH_URL);
const apps = Apps(mode.start, mode.stop);

info(`Starting Horticulturalist ${daemonMode ? 'daemon ' : ''}in ${mode.name} mode`);
Promise.resolve()
  .then(() => bootstrapVersion && bootstrap())
  .then(() => {
    if (daemonMode) {
      info('Initiating horticulturalist daemon');
      return Promise.resolve()
        // Check for and process staged ddoc
        .then(() => db.get(STAGED_DDOC_ID, {attachments: true}))
        .catch(err => {
          if (err.status !== 404) {
            throw err;
          }

          info('No deployments to make upon boot');
        })
        .then(ddoc => ddoc && processDdoc(ddoc, true))
        // If we didn't just process (and start) the new ddoc, maybe start it here
        .then(processed => !processed && mode.startAppsOnStartup && startApps())
        // Listen for new staged deployments and process them
        .then(() => {
          info(`Starting change feed listener at ${redact(COUCH_URL)}…`);
          db
            .changes({
              live: true,
              since: 'now',
              doc_ids: [ STAGED_DDOC_ID ],
              include_docs: true,
              attachments: true,
              timeout: false,
            })
            .on('change', change => {
              trace(`Change in ${STAGED_DDOC_ID} detected`);
              if (!change.deleted) {
                  processDdoc(change.doc).catch(fatality);
              } else {
                trace('Ignoring our own delete');
              }
            })
            .on('error', fatality);
        });
    }
  })
  .catch(fatality);


// Deploy the passed ddoc, and deploy node modules if required
// For safety we always deploy the staged ddoc if one exists
// In the future we could look somewhere in metadata to determin if it's different
function processDdoc(ddoc, firstRun) {
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
}


// Load and stage a ddoc for deployment
function bootstrap() {
  info(`Bootstrap requested. Bootstrapping to ${latestBuild ? 'the latest ' : ''}${bootstrapVersion}`);
  trace(`Fetching new ddoc from ${STAGING_URL}...`);
  const staging = new PouchDB(STAGING_URL);
  return Promise.resolve()
    .then(() => {
      if (latestBuild) {
        return staging.query('builds/releases', {
          startkey: [bootstrapVersion, 'medic', 'medic', {}],
          endkey: [bootstrapVersion, 'medic', 'medic'],
          descending: true,
          include_docs: true,
          attachments: true,
          limit: 1
        }).then(results => {
          if (results.rows.length === 0) {
            throw new Error(`There are currently no builds for '${bootstrapVersion}' available`);
          } else {
            const row = results.rows[0];
            info(`Got ${row.id}`);
            bootstrapVersion = results.id.replace('medic:medic', '');
            return row.doc;
          }
        });
      } else {
        return staging.get(`medic:medic:${bootstrapVersion}`, { attachments:true });
      }
    })
    .then(newDdoc => {
      trace('New ddoc fetched.');
      newDdoc._id = STAGED_DDOC_ID;
      newDdoc.deploy_info = {
        timestamp: new Date().toString(),
        user: 'horticulturalist (bootstrap)',
        version: bootstrapVersion,
      };
      delete newDdoc._rev;
      trace('Fetching old staged ddoc from local db…');
      return db
        .get(STAGED_DDOC_ID)
        .then(oldDdoc => newDdoc._rev = oldDdoc._rev)
        .catch(err => {
          if (err.status === 404) trace('No old staged ddoc found locally.');
          else throw err;
        })
        .then(() => trace('Uploading new ddoc to local db…'))
        .then(() => db.put(newDdoc))
        .then(() => info('Bootstrap complete.'));
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

// Takes a staged DDOC and correctly moves it into its production location
const deployDdoc = stagedDdoc => {
  info(`Deploy staged ddoc ${STAGED_DDOC_ID} to ${DDOC_ID}`);

  const deletedStagedDdoc = {
    _id: stagedDdoc._id,
    _rev: stagedDdoc._rev,
    _deleted: true
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
  return path.resolve(path.join(mode.deployments, app.name, identifier));
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
