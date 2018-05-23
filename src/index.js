#!/usr/bin/env node
const fs = require('fs-extra'),
      os = require('os'),
      parseArgs = require('minimist'),
      onExit = require('signal-exit');

const { error, info } = require('./log');

const appUtils = require('./apps'),
      DB = require('./dbs'),
      daemon = require('./daemon'),
      bootstrap = require('./bootstrap'),
      fatality = require('./fatality'),
      help = require('./help'),
      lockfile = require('./lockfile');

const HORTI_UPGRADE_DOC = 'horti-upgrade';

const MODES = {
  development: {
    name: 'development',
    deployments: './temp/deployments',
    start: [ 'bin/svc-start', './temp/deployments', '{{app}}' ],
    stop: [ 'bin/svc-stop', '{{app}}' ],
    manageAppLifecycle: true,
  },
  local: {
    name: 'local',
    deployments: `${os.homedir()}/.horticulturalist/deployments`,
    start: [ 'horti-svc-start', `${os.homedir()}/.horticulturalist/deployments`, '{{app}}' ],
    stop: [ 'horti-svc-stop', '{{app}}' ],
    manageAppLifecycle: true,
  },
  medic_os: {
    name: 'Medic OS',
    deployments: '/srv/software',
    start: ['sudo', '-n', '/boot/svc-start', '{{app}}' ],
    stop: ['sudo', '-n', '/boot/svc-stop', '{{app}}' ],
    // MedicOS will start and stop apps, though we will still restart them
    // when upgrading
    manageAppLifecycle: false,
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
const apps = appUtils(mode.start, mode.stop);

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

process.on('uncaughtException', fatality);

// clearing of the lockfile is handled by the lockfile library itself
onExit((code) => {
  if (mode.manageAppLifecycle) {
    apps.stopSync();
  }

  process.exit(code || 0);
});

lockfile.wait()
  .then(() => {
    fs.mkdirs(mode.deployments);

    info(`Starting Horticulturalist ${require('../package.json').version} ${daemonMode ? 'daemon ' : ''}in ${mode.name} mode`);
    if (bootstrapVersion) {
      info(`Bootstrapping ${bootstrapVersion}`);
      return bootstrap.bootstrap(bootstrapVersion);
    } else {
      return DB.app.get(HORTI_UPGRADE_DOC).catch(() => null);
    }
  }).then(deployDoc => {
    if (daemonMode) {
      return daemon.init(deployDoc, mode, apps);
    }
  })
  .catch(fatality);
