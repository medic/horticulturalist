const assert = require('chai').assert;

const dbUtils = require('../utils/db'),
      hortiUtils = require('../utils/horti');

describe('Bootstrapping', () => {
  before(() =>
    dbUtils.initBuildsDB()
      .then(() => dbUtils.uploadBuild(require('./bootstrap/minimal-app-1.0.0.json')))
      .then(() => dbUtils.uploadBuild(require('./bootstrap/minimal-app-1.1.0.json'))));

  beforeEach(() => dbUtils.initAppsDB());

  it('Bootstraps and installs a minimal application', () => {
    return Promise.resolve()
      .then(() => hortiUtils.start([
        '--install=test:test-app-1:1.0.0',
        '--no-daemon',
        '--local'], true, true))
      .then(() => dbUtils.appDb().get('_design/test-app-1'))
      .then(ddoc => {
        assert.equal(ddoc.deploy_info.user, 'horticulturalist cli');
        assert.equal(ddoc.deploy_info.version, '1.0.0');
      })
      .catch(err => assert.fail(err));
  });

  it('Bootstraps and installs a minimal application based off a channel', () => {
    return Promise.resolve()
      .then(() => hortiUtils.start([
        '--install=@test:test-app-1:release',
        '--no-daemon',
        '--local'], true, true))
      .then(() => dbUtils.appDb().get('_design/test-app-1'))
      .then(ddoc => {
        assert.equal(ddoc.deploy_info.user, 'horticulturalist cli');
        assert.equal(ddoc.deploy_info.version, '1.1.0');
      });
  });
});
