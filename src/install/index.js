const { info, debug, stage: stageLog } = require('../log'),
      DB = require('../dbs');

const utils = require('./utils');

const stager = deployDoc => message => Promise.all([
  stageLog(message),
  utils.appendDeployLog(deployDoc, message)
]);

const keyFromDeployDoc = deployDoc => [
  deployDoc.build_info.namespace,
  deployDoc.build_info.application,
  deployDoc.build_info.version
].join(':');

const downloadBuild = deployDoc => {
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
  const compiledDocs =
    JSON.parse(ddoc._attachments['ddocs/compiled.json'].data).docs;

  compiledDocs.forEach(utils.stageDdoc);

  // Also stage the main doc!
  compiledDocs.push(ddoc);

  debug(`Storing staged: ${JSON.stringify(compiledDocs.map(d => d._id))}`);

  return DB.app.bulkDocs(compiledDocs)
    .catch(err => {
      if (err.code === 'EPIPE') {
        err.horticulturalist = `Failed to store staged ddocs, you may need to increase CouchDB's max_http_request_size`;
      }

      throw err;
    });
};

const warmViews = () => {
  const probeViews = viewlist => {
    return Promise.all(viewlist.map(view => DB.app.query(view, {limit: 1})))
      .then(() => {
        info('Warming views complete');
      })
      .catch(err => {
        if (err.code !== 'ESOCKETTIMEDOUT') {
          throw err;
        }

        process.stdout.write('.');
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

      info('Beginning view warming');
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
  return clearStagedDdocs()
    .then(() => {
      // Free as much space as possible, warming views is expensive as it
      // doubles the amount of space used by views
      debug('Starting compact and view cleanup');
      return Promise.all([DB.app.compact(), DB.app.viewCleanup()]);
    });
};

const postCleanup = (deployDoc) => {
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
  const deploy = require('./deploySteps')(apps, mode, deployDoc);
  return deploy.run(ddoc, firstRun);
};

module.exports = {
  // TODO: when all is said and done
  //       do we still need apps, and first run?
  //       (cause you can intuit them?)
  install: (deployDoc, mode, apps, firstRun) => {
    info(`Deploying new build: ${keyFromDeployDoc(deployDoc)}`);

    const stage = stager(deployDoc);

    const m = module.exports;
    return stage('Pre-deploy cleanup')
      .then(() => m._preCleanup())
      .then(() => stage('Downloading and staging install'))
      .then(() => m._downloadBuild(deployDoc))
      .then(ddoc => {
        return stage('Extracting ddocs')
          .then(() => m._extractDdocs(ddoc))
          .then(() => stage('Warming views'))
          .then(() => m._warmViews())
          .then(() => stage('Deploying new installation'))
          .then(() => m._deploySteps(apps, mode, deployDoc, ddoc, firstRun));
      })
      .then(() => stage('Post-deploy cleanup'))
      .then(() => m._postCleanup(deployDoc));
  },
  _preCleanup: preCleanup,
  _downloadBuild: downloadBuild,
  _extractDdocs: extractDdocs,
  _warmViews: warmViews,
  _deploySteps: deploySteps,
  _postCleanup: postCleanup
};
