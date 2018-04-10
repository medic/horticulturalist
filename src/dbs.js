const PouchDB = require('pouchdb-core');
PouchDB.plugin(require('pouchdb-adapter-http'));
PouchDB.plugin(require('pouchdb-mapreduce'));

const STAGING_URL = 'https://staging.dev.medicmobile.org/_couch/builds';

if (process.env.TESTING) {
  const unmocked = () => Promise.reject('this needs to be mocked');

  module.exports = {
    app: {
      allDocs: unmocked,
      bulkDocs: unmocked,
      get: unmocked,
      put: unmocked,
      remove: unmocked
    },
    builds: {
      get: unmocked,
      put: unmocked,
      query: unmocked
    }
  };
} else {
  const COUCH_URL = process.env.COUCH_URL;
  if(!COUCH_URL) throw new Error('COUCH_URL env var not set.');

  module.exports = {
    app: new PouchDB(COUCH_URL),
    builds: new PouchDB(STAGING_URL)
  };
}
