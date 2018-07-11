#!/usr/bin/env node
const fs = require('fs-extra'),
      os = require('os'),
      parseArgs = require('minimist'),
      onExit = require('signal-exit');

const { error, info } = require('./log');

const { ACTIONS } = require('./constants');

const daemon = require('./daemon'),
      bootstrap = require('./bootstrap'),
      fatality = require('./fatality'),
      help = require('./help'),
      lockfile = require('./lockfile'),
      apps = require('./apps'),
      packageUtils = require('./package');

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

const active = (...things) => things.filter(t => !!t);

const argv = parseArgs(process.argv, {
  default: {
    daemon: true
  }
});

if (active(argv.dev, argv.local, argv['medic-os']).length !== 1) {
  help.outputHelp();
  error('You must pick one mode to run in.');
  process.exit(-1);
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

if (active(argv.install, argv.stage, argv['complete-install']).length > 1) {
  help.outputHelp();
  error('Pick only one action to perform');
  process.exit(-1);
}

if (argv.bootstrap) {
  info('--bootstrap is DEPRECATED, use --install instead');
  argv.install = argv.bootstrap;
}

const action = argv.install             ? ACTIONS.INSTALL :
               argv.stage               ? ACTIONS.STAGE :
               argv['complete-install'] ? ACTIONS.COMPLETE :
               undefined;

let version = argv.install || argv.stage;
if (version === true) {
  version = 'medic:medic:master';
}

if (version) {
  version = packageUtils.parse(version);
}

mode.daemon = argv.daemon;

if (!action && !mode.daemon) {
  help.outputHelp();
  error('--no-daemon does not do anything without also specifiying an action');
  process.exit(-1);
}

if(lockfile.exists()) {
  throw new Error(`Lock file already exists at ${lockfile.path()}.  Cannot start horticulturalising.`);
}

process.on('uncaughtException', fatality);
process.on('unhandledRejection', (err) => {
  console.error(err);
  fatality('Unhandled rejection, please raise this as a bug!');
});

// clearing of the lockfile is handled by the lockfile library itself
onExit((code) => {
  if (mode.manageAppLifecycle && mode.daemon) {
    apps.stopSync(mode.stop);
  }

  process.exit(code || 0);
});

lockfile.wait()
  .then(() => {
    fs.mkdirs(mode.deployments);

    info(`Starting Horticulturalist ${require('../package.json').version} ${mode.daemon ? 'daemon ' : ''}in ${mode.name} mode`);

    if (action === ACTIONS.INSTALL) {
      return bootstrap.install(version);
    } else if (action === ACTIONS.STAGE) {
      return bootstrap.stage(version);
    } else if (action === ACTIONS.COMPLETE) {
      return bootstrap.complete();
    } else {
      return bootstrap.existing();
    }
  }).then(deployDoc => {
      return daemon.init(deployDoc, mode);
  })
  .catch(fatality);
