const DB = require('./dbs'),
      utils = require('./utils'),
      versionUtils = require('./versionUtils');
const { info, debug } = require('./log');

const {
  HORTI_UPGRADE_DOC,
  ACTIONS
} = require('./constants');

const getUpgradeDoc = () => {
  return DB.app.get(HORTI_UPGRADE_DOC)
    .catch(err => {
      if (err.status !== 404) {
        throw err;
      }
    });
};

const buildInfo = (version) => {
  if (version.isChannel) {
    debug('Version is a channel, finding out the latest version');
    return DB.builds.query('builds/releases', {
      startkey: [version.version, version.namespace, version.application, {}],
      endkey: [version.version, version.namespace, version.application],
      descending: true,
      limit: 1
    }).then(results => {
      if (results.rows.length === 0) {
        throw new Error(`There are currently no builds for the '${versionUtils.display(version)}' channel`);
      } else {
        debug(`Found ${results.rows[0].id}`);
        const version = versionUtils.parse(results.rows[0].id);
        return {
          namespace: version.namespace,
          application: version.application,
          version: version.version
        };
      }
    });
  } else {
    return Promise.resolve({
      namespace: version.namespace,
      application: version.application,
      version: version.version
    });
  }
};

const initDeploy = (action, version) => {
  if (!versionUtils.valid(version)) {
    throw Error(`Invalid version structure: ${JSON.stringify(version)}`);
  }

  info(`Doing ${action} to ${versionUtils.display(version)}`);
  return getUpgradeDoc()
    .then(existingDeployDoc => {
      return buildInfo(version)
        .then(buildInfo => {
          debug('Bootstrapping upgrade doc');

          const upgradeDoc = {
              _id: HORTI_UPGRADE_DOC,
              user: 'horticulturalist cli',
              created: new Date().getTime(),
              action: action,
              build_info: buildInfo
          };

          if (existingDeployDoc) {
            upgradeDoc._rev = existingDeployDoc._rev;
          }

          return utils.update(upgradeDoc);
        });
    });
};

const completeDeploy = () => {
  return getUpgradeDoc()
    .then(upgradeDoc => {
      if (!upgradeDoc) {
        throw Error('There is no installation to complete');
      }
      if (!upgradeDoc.staging_complete) {
        throw Error('A deploy exists but it is not ready to complete');
      }

      upgradeDoc.action = ACTIONS.COMPLETE;

      return utils.update(upgradeDoc);
    });
};

module.exports = {
  install: version => initDeploy(ACTIONS.INSTALL, version),
  stage: version => initDeploy(ACTIONS.STAGE, version),
  complete: completeDeploy,
  existing: getUpgradeDoc
};
