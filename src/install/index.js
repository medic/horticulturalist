const { info, debug, stage: stageLog } = require('../log'),
      DB = require('../dbs');

const utils = require('../utils');

const stager = deployDoc => (key, message) => {
  stageLog(message);
  return utils.appendDeployLog(deployDoc, {key: key, message: message});
};

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

      return utils.update(deployable)
        .then(() => {
          debug(`Staged as ${deployable._id}`);
          return deployable;
        });
    });
};

//
// TODO: work out how this should really work
//
// DB.app.bulkDocs calls can time out. The {ajax: {timeout: blah}} setting when
// creating a PouchDB reference does not appear to affect this.
//
// It's not clear if getting a ESOCKETTIMEOUT will *always* result in eventual
// successful writes, or just sometimes. In local testing it has been always,
// but that's not definite.
//
// If it's always, we could re-write this as a promise loop that blocks by
// checking allDocs every few seconds to see if all staged ddocs are present in
// the DB before continuing.
//
// If it's sometimes, this code is mostly correct. However, only because at this
// stage we know that preDeployCleanup has been called, and so any staged ddocs
// present in the system should be from this deploy. If we wish to be more sure
// we might need to make sure the ones in CouchDB are the ones in memory, by
// checking hashes or just forcing a write from us.
//
const writeDdocsInSeries = compiledDocs => {
  return compiledDocs.reduce((promise, ddoc) => promise
    .then(() => debug(`Updating ${ddoc._id}`))
    .then(() => DB.app.get(ddoc._id))
    .catch(err => {
      if (err.status !== 404) {
        throw err;
      }
     })
    .then(existingDdoc => {
      if (!existingDdoc) {
        debug(`${ddoc._id} doesn't exist (yet), writing`);
        delete ddoc._rev;

        return DB.app.put(ddoc).catch(err => {
          // Already exists, the bulkDocs must have written it in the time
          // between our get and our put
          if (err.status !== 409) {
            throw err;
          }
        });
      }
    }),
    Promise.resolve());
};

const extractDdocs = ddoc => {
  const compiledDocs =
    JSON.parse(ddoc._attachments['ddocs/compiled.json'].data).docs;

  compiledDocs.forEach(utils.stageDdoc);

  // Also stage the main doc!
  compiledDocs.push(ddoc);

  debug(`Storing staged: ${JSON.stringify(compiledDocs.map(d => d._id))}`);

  return utils.strictBulkDocs(compiledDocs)
    .catch(err => {
      if (err.code === 'EPIPE') {
        err.horticulturalist = `Failed to store staged ddocs, you may need to increase CouchDB's max_http_request_size`;
      }

      if (err.code === 'ESOCKETTIMEDOUT') {
        // Too many ddocs? Let's try them one by one

        debug('Bulk storing timed out, attempting to write each ddoc one by one');
        return writeDdocsInSeries(compiledDocs);
      }

      throw err;
    });
};

const warmViews = (deployDoc) => {
  const writeProgress = () => {
    return DB.activeTasks()
      .then(tasks => {
        // TODO: make the write-over better here:
        // Order these sensibly so the UI doesn't have to
        // If it's new add it
        // If it was already there update it
        // If it's gone make its progress 100%
        const relevantTasks = tasks.filter(task =>
          task.type === 'indexer' && task.design_document.includes(':staged:'));

        const entry = deployDoc.log[deployDoc.log.length - 1];

        entry.indexers = relevantTasks;

        return utils.update(deployDoc);
      })
      .then(() => process.stdout.write('.'));
  };

  const probeViews = viewlist => {
    return Promise.all(
      viewlist.map(view => DB.app.query(view, {limit: 1})).concat(writeProgress())
    )
      .then(() => {
        info('Warming views complete');
      })
      .catch(err => {
        if (err.code !== 'ESOCKETTIMEDOUT') {
          throw err;
        }

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

      deployDoc.log.push({
        type: 'warm_log'
      });

      return utils.update(deployDoc)
        .then(() => probeViews(queries));
    });
};

const clearStagedDdocs = () => {
  debug('Clear existing staged DBs');
  return utils.getStagedDdocs().then(docs => {
    if (docs.length) {
      docs.forEach(d => d._deleted = true);

      debug(`Deleting staged ddocs: ${JSON.stringify(docs.map(d => d._id))}`);
      return utils.strictBulkDocs(docs);
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

const performDeploy = (apps, mode, deployDoc, ddoc, firstRun) => {
  const deploy = require('./deploySteps')(apps, mode, deployDoc);
  return deploy.run(ddoc, firstRun);
};

const predeploySteps = (deployDoc) => {
  const stage = stager(deployDoc);

  let ddoc;

  return stage('horti.stage.init', `Horticulturalist deployment of '${keyFromDeployDoc(deployDoc)}' initialising`)
    .then(() => stage('horti.stage.preCleanup', 'Pre-deploy cleanup'))
    .then(() => preCleanup())
    .then(() => stage('horti.stage.download', 'Downloading and staging install'))
    .then(() => downloadBuild(deployDoc))
    .then(stagedDdoc => ddoc = stagedDdoc)
    .then(() => stage('horti.stage.extractingDdocs', 'Extracting ddocs'))
    .then(() => extractDdocs(ddoc))
    .then(() => stage('horti.stage.warmingViews', 'Warming views'))
    .then(() => warmViews(deployDoc))
    .then(() => stage('horti.stage.readyToDeploy', 'View warming complete, ready to deploy'))
    .then(() => ddoc);
};

const deploySteps = (apps, mode, deployDoc, firstRun, ddoc) => {
  const getApplicationDdoc = () => {
    // If we got here through the 'install' action type we'll already have this
    // loaded into memory. Otherwise (ie a 'stage' then 'complete') we need to
    // load it again.
    if (ddoc) {
      return ddoc;
    } else {
      debug('Loading application ddoc');
      const ddocId = utils.getStagedDdocId(`_design/${deployDoc.build_info.application}`);
      return DB.app.get(ddocId, {
        attachments: true,
        binary: true
      });
    }
  };

  const stage = stager(deployDoc);
  return stage('horti.stage.initDeploy', 'Initiating deployment')
    .then(getApplicationDdoc)
    .then(ddoc => {
      return stage('horti.stage.deploying', 'Deploying new installation')
        .then(() => performDeploy(apps, mode, deployDoc, ddoc, firstRun))
        .then(() => stage('horti.stage.postCleanup', 'Post-deploy cleanup, installation complete'))
        .then(() => postCleanup(deployDoc));
    });
};



module.exports = {
  // TODO: when all is said and done
  //       do we still need apps, and first run?
  //       (cause you can intuit them?)
  //  (
  //    you know what apps exist because they are in the application ddoc list
  //    you know if its first run because the apps are either running or they're not
  //  )
  install: (deployDoc, mode, apps, firstRun) => {
    info(`Deploying new build: ${keyFromDeployDoc(deployDoc)}`);

    return predeploySteps(deployDoc)
      .then((ddoc) => deploySteps(apps, mode, deployDoc, firstRun, ddoc));
  },
  stage: (deployDoc) => {
    info(`Staging new build: ${keyFromDeployDoc(deployDoc)}`);

    return predeploySteps(deployDoc)
      .then(() => {
        deployDoc.staging_complete = true;

        return utils.update(deployDoc);
      });
  },
  complete: (deployDoc, mode, apps, firstRun) => {
    info(`Deploying staged build: ${keyFromDeployDoc(deployDoc)}`);

    return deploySteps(apps, mode, deployDoc, firstRun);
  },
  _preCleanup: preCleanup,
  _downloadBuild: downloadBuild,
  _extractDdocs: extractDdocs,
  _warmViews: warmViews,
  _deploySteps: deploySteps,
  _postCleanup: postCleanup
};
