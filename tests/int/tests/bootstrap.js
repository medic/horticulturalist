const assert = require('chai').assert;

const dbUtils = require('../utils/db'),
      hortiUtils = require('../utils/horti');

describe('Bootstrapping', () => {
  before(() => Promise.all([
    dbUtils.initBuildsDB(),
    dbUtils.initAppsDB(),
  ]));

  it('Bootstraps and installs a minimal application', () => {
    return Promise.resolve()
      .then(() => dbUtils.uploadBuild(require('./bootstrap/minimal-app.json')))
      .then(() => hortiUtils.start([
        '--install=test:test-app-1:1.0.0',
        '--no-daemon',
        '--local'], true, true))
      .then(() => dbUtils.appDb().get('_design/test-app-1'))
      .then(ddoc => {
        assert.equal(ddoc.deploy_info.user, 'horticulturalist cli');
        assert.equal(ddoc.deploy_info.version, '1.0.0');
      });
  });
});
