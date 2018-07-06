const PouchDB = require('pouchdb-core')
        .plugin(require('pouchdb-adapter-http'))
        .plugin(require('pouchdb-mapreduce'));

const builds = require('medic-builds-repo');

const { BUILDS_URL, APP_URL } = require('./constants');

module.exports = {
  initBuildsDB: () => {
    return builds.init(BUILDS_URL, { wipe: true });
  },
  initAppsDB: () => {
    const DB = new PouchDB(APP_URL);
    return DB.destroy()
      .then(() => new PouchDB(APP_URL));
  },
  uploadBuild: build => {
    const DB = new PouchDB(BUILDS_URL);

    return DB.put(build);
  },
  appDb: () => new PouchDB(APP_URL)
};
