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
      .start([ '--install=medic:medic:3.0.0', '--test' ], waitCondition)
      .then(horti => horti.kill())
      .then(() => hortiUtils.start([ '--install=medic:medic:3.1.0', '--test' ], waitCondition))
      .then(horti => horti.kill());
  });

  it('should support --install-ing previously installed build', () => {
    const buildDocs = {};

    const checkBuildApps = build => {
      assert.equal(
        hortiUtils.getCurrentAppDir('medic-api'),
        hortiUtils.getDDocAppDigest('medic-api', buildDocs[build])
      );
      assert.equal(
        hortiUtils.getCurrentAppDir('medic-sentinel'),
        hortiUtils.getDDocAppDigest('medic-sentinel', buildDocs[build])
      );

      assert.equal(hortiUtils.oldAppLinkExists('medic-api'), false);
      assert.equal(hortiUtils.oldAppLinkExists('medic-sentinel'), false);
    };

    return request({
        url: PROD_BUILD_URL + '/_all_docs?keys=["medic:medic:3.0.0","medic:medic:3.1.0"]&include_docs=true',
        json: true
      })
      .then(results => {
        results.rows.forEach(row => buildDocs[row.id] = row.doc);
        return hortiUtils.start([ '--install=medic:medic:3.0.0', '--test' ], waitCondition);
      })
      .then(horti => {
        checkBuildApps('medic:medic:3.0.0');
        horti.kill();
      })
      .then(() => hortiUtils.start([ '--install=medic:medic:3.1.0', '--test' ], waitCondition))
      .then(horti => {
        checkBuildApps('medic:medic:3.1.0');
        horti.kill();
      })
      .then(() => hortiUtils.start([ '--install=medic:medic:3.0.0', '--test' ], waitCondition))
      .then(horti => {
        checkBuildApps('medic:medic:3.0.0');
        horti.kill();
      })
      .then(() => hortiUtils.start([ '--install=medic:medic:3.0.0', '--test' ], waitCondition))
      .then(horti => {
        checkBuildApps('medic:medic:3.0.0');
        horti.kill();
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
