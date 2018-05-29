const DB = require('./dbs'),
      utils = require('./utils');
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
  if (version.startsWith('@')) {
    debug('Version is a channel, finding out the latest version');
    version = version.substring(1);
    return DB.builds.query('builds/releases', {
      startkey: [version, 'medic', 'medic', {}],
      endkey: [version, 'medic', 'medic'],
      descending: true,
      limit: 1
    }).then(results => {
      if (results.rows.length === 0) {
        throw new Error(`There are currently no builds for the '${version}' channel`);
      } else {
        debug(`Found ${results.rows[0].id}`);
        const [namespace, application, version] = results.rows[0].id.split(':');
        return {
          namespace: namespace,
          application: application,
          version: version
        };
      }
    });
  } else {
    return Promise.resolve({
      namespace: 'medic',
      application: 'medic',
      version: version
    });
  }
};

const initDeploy = (action, version) => {
  info(`Doing ${action} to ${version}`);
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
