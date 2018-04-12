#!/usr/bin/env node
const fs = require('fs-extra'),
      os = require('os'),
      parseArgs = require('minimist');

const { error, info, debug } = require('./log');
const Apps = require('./apps'),
      DB = require('./dbs'),
      bootstrap = require('./bootstrap'),
      fatality = require('./fatality'),
      help = require('./help'),
      lockfile = require('./lockfile');

const LEGACY_0_8_UPGRADE_DOC = '_design/medic:staged';
const HORTI_UPGRADE_DOC = 'horti-upgrade';

const install = require('./install');

const MODES = {
  development: {
    name: 'development',
    deployments: './temp/deployments',
    start: [ 'bin/svc-start', './temp/deployments', '{{app}}' ],
    stop: [ 'bin/svc-stop', '{{app}}' ],
    startAppsOnStartup: true,
  },
  local: {
    name: 'local',
    deployments: `${os.homedir()}/.horticulturalist/deployments`,
    start: [ 'horti-svc-start', `${os.homedir()}/.horticulturalist/deployments`, '{{app}}' ],
    stop: [ 'horti-svc-stop', '{{app}}' ],
    startAppsOnStartup: true,
  },
  medic_os: {
    name: 'Medic OS',
    deployments: '/srv/software',
    start: ['sudo', '-n', '/boot/svc-start', '{{app}}' ],
    stop: ['sudo', '-n', '/boot/svc-stop', '{{app}}' ],
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

const apps = Apps(mode.start, mode.stop);

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

const daemonMode = !argv['only-bootstrap'];

if(lockfile.exists()) {
  throw new Error(`Lock file already exists at ${lockfile.path()}.  Cannot start horticulturalising.`);
}

fs.mkdirs(mode.deployments);

info(`Starting Horticulturalist ${require('../package.json').version} ${daemonMode ? 'daemon ' : ''}in ${mode.name} mode`);
Promise.resolve()
  .then(() => {
    if (bootstrapVersion) {
      info(`Bootstrapping ${bootstrapVersion}`);
      return bootstrap.bootstrap(bootstrapVersion);
    } else {
      return DB.app.get(HORTI_UPGRADE_DOC).catch(() => null);
    }
  })
  .then(deployDoc => {
    if (daemonMode) {
      info('Initiating horticulturalist daemon');

      let boot;
      if (deployDoc) {
        boot = install.install(deployDoc, mode, apps, true);
      } else {
        boot = apps.start();
      }

      return boot
        .then(() => {
          info(`Starting change feed listener…`);
          DB.app
            .changes({
              live: true,
              since: 'now',
              doc_ids: [ HORTI_UPGRADE_DOC, LEGACY_0_8_UPGRADE_DOC],
              include_docs: true,
              attachments: true,
              timeout: false,
            })
            .on('change', change => {
              if (!change.deleted) {
                if (change.doc._id === HORTI_UPGRADE_DOC) {
                  info(`Change in ${HORTI_UPGRADE_DOC} detected`);
                  return install.install(change.doc, mode, apps, false).catch(fatality);
                }

                if (change.doc._id === LEGACY_0_8_UPGRADE_DOC) {
                  info('Legacy <=0.8 upgrade detected, converting…');

                  const legacyDeployInfo = change.doc.deploy_info;

                  return DB.app.remove(change.doc)
                    .then(() => DB.app.put({
                      _id: HORTI_UPGRADE_DOC,
                      user: legacyDeployInfo.user,
                      created: legacyDeployInfo.timestamp,
                      build_info: {
                        namespace: 'medic',
                        application: 'medic',
                        version: legacyDeployInfo.version
                      }
                    }));
                }
              }
            })
            .on('error', fatality);
        });
    }
  })
  .catch(fatality);
