const request = require('request-promise-native'),
      {URL} = require('url');

const PouchDB = require('pouchdb-core');
PouchDB.plugin(require('pouchdb-adapter-http'));
PouchDB.plugin(require('pouchdb-mapreduce'));

const { info } = require('./log');

const DEFAULT_BUILDS_URL = 'https://staging.dev.medicmobile.org/_couch/builds';
const BUILDS_URL = process.env.HORTI_BUILDS_SERVER || DEFAULT_BUILDS_URL;

if (BUILDS_URL !== DEFAULT_BUILDS_URL) {
  info('Using non-default build server: ', BUILDS_URL);
}

if (process.env.TESTING) {
  module.exports = {
    app: {},
    builds: {},
  };
} else {
  const COUCH_URL = new URL(process.env.COUCH_URL);
  COUCH_URL.pathname = '/';

  const activeTasks = () => {
    return request({
      url: COUCH_URL + '/_active_tasks',
      json: true
    }).then(tasks => {
      // TODO: consider how to filter these just to the active database.
      // On CouchDB 2.x you only get the shard name, which looks like:
      // shards/80000000-ffffffff/medic.1525076838
      // On CouchDB 1.x (I think) you just get the exact DB name
      return tasks;
    });
  };

  const DEPLOY_URL = process.env.COUCH_URL;
  if(!DEPLOY_URL) throw new Error('COUCH_URL env var not set.');

  module.exports = {
    app: new PouchDB(DEPLOY_URL),
    builds: new PouchDB(BUILDS_URL),
    activeTasks: activeTasks
  };
}
