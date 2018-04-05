const DB = require('./dbs');

const HORTI_UPGRADE_DOC = 'horti-upgrade';

const buildInfo = (version) => {
  if (version.startsWith('@')) {
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
  return buildInfo(version)
    .then(buildInfo => {
      return DB.app.put({
          _id: HORTI_UPGRADE_DOC,
          initiator: 'horticulturalist',
          created: new Date().getTime(),
          build_info: buildInfo
      });
    });
};
