/*
 * Where all of our parsing understanding for versions in Horticulturalist
 * should live.
 */

// TODO: rename this everywhere. "Version" is really generic, and doesn't make
//       sense. package? release? build? artifact?
//
// TODO: we have a similar concept in bootstrap.buildInfo function. Consider
//       changing this to a class that knows how to process out the buildInfo
//       (ie resolve channels) in here.

// @foo:bar:release, or foo:bar:1.0.0
const fullyQualifiedName = /(@?)([^:]+):([^:]+):(.+)/;
// Without the ns and app, so 1.0.0 or @release
const legacyMedic = /(@?)(.+)/;

module.exports = {
  parse: versionString => {
    const fqn = versionString.match(fullyQualifiedName);
    if (fqn) {
      return {
        namespace: fqn[2],
        application: fqn[3],
        version: fqn[4],
        isChannel: fqn[1] === '@'
      };
    } else {
      const legacy = versionString.match(legacyMedic);

      return {
        namespace: 'medic',
        application: 'medic',
        version: legacy[2],
        isChannel: legacy[1] === '@'
      };
    }
  },
  display: version => `${version.isChannel ? '@' : ''}${version.namespace}:${version.application}:${version.version}`,
  valid: version => version.namespace && version.application && version.version
};
