const { debug, info } = require('../log'),
      DB = require('../dbs'),
      utils = require('../utils');

const DEFAULT_ACTIVE_TASK_QUERY_INTERVAL = 10 * 1000;

const writeProgress = (deployDoc) => {
  return DB
    .activeTasks()
    .then(tasks => {
      const relevantTasks = tasks.filter(task =>
        task.type === 'indexer' && task.design_document.includes(':staged:'));

      info('Writing progress');
      return updateIndexers(deployDoc, relevantTasks);
    })
    .catch(err => {
      // catch conflicts
      if (err.status !== 409) {
        throw err;
      }
    });
};

// logs indexer progress in the console
// _design/doc  [||||||||||29%||||||||||_________________________________________________________]
const logIndexersProgress = (indexers) => {
  if (!indexers || !indexers.length) {
    return;
  }

  const logProgress = (indexer) => {
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

  debug('View indexer progress');
  indexers.forEach(logProgress);
};

// Groups tasks by `design_document` and calculates the average progress per ddoc
// When a task is finished, it disappears from _active_tasks
const updateIndexers = (deployDoc, runningTasks) => {
  const entry = deployDoc.log[deployDoc.log.length - 1],
        indexers = entry.indexers || [];

  // We assume all previous tasks have finished.
  indexers.forEach(setTasksToComplete);
  // If a task is new or still running, it's progress is updated
  updateRunningTasks(indexers, runningTasks);
  indexers.forEach(calculateAverageProgress);

  entry.indexers = indexers;

  logIndexersProgress(indexers);
  info('updating indexers', runningTasks, deployDoc._rev);
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

// FIXME: I'm pretty sure this doesn't work with Mango indexes
// https://github.com/medic/horticulturalist/issues/39
const firstView = ddoc =>
  `${ddoc._id.replace('_design/', '')}/${Object.keys(ddoc.views).find(k => k !== 'lib')}`;

const viewQueries = ddocs => ddocs
      .filter(ddoc => ddoc.views && Object.keys(ddoc.views).length)
      .map(firstView);

module.exports = () => {
  let stopViewWarming = false;

  const progressLoop = (deployDoc, _queryInterval) => {
    return new Promise((res, rej) => {
      const checkProgressLater = (waitMs) => {
        setTimeout(() => {
          if (stopViewWarming) {
            return res();
          }

          writeProgress(deployDoc)
            .then(() => checkProgressLater())
            .catch(err => {
              stopViewWarming = true;
              rej(err);
            });
        }, _queryInterval || waitMs || DEFAULT_ACTIVE_TASK_QUERY_INTERVAL);
      };

      // First progress check should be quick to get the progress bars displaying ASAP
      checkProgressLater(1000);
    });
  };

  const probeViewsLoop = (deployDoc, viewlist) => {
    return new Promise(res => {
      const probeViews = () => {
        if (stopViewWarming) {
          return res();
        }

        Promise
          .all(viewlist.map(view => DB.app.query(view, { limit: 1 })))
          .then(() => {
            stopViewWarming = true;
            info('Warming views complete');
            return updateIndexers(deployDoc);
          })
          .catch(err => {
            if (err.error !== 'timeout') {
              // Ignore errors in the view warming loop because long-running view queries aren't that
              // trust-worthy. We *do* check for errors in the writeProgressTimeout loop, so that will
              // catch real CouchDB errors
              info(`Unexpected error while warming: (${err.message}), continuing`);
            }

            probeViews();
          });
      };

      probeViews();
    });
  };

  return {
    warm: (deployDoc, _queryInterval) => utils.getStagedDdocs(true)
    .then(ddocs => {
      debug(`Got ${ddocs.length} staged ddocs`);

      info('Beginning view warming');

      // It is intentional but not required (if people hate it) that this doesn't check for and
      // overwrite existing warm logs, i.e. from a past attempt at this specific deployment.
      deployDoc.log.push({
        type: 'warm_log'
      });

      return utils.update(deployDoc)
        .then(() => Promise.race([
          progressLoop(deployDoc, _queryInterval),
          probeViewsLoop(deployDoc, viewQueries(ddocs))
        ]));
    }),
    _probeViewsLoop: probeViewsLoop,
    _progressLoop: progressLoop,
    _writeProgress: writeProgress,
    _viewQueries: viewQueries
  };
};
