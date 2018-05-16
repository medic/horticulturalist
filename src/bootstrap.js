const DB = require('./dbs'),
      utils = require('./utils');
const { info, debug } = require('./log');

const HORTI_UPGRADE_DOC = 'horti-upgrade';

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

module.exports.bootstrap = (version) => {
  info(`Bootstrapping to ${version}`);
  return DB.app.get(HORTI_UPGRADE_DOC)
    .catch(err => {
      if (err.status !== 404) {
        throw err;
      }
    })
    .then(existingDeployDoc => {
      return buildInfo(version)
        .then(buildInfo => {
          debug('Bootstrapping upgrade doc');

          const upgradeDoc = {
              _id: HORTI_UPGRADE_DOC,
              user: 'horticulturalist bootstrap',
              created: new Date().getTime(),
              build_info: buildInfo
          };

          if (existingDeployDoc) {
            upgradeDoc._rev = existingDeployDoc._rev;
          }

          return utils.update(upgradeDoc);
        });
    });
};
