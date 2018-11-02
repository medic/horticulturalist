const { info } = require('./log'),
      apps = require('./apps');

const {
  LEGACY_0_8_UPGRADE_DOC,
  HORTI_UPGRADE_DOC,
  ACTIONS
} = require('./constants');

const startTime = new Date().getTime();

const DB = require('./dbs'),
      install = require('./install'),
      fatality = require('./fatality');

const newDeployment = deployDoc =>
      !!deployDoc &&
      (deployDoc.action !== ACTIONS.STAGE || !deployDoc.staging_complete);

const performDeployment = (doc, mode, firstRun=false) => {
  let deployAction;

  const getWritableDeployDoc = doc => ({
    _id: `_local/upgrade-${startTime}`,
    build_info: Object.assign({}, doc.build_info),
    schema_version: doc.schema_version,
  });

  const deployDoc = mode.writeLocalDeployLog ? getWritableDeployDoc(doc) : doc;
  if (!deployDoc.action || deployDoc.action === ACTIONS.INSTALL) {
    deployAction = install.install(deployDoc, mode, firstRun);
  } else if (deployDoc.action === ACTIONS.STAGE) {
    deployAction = install.stage(deployDoc);
  } else if (deployDoc.action === ACTIONS.COMPLETE) {
    deployAction = install.complete(deployDoc, mode, firstRun);
  }

  return deployAction;
};

const watchForDeployments = (mode) => {
  info('Watching for deployments');

  const watch = DB.app.changes({
    live: true,
    since: 'now',
    doc_ids: mode.upgradeDocuments,
    include_docs: true,
    timeout: false,
  });

  // TODO: consider a more robust solution?
  // If we lose connection and then reconnect we may miss an upgrade doc.
  // Restarting Horti isn't the worst thing in this case
  // Though it does mean that api and sentinel go down, which is bad
  watch.on('error', fatality);

  watch.on('change', change => {
    const changedDoc = change.doc;

    if (changedDoc._deleted) {
      return;
    }

    const deployDoc = mode.getWritableDeployDoc(changedDoc);
    if (module.exports._newDeployment(changedDoc)) {
      info(`Change in ${changedDoc._id} detected`);
      watch.cancel();

      // Old builds had no schema_version. New builds should be blocked from
      // accidentally having no schema version by the builds server's
      // validate_doc_update function

      if (!deployDoc.schema_version || deployDoc.schema_version === 1) {
        return module.exports._performDeployment(deployDoc, mode)
          .then(() => module.exports._watchForDeployments(mode))
          .catch(fatality);
      } else {
        return fatality(new Error('Cannot handle deploy doc schema_version ' + deployDoc.schema_version));
      }
    }

    if (deployDoc._id === LEGACY_0_8_UPGRADE_DOC) {
      info('Legacy <=0.8 upgrade detected, converting…');

      const legacyDeployInfo = deployDoc.deploy_info;

      // We will see this write and go through the HORTI_UPGRADE_DOC if block
      return DB.app.remove(deployDoc)
        .then(() => DB.app.put({
          _id: HORTI_UPGRADE_DOC,
          schema_version: 1,
          user: legacyDeployInfo.user,
          created: legacyDeployInfo.timestamp,
          build_info: {
            namespace: 'medic',
            application: 'medic',
            version: legacyDeployInfo.version
          },
          action: 'install'
        }))
        .then(() => info('Legacy doc converted successfully'))
        .catch(fatality);
    }
  });
};

module.exports = {
  init: (deployDoc, mode) => {
    let bootActions = Promise.resolve();

    if (mode.manageAppLifecycle && mode.daemon) {
      bootActions = bootActions.then(() => apps.start(mode.start, mode.appsToDeploy));
    }

    if (module.exports._newDeployment(deployDoc)) {
      bootActions = bootActions.then(() => module.exports._performDeployment(deployDoc, mode, true));
    }

    if (mode.daemon) {
      bootActions = bootActions.then(() => module.exports._watchForDeployments(mode));
    }

    return bootActions;
  },
  _newDeployment: newDeployment,
  _performDeployment: performDeployment,
  _watchForDeployments: watchForDeployments
};
