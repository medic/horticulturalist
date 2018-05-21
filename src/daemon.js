const { info } = require('./log');

const LEGACY_0_8_UPGRADE_DOC = '_design/medic:staged';
const HORTI_UPGRADE_DOC = 'horti-upgrade';

const ACTIONS = {
  // A complete installation from start to finish. End result is a deleted
  // HORTI_UPGRADE_DOC and the system running on the new version.
  INSTALL: 'install',
  // A partial installation that aims to complete as much work as possible
  // without actually deploying to the new version. End result is the
  // HORTI_UPGRADE_DOC being marked as `staging_complete`, ready to be
  // COMPLETEd.
  STAGE: 'stage',
  // Completes a STAGEd installation. The expectation is that an installation
  // has already been STAGEd and is ready to be deployed. This expectation is
  // maintined in the api that writes the HORTI_UPGRADE_DOC.
  COMPLETE: 'complete'
};

const appUtils = require('./apps'),
      DB = require('./dbs'),
      install = require('./install'),
      fatality = require('./fatality');

const newDeployment = deployDoc =>
  !!deployDoc &&
  deployDoc._id === HORTI_UPGRADE_DOC &&
  (deployDoc.action !== ACTIONS.STAGE || !deployDoc.staging_complete);

const performDeployment = (deployDoc, mode, apps, firstRun=false) => {
  let deployAction;

  if (!deployDoc.action || deployDoc.action === ACTIONS.INSTALL) {
    deployAction = install.install(deployDoc, mode, apps, firstRun);
  } else if (deployDoc.action === ACTIONS.STAGE) {
    deployAction = install.stage(deployDoc);
  } else if (deployDoc.action === ACTIONS.COMPLETE) {
    deployAction = install.complete(deployDoc, mode, apps, firstRun);
  }

  return deployAction;
};

const watchForDeployments = (mode, apps) => {
  info('Watching for deployments');

  const watch = DB.app.changes({
    live: true,
    since: 'now',
    doc_ids: [ HORTI_UPGRADE_DOC, LEGACY_0_8_UPGRADE_DOC],
    include_docs: true,
    timeout: false,
  });

  // TODO: consider a more robust solution?
  // If we lose connection and then reconnect we may miss an upgrade doc.
  // Restarting Horti isn't the worst thing in this case
  // Though it does mean that api and sentinel go down, which is bad
  watch.on('error', fatality);

  watch.on('change', change => {
    const deployDoc = change.doc;

    if (module.exports._newDeployment(deployDoc)) {
      info(`Change in ${HORTI_UPGRADE_DOC} detected`);
      watch.cancel();
      return module.exports._performDeployment(deployDoc, mode, apps)
        .then(() => module.exports._watchForDeployments(mode, apps))
        .catch(fatality);
    }

    if (deployDoc._id === LEGACY_0_8_UPGRADE_DOC) {
      info('Legacy <=0.8 upgrade detected, converting…');

      const legacyDeployInfo = deployDoc.deploy_info;

      // We will see this write and go through the HORTI_UPGRADE_DOC if block
      return DB.app.remove(deployDoc)
        .then(() => DB.app.put({
          _id: HORTI_UPGRADE_DOC,
          user: legacyDeployInfo.user,
          created: legacyDeployInfo.timestamp,
          build_info: {
            namespace: 'medic',
            application: 'medic',
            version: legacyDeployInfo.version
          },
          action: 'install'
        }));
    }
  });
};

module.exports = {
  init: (deployDoc, mode) => {
    info('Initiating horticulturalist daemon');

    const apps = appUtils(mode.start, mode.stop);

    let bootActions = Promise.resolve();

    if (mode.startAppsOnStartup) {
      bootActions = bootActions.then(() => apps.start());
    }

    if (module.exports._newDeployment(deployDoc)) {
      bootActions = bootActions.then(() => module.exports._performDeployment(deployDoc, mode, apps, true));
    }

    return bootActions.then(() => module.exports._watchForDeployments(mode, apps));
  },
  _newDeployment: newDeployment,
  _performDeployment: performDeployment,
  _watchForDeployments: watchForDeployments
};
