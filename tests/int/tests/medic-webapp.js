// const assert = require('chai').assert;

const dbUtils = require('../utils/db'),
      hortiUtils = require('../utils/horti');

const PROD_BUILD_URL = 'https://staging.dev.medicmobile.org/_couch/builds';

describe('Basic Medic-Webapp smoke test (v. slow tests!)', function() {
  // These tests require connecting to the PROD builds server
  // and so can be very slow.
  this.timeout(5 * 60 * 1000);

  before(() => {
    return dbUtils.initAppsDB()
      .then(() => hortiUtils.cleanWorkingDir());
  });

  it('should --install master without error', () => {
    return hortiUtils.start([
      '--install=medic:medic:master',
      '--test'
    ], {
      waitUntil: /Medic API listening/,
      buildServer: PROD_BUILD_URL
    }).then(horti => {
      horti.kill();
    });
  });

  it('should start the daemon with no install without error', () => {
    return hortiUtils.start([
      '--test'
    ], {
      waitUntil: /Medic API listening/,
      buildServer: PROD_BUILD_URL
    }).then(horti => {
      horti.kill();
    });
  });
});
