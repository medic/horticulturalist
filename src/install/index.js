const { info, debug, stage: stageLog } = require('../log'),
      DB = require('../dbs'),
      fs = require('fs-extra'),
      utils = require('../utils'),
      ddocWrapper = require('./ddocWrapper');

const ACTIVE_TASK_QUERY_INTERVAL = 10 * 1000; // 10 seconds

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

const extractDdocs = ddoc => {
  if (!ddoc._attachments || !ddoc._attachments['ddocs/compiled.json']) {
    debug('No extra ddocs to extract');
    return;
  }

  const compiledDocs =
    JSON.parse(ddoc._attachments['ddocs/compiled.json'].data).docs;

  compiledDocs.forEach(utils.stageDdoc);

  // Also stage the main doc!
  compiledDocs.push(ddoc);

  debug(`Storing staged: ${JSON.stringify(compiledDocs.map(d => d._id))}`);

  return utils.betterBulkDocs(compiledDocs);
};

const warmViews = (deployDoc) => {
  let viewsWarmed = false;

  const writeProgress = () => {
    return DB.activeTasks()
      .then(tasks => {
        const relevantTasks = tasks.filter(task =>
          task.type === 'indexer' && task.design_document.includes(':staged:'));

        return updateIndexers(relevantTasks);
      })
      .then(() => logIndexersProgress());
  };

  // logs indexer progress in the console
  // _design/doc  [||||||||||29%||||||||||_________________________________________________________]
  const logIndexersProgress = () => {
    const logProgress = indexer => {
      // progress bar stretches to match console width.
      // 60 is roughly the nbr of chars displayed around the bar (ddoc name + debug padding)
      const barLength = process.stdout.columns - 60,
            progress = `${indexer.progress}%`,
            filledBarLength = (indexer.progress / 100 * barLength),
            bar = progress
              .padStart((filledBarLength + progress.length) / 2, '|')
              .padEnd(filledBarLength, '|')
              .padEnd(barLength, '_'),
            ddocName = indexer.design_document.padEnd(35, ' ');

      debug(`${ddocName}[${bar}]`);
    };

    const indexers = deployDoc.log[deployDoc.log.length - 1].indexers;
    if (!indexers || !indexers.length) {
      return;
    }

    debug('View indexer progress');
    indexers.forEach(logProgress);
  };

  // Groups tasks by `design_document` and calculates the average progress per ddoc
  // When a task is finished, it disappears from _active_tasks
  const updateIndexers = (runningTasks) => {
    const entry = deployDoc.log[deployDoc.log.length - 1],
          indexers = entry.indexers || [];

    // We assume all previous tasks have finished.
    indexers.forEach(setTasksToComplete);
    // If a task is new or still running, it's progress is updated
    updateRunningTasks(indexers, runningTasks);
    indexers.forEach(calculateAverageProgress);

    entry.indexers = indexers;
    return utils.update(deployDoc);
  };

  const setTasksToComplete = (indexer) => {
    Object
      .keys(indexer.tasks)
      .forEach(pid => {
        indexer.tasks[pid] = 100;
      });
  };

  const calculateAverageProgress = (indexer) => {
    const tasks = Object.keys(indexer.tasks);
    indexer.progress = Math.round(tasks.reduce((progress, pid) => progress + indexer.tasks[pid], 0) / tasks.length);
  };

  const updateRunningTasks = (indexers, activeTasks = []) => {
    activeTasks.forEach(task => {
      let indexer = indexers.find(indexer => indexer.design_document === task.design_document);
      if (!indexer) {
        indexer = {
          design_document: task.design_document,
          tasks: {},
        };
        indexers.push(indexer);
      }
      indexer.tasks[`${task.node}-${task.pid}`] = task.progress;
    });
  };

  // Query _active_tasks every 10 seconds until `viewsWarmed` is true
  const writeProgressTimeout = () => {
    setTimeout(() => {
      if (viewsWarmed) {
        return;
      }
      writeProgress().then(writeProgressTimeout);
    }, ACTIVE_TASK_QUERY_INTERVAL);
  };

  const probeViews = viewlist => {
    return Promise
      .all(viewlist.map(view => DB.app.query(view, { limit: 1 })))
      .then(() => {
        viewsWarmed = true;
        info('Warming views complete');
        return updateIndexers();
      })
      .catch(err => {
        if (err.error !== 'timeout') {
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
        .then(() => {
          writeProgressTimeout();
          return probeViews(queries);
        });
    });
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
  return Promise.all(ddoc.getChangedApps().map(app => {
    const oldPath = app.deployPath('old');

    if(fs.existsSync(oldPath)) {
      const linkString = fs.readlinkSync(oldPath);

      if(fs.existsSync(linkString)) {
        debug(`Deleting old ${app.name} from ${linkString}…`);
        fs.removeSync(linkString);
      } else debug(`Old app not found at ${linkString}.`);

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

const postCleanup = (ddocWrapper, deployDoc) => {
  return Promise.all([
        removeOldVersion(ddocWrapper),
        clearStagedDdocs()
      ])
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

const performDeploy = (mode, deployDoc, ddoc, firstRun) => {
  const deploy = require('./deploySteps')(mode, deployDoc);
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

const deploySteps = (mode, deployDoc, firstRun, ddoc) => {
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
        .then(() => performDeploy(mode, deployDoc, ddoc, firstRun))
        .then(() => stage('horti.stage.postCleanup', 'Post-deploy cleanup, installation complete'))
        .then(() => postCleanup(ddocWrapper(ddoc, mode), deployDoc));
    });
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
  _warmViews: warmViews,
  _deploySteps: deploySteps,
  _postCleanup: postCleanup
};
