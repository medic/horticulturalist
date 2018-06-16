const path = require('path');

module.exports = (module, digest, mode) => {
  const name = module.substring(0, module.lastIndexOf('-'));

  const deployPath = (identifier) => {
    identifier = identifier || digest.replace(/\//g, '');
    return path.resolve(path.join(mode.deployments, name, identifier));
  };

  return {
    name: name,
    attachmentName: module,
    digest: digest,
    deployPath: (identifier) => deployPath(identifier)
  };
};
