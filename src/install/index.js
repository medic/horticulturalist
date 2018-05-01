const { info, debug, stage } = require('../log'),
      DB = require('../dbs');

const utils = require('./utils');

// TODO: const stage = (num, message) => Promise.resolve();
// or (num, message, fn, ...args) => Promise.resolve();
// or (message, fn, ...args) => Promise.resolve(); (auto-num)

const keyFromDeployDoc = deployDoc => [
  deployDoc.build_info.namespace,
  deployDoc.build_info.application,
  deployDoc.build_info.version
].join(':');

const downloadBuild = deployDoc => {
  stage('Downloading and staging install');
  debug(`Downloading ${keyFromDeployDoc(deployDoc)}, this may take some time…`);
  return DB.builds.get(keyFromDeployDoc(deployDoc), { attachments: true, binary: true })
    .then(deployable => {
      debug(`Got ${deployable._id}, staging`);

      deployable._id = `_design/${deployDoc.build_info.application}`;
      utils.stageDdoc(deployable);
      deployable.deploy_info = {
        timestamp: new Date(),
        user: deployDoc.user,
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

const extractDdocs = ddoc => {
  stage('Extracting ddocs');
  const compiledDocs =
    JSON.parse(ddoc._attachments['ddocs/compiled.json'].data).docs;

  compiledDocs.forEach(utils.stageDdoc);

  // Also stage the main doc!
  compiledDocs.push(ddoc);

  debug(`Storing staged: ${JSON.stringify(compiledDocs.map(d => d._id))}`);

  return DB.app.bulkDocs(compiledDocs);
};

const warmViews = () => {
  stage('Warming views');

  const probeViews = viewlist => {
    debug(`Querying the following views ${JSON.stringify(viewlist)}`);

    return Promise.all(viewlist.map(view => DB.app.query(view, {limit: 1})))
      .then(() => {
        info('Warming views complete');
      })
      .catch(err => {
        debug(`Warming views failed, (${err.message}), trying again...`);
        return probeViews(viewlist);
      });
  };

  const firstView = ddoc =>
    `${ddoc._id.replace('_design/', '')}/${Object.keys(ddoc.views).find(k => k !== 'lib')}`;

  return utils.getStagedDdocs(true)
    .then(ddocs => {
      debug(`Got ${ddocs.length} staged ddocs`);
      const queries = ddocs
        .filter(ddoc => ddoc.views && Object.keys(ddoc.views).length)
        .map(firstView);

      return probeViews(queries);
    });
};

const clearStagedDdocs = () => {
  debug('Clear existing staged DBs');
  return utils.getStagedDdocs().then(docs => {
    if (docs.length) {
      docs.forEach(d => d._deleted = true);

      debug(`Deleting staged ddocs: ${JSON.stringify(docs.map(d => d._id))}`);
      return DB.app.bulkDocs(docs);
    }
  });
};

const preCleanup = () => {
  stage('Pre-deploy cleanup');
  return clearStagedDdocs();
};

const postCleanup = (deployDoc) => {
  stage('Post-deploy cleanup');

  return clearStagedDdocs()
    .then(() => {
      debug('Delete deploy ddoc');
      deployDoc._deleted = true;
      return DB.app.put(deployDoc);
    })
    .then(() => {
      debug('Cleanup old views');
      return DB.app.viewCleanup();
    });
};

const deploySteps = (apps, mode, deployDoc, ddoc, firstRun) => {
  stage('Deploy');

  const deploy = require('./deploySteps')(apps, mode, deployDoc);
  return deploy.run(ddoc, firstRun);
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
      .then(ddoc => {
        return m._extractDdocs(ddoc)
          .then(() => m._warmViews())
          .then(() => m.deploySteps(apps, mode, deployDoc, ddoc, firstRun));
      })
      .then(() => m._postCleanup(deployDoc));
  },
  _preCleanup: preCleanup,
  _downloadBuild: downloadBuild,
  _extractDdocs: extractDdocs,
  _warmViews: warmViews,
  deploySteps: deploySteps,
  _postCleanup: postCleanup
};
