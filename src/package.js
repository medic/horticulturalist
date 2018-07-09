/*
 * Where all of our parsing understanding for package identifiers in Horticulturalist
 * should live.
 */

const DB = require('./dbs');

// @foo:bar:release, or foo:bar:1.0.0
const fullyQualifiedName = /(@?)([^:]+):([^:]+):(.+)/;
// Without the ns and app, so 1.0.0 or @release
const legacyMedic = /(@?)(.+)/;

module.exports = {
  parse: packageDescriptor => {
    const fqn = packageDescriptor.match(fullyQualifiedName);
    if (fqn) {
      return {
        namespace: fqn[2],
        application: fqn[3],
        version: fqn[4],
        isChannel: fqn[1] === '@'
      };
    } else {
      const legacy = packageDescriptor.match(legacyMedic);

      return {
        namespace: 'medic',
        application: 'medic',
        version: legacy[2],
        isChannel: legacy[1] === '@'
      };
    }
  },
  resolve: package => {
    if (!package.isChannel) {
      return Promise.resolve(package);
    }

    return DB.builds.query('builds/releases', {
      startkey: [package.version, package.namespace, package.application, {}],
      endkey: [package.version, package.namespace, package.application],
      descending: true,
      limit: 1
    }).then(results => {
      if (results.rows.length === 0) {
        throw new Error(`There are currently no builds for the '${module.exports.display(package)}' channel`);
      } else {
        return  module.exports.parse(results.rows[0].id);
      }
    });
  },
  display: package => `${package.isChannel ? '@' : ''}${package.namespace}:${package.application}:${package.version}`,
  valid: package => package.namespace && package.application && package.version
};
