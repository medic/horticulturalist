const { info, debug } = require('../log'),
      DB = require('../dbs');

const STAGED_DDOC_ID = '_design/medic:staging';

const keyFromDeployDoc = deployDoc => [
  deployDoc.build_info.namespace,
  deployDoc.build_info.application,
  deployDoc.build_info.version
].join(':');

// TODO: const stage = (num, message) => Promise.resolve();
// or (num, message, fn, ...args) => Promise.resolve();
// or (message, fn, ...args) => Promise.resolve(); (auto-num)

const downloadBuild = deployDoc => {
  info('Stage: downloading and staging install');
  debug(`Downloading stage, getting ${keyFromDeployDoc(deployDoc)}`);
  return DB.builds.get(keyFromDeployDoc(deployDoc), { attachments: true })
    .then(deployable => {
      debug(`Got ${deployable._id}, staging`);

      // TODO: move to this so that multiple ddocs make sense and are clear
      // deployable._id = `_design/${deployDoc.build_info.version}:${deployDoc.build_info.application}:staging`;
      deployable._id = STAGED_DDOC_ID;
      deployable.deploy_info = {
        timestamp: new Date().toString(),
        user: deployDoc.creator,
        version: deployDoc.build_info.version,
      };
      delete deployable._rev;

      return DB.app.put(deployable)
        .then(result => {
          debug(`Staged as ${deployable._id}`);
          deployable._rev = result.rev;

          return deployable;
        });
    });
};

const legacySteps = (apps, mode, ddoc, firstRun) => {
  const legacy = require('./legacy')(DB.app, apps, mode);
  return legacy(ddoc, firstRun);
};

const preCleanup = () => {
  info('Stage: pre-deploy cleanup');
  return DB.app.get(STAGED_DDOC_ID)
    .then(existingStagedDdoc => {
      debug('Deleting existing staged ddoc');
      return DB.app.remove(existingStagedDdoc);
    })
    .catch(err => {
      if (err.status !== 404) {
        throw err;
      }
      debug('No existing staged ddoc');
    });
};


const postCleanup = (deployDoc) => {
  info('Stage: post-deploy cleanup');
  deployDoc._deleted = true;

  return DB.app.put(deployDoc);
};

module.exports = {
  // TODO: when all is said and done
  //       do we still need apps, and first run?
  //       (cause you can intuit them?)
  install: (deployDoc, mode, apps, firstRun) => {
    info(`Deploying new build: ${keyFromDeployDoc(deployDoc)}`);
    const m = module.exports;
    return m._preCleanup()
      .then(() => m._downloadBuild(deployDoc))
      .then((ddoc) => m._legacySteps(apps, mode, ddoc, firstRun))
      .then(() => m._postCleanup(deployDoc));
  },
  _preCleanup: preCleanup,
  _downloadBuild: downloadBuild,
  _legacySteps: legacySteps,
  _postCleanup: postCleanup
};
