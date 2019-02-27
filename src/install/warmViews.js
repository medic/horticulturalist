const { debug, info } = require('../log'),
      DB = require('../dbs'),
      utils = require('../utils');

const ACTIVE_TASK_QUERY_INTERVAL = 10 * 1000; // 10 seconds

module.exports = (deployDoc) => {
  const writeProgress = () => {
    return DB.activeTasks()
      .then(tasks => {
        const relevantTasks = tasks.filter(task =>
          task.type === 'indexer' && task.design_document.includes(':staged:'));

        return updateIndexers(relevantTasks);
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
  const updateIndexers = (runningTasks) => {
    const entry = deployDoc.log[deployDoc.log.length - 1],
          indexers = entry.indexers || [];

    // We assume all previous tasks have finished.
    indexers.forEach(setTasksToComplete);
    // If a task is new or still running, it's progress is updated
    updateRunningTasks(indexers, runningTasks);
    indexers.forEach(calculateAverageProgress);

    entry.indexers = indexers;

    logIndexersProgress(indexers);
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

  let stopViewWarming = false;

  // Query _active_tasks every ACTIVE_TASK_QUERY_INTERVAL seconds until `stopViewWarming` is true
  const writeProgressTimeout = (rej) => {
    setTimeout(() => {
      if (stopViewWarming) {
        return;
      }
      writeProgress()
        .then(writeProgressTimeout)
        .catch(rej);
    }, ACTIVE_TASK_QUERY_INTERVAL);
  };

  const probeViews = viewlist => {
    if (stopViewWarming) {
      return;
    }

    return Promise
      .all(viewlist.map(view => DB.app.query(view, { limit: 1 })))
      .then(() => {
        stopViewWarming = true;
        info('Warming views complete');
        return updateIndexers();
      })
      .catch(err => {
        if (err.error !== 'timeout') {
          // Ignore errors in the view warming loop because long-running view queries aren't that
          // trust-worthy. We *do* check for errors in the writeProgressTimeout loop, so that will
          // catch real CouchDB errors
          info(`Unexpected error while warming: (${err.message}), continuing`);
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
          return new Promise((res, rej) => {
            writeProgressTimeout(rej);
            probeViews(queries)
              .then(() => undefined)
              .catch(err => err)
              .then(err => {
                // Manually implementing something similar to a `finally` block
                // If you read this and our minumum Node version is now > 10.3
                // then refactor away
                stopViewWarming = true;

                if (err) {
                  rej(err);
                } else {
                  res();
                }
              });
          });
        });
    });
};
