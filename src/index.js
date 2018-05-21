#!/usr/bin/env node
const fs = require('fs-extra'),
      os = require('os'),
      parseArgs = require('minimist');

const { error, info } = require('./log');
const DB = require('./dbs'),
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
    // This starting will be managed by the medicos supervisor. In this
    // deployment mode we only control the restarting of apps
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
      return daemon.init(deployDoc, mode);
    }
  })
  .catch(fatality);
