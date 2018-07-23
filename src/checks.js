const dbs = require('./dbs');
const { debug } = require('./log');

const appDbOnline = () => dbs.app.info().catch(() => { throw Error('Cannot locate app db'); });

const appDbMustBeCouchDB2 = () => {
  return dbs.activeTasks()
    .catch(() => {
      // _active_tasks is currently required by horti and was added in 2.x
      throw Error('Horticulturalist requires the application server you wish to deploy on to be CouchDB v2');
    });
};

//
// NB: we are intentionally not checking to see if the builds server is
// accessible at start-up. It is a valid option to run Horti offline!
//
module.exports = () => {
  debug('Running pre-boot checks');
  return appDbOnline()
    .then(appDbMustBeCouchDB2)
    .then(() => debug('Pre-boot checks OK'));
};
