const { info, debug, stage: stageLog, error } = require('../log'),
      DB = require('../dbs'),
      fs = require('fs-extra'),
      utils = require('../utils'),
      ddocWrapper = require('./ddocWrapper'),
      warmViews = require('./warmViews');

const stageRunner = deployDoc => (key, message, stageFn) => {
  return utils.readyStage(deployDoc, key, message)
    .then(stageShouldRun => {
      if (stageFn && !stageShouldRun) {
        // Mark stages with executable content against them as skipped if we
        // don't think we should run them again
        stageLog(`Skipping: ${message}`);
      } else {
        stageLog(message);
        return stageFn && stageFn();
      }
    });
};

const keyFromDeployDoc = deployDoc => [
  deployDoc.build_info.namespace,
  deployDoc.build_info.application,
  deployDoc.build_info.version
].join(':');

const appId = deployDoc => `_design/${deployDoc.build_info.application}`;

const findDownloadedBuild = deployDoc => {
  debug(`Locating already downloaded ${keyFromDeployDoc(deployDoc)}`);

  const id = utils.getStagedDdocId(appId(deployDoc));

  return DB.app.get(id, {
      attachments: true,
      binary: true
  })
    .catch(err => {
      // Two reasons this might be happening (as well as "CouchDB is down etc"):
      // - We are trying to `--complete-install` without `--stage`ing first, and so there is no
      //   ddoc to pick up from. This is highly unlikely as we check for the deploy doc being in the
      //   right state before getting here.
      // - This deploy failed on or after the staged ddocs are deleted. This is highly unlikely
      //   because (as of writing) this is the very last stage-- postCleanup.
      //
      // The solution for both of these problems would be to start the installation again
      error(`Failed to find existing staged ddoc: ${err.message}`);
      throw err;
    });
};

const downloadBuild = deployDoc => {
  const docKey = keyFromDeployDoc(deployDoc);
  debug(`Downloading ${docKey}, this may take some time…`);
  return DB.builds.get(docKey, { attachments: true, binary: true })
    .catch(err => {
      if (err && err.status && err.status >= 400 && err.status < 500) {
        error(`Failed to download build for [${docKey}]. Aborting install.`);
        return deleteDeployDoc(deployDoc).reject(err);
      }
      throw err;
    })
    .then(deployable => {
      debug(`Got ${deployable._id}, staging`);

      deployable._id = appId(deployDoc);
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

const extractDdocs = ddoc => {
  const compiledDdocs = ddoc._attachments &&
                        (ddoc._attachments['ddocs/compiled.json'] ||
                         ddoc._attachments['ddocs/medic.json']);

  if (!compiledDdocs) {
    debug('No extra ddocs to extract');
    return;
  }

  const compiledDocs = JSON.parse(compiledDdocs.data).docs;

  compiledDocs.forEach(utils.stageDdoc);

  // Also stage the main doc!
  compiledDocs.push(ddoc);

  debug(`Storing staged: ${JSON.stringify(compiledDocs.map(d => d._id))}`);

  return utils.betterBulkDocs(compiledDocs);
};

const clearStagedDdocs = () => {
  debug('Clear existing staged DBs');
  return utils.getStagedDdocs().then(docs => {
    if (docs.length) {
      docs.forEach(d => d._deleted = true);

      debug(`Deleting staged ddocs: ${JSON.stringify(docs.map(d => d._id))}`);
      return utils.betterBulkDocs(docs);
    }
  });
};

const removeOldVersion = ddoc => {
  return Promise.all(ddoc.getApps().map(app => {
    const oldPath = app.deployPath('old');

    if(fs.existsSync(oldPath)) {
      const linkString = fs.readlinkSync(oldPath);

      if(fs.existsSync(linkString)) {
        debug(`Deleting old ${app.name} from ${linkString}…`);
        fs.removeSync(linkString);
      } else {
        debug(`Old app not found at ${linkString}.`);
      }

      fs.unlinkSync(oldPath);
    }
  }));
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

const deleteDeployDoc = (deployDoc) => {
  debug('Delete deploy ddoc');
  deployDoc._deleted = true;
  return DB.app.put(deployDoc);
};

const postCleanup = (ddocWrapper, deployDoc) => {
  return Promise.all([
        removeOldVersion(ddocWrapper),
        clearStagedDdocs()
      ])
      .then(() => deleteDeployDoc(deployDoc))
      .then(() => {
        debug('Cleanup old views');
        return DB.app.viewCleanup();
      });
};

const performDeploy = (mode, deployDoc, ddoc, firstRun) => {
  const deploy = require('./deploySteps')(mode, deployDoc);
  return deploy.run(ddoc, firstRun);
};

const predeploySteps = (deployDoc) => {
  const stage = stageRunner(deployDoc);

  let ddoc;

  return stage('horti.stage.init', `Horticulturalist deployment of '${keyFromDeployDoc(deployDoc)}' initialising`)
    .then(() => stage('horti.stage.preCleanup', 'Pre-deploy cleanup', preCleanup))
    .then(() => stage('horti.stage.download', 'Downloading and staging install', () => downloadBuild(deployDoc)))
    .then(stagedDdoc => {
      // If we're resuming a deployment and we skip the above stage we need to find the ddoc manually
      return stagedDdoc || findDownloadedBuild(deployDoc);
    })
    .then(stagedDdoc => ddoc = stagedDdoc)
    .then(() => stage('horti.stage.extractingDdocs', 'Extracting ddocs', () => extractDdocs(ddoc)))
    .then(() => stage('horti.stage.warmingViews', 'Warming views', () => warmViews().warm(deployDoc)))
    .then(() => stage('horti.stage.readyToDeploy', 'View warming complete, ready to deploy'))
    .then(() => ddoc);
};

const deploySteps = (mode, deployDoc, firstRun, ddoc) => {
  const getApplicationDdoc = () => {
    // If we got here through the 'install' action type we'll already have this
    // loaded into memory. Otherwise (ie a 'stage' then 'complete') we need to
    // load it again.
    if (ddoc) {
      return ddoc;
    } else {
      return findDownloadedBuild(deployDoc);
    }
  };

  const stage = stageRunner(deployDoc);
  return stage('horti.stage.initDeploy', 'Initiating deployment')
    .then(getApplicationDdoc)
    .then(stagedDdoc => ddoc = stagedDdoc)
    .then(() => stage('horti.stage.deploying', 'Deploying new installation', () => performDeploy(mode, deployDoc, ddoc, firstRun)))
    .then(() => stage('horti.stage.postCleanup', 'Post-deploy cleanup, installation complete', () => postCleanup(ddocWrapper(ddoc, mode), deployDoc)));
};



module.exports = {
  // TODO: when all is said and done do we still need first run?
  //       (cause you can intuit?)
  //  (
  //    you know if its first run because the apps are either running or they're not
  //  )
  install: (deployDoc, mode, firstRun) => {
    info(`Deploying new build: ${keyFromDeployDoc(deployDoc)}`);

    return predeploySteps(deployDoc)
      .then((ddoc) => deploySteps(mode, deployDoc, firstRun, ddoc));
  },
  stage: (deployDoc) => {
    info(`Staging new build: ${keyFromDeployDoc(deployDoc)}`);

    return predeploySteps(deployDoc)
      .then(() => {
        deployDoc.staging_complete = true;

        return utils.update(deployDoc);
      });
  },
  complete: (deployDoc, mode, firstRun) => {
    info(`Deploying staged build: ${keyFromDeployDoc(deployDoc)}`);

    return deploySteps(mode, deployDoc, firstRun);
  },
  _preCleanup: preCleanup,
  _downloadBuild: downloadBuild,
  _extractDdocs: extractDdocs,
  _deploySteps: deploySteps,
  _postCleanup: postCleanup
};
