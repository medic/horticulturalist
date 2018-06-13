const dbUtils = require('../utils/db'),
      hortiUtils = require('../utils/horti');

describe('Bootstrapping', () => {
  before(() => Promise.all([
    dbUtils.initBuildsDB,
    dbUtils.initAppsDb,
  ]));

  it('Bootstraps and installs a minimal application', () => {
    return Promise.resolve()
      .then(() => dbUtils.uploadBuild(require('./bootstrap/minimal-app.json')))
      .then(() => hortiUtils.start(['-bootstrap=test:test-app-1:1.0.0', '--no-daemon'], true))
      .then(() => {
        console.log('I wonder if anything broke?');
      });
  });
});
