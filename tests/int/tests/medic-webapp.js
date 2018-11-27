const assert = require('chai').assert;

const dbUtils = require('../utils/db'),
      hortiUtils = require('../utils/horti'),
      request = require('request-promise-native');

const PROD_BUILD_URL = 'https://staging.dev.medicmobile.org/_couch/builds';

const waitCondition = {
  waitUntil: /Watching for deployments/,
  buildServer: PROD_BUILD_URL,
  log: true
};

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
    ], waitCondition).then(horti => {
      horti.kill();
    });
  });

  it('should --install two upgrades without error', () => {
    return hortiUtils
      .start([ '--install=medic:medic:3.0.x', '--test' ], waitCondition)
      .then(horti => horti.kill())
      .then(() => hortiUtils.start([ '--install=medic:medic:3.1.x', '--test' ], waitCondition))
      .then(horti => horti.kill());
  });

  it('should support --install-ing previously installed build', () => {
    const ddocs = {};

    return request({
        url: PROD_BUILD_URL + '/_all_docs?keys=["medic:medic:3.0.x","medic:medic:3.1.x"]&include_docs=true',
        json: true
      })
      .then(results => {
        results.rows.forEach(row => ddocs[row.id] = row.doc);
        return hortiUtils.start([ '--install=medic:medic:3.0.x', '--test' ], waitCondition);
      })
      .then(horti => {
        return Promise
          .all([
            hortiUtils.getCurrentAppDir('medic-api'),
            hortiUtils.getCurrentAppDir('medic-sentinel'),
          ])
          .then(folders => {
            assert.equal(folders[0], hortiUtils.getDDocAppDigest('medic-api', ddocs['medic:medic:3.0.x']));
            assert.equal(folders[1], hortiUtils.getDDocAppDigest('medic-sentinel', ddocs['medic:medic:3.0.x']));
            horti.kill();
          });
      })
      .then(() => hortiUtils.start([ '--install=medic:medic:3.1.x', '--test' ], waitCondition))
      .then(horti => {
        return Promise
          .all([
            hortiUtils.getCurrentAppDir('medic-api'),
            hortiUtils.getCurrentAppDir('medic-sentinel'),
          ])
          .then(folders => {
            assert.equal(folders[0], hortiUtils.getDDocAppDigest('medic-api', ddocs['medic:medic:3.1.x']));
            assert.equal(folders[1], hortiUtils.getDDocAppDigest('medic-sentinel', ddocs['medic:medic:3.1.x']));
            horti.kill();
          });
      })
      .then(() => hortiUtils.start([ '--install=medic:medic:3.0.x', '--test' ], waitCondition))
      .then(horti => {
        return Promise
          .all([
            hortiUtils.getCurrentAppDir('medic-api'),
            hortiUtils.getCurrentAppDir('medic-sentinel'),
          ])
          .then(folders => {
            assert.equal(folders[0], hortiUtils.getDDocAppDigest('medic-api', ddocs['medic:medic:3.0.x']));
            assert.equal(folders[1], hortiUtils.getDDocAppDigest('medic-sentinel', ddocs['medic:medic:3.0.x']));
            horti.kill();
          });
      });
  });

  it('should start the daemon with no install without error', () => {
    return hortiUtils.start([
      '--test'
    ], {
      waitUntil: /Medic API listening/,
      log: true
    }).then(horti => {
      horti.kill();
    });
  });
});
