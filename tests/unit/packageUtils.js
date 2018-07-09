const assert = require('chai').assert;

const packageUtils = require('../../src/package');

describe('Version utilities', () => {
  it('parses complete versions', () => {
    assert.deepEqual(packageUtils.parse('ns:app:1.0.0'), {
      namespace: 'ns',
      application: 'app',
      version: '1.0.0',
      isChannel: false
    });
  });

  it('parses complete channels', () => {
    assert.deepEqual(packageUtils.parse('@ns:app:release'), {
      namespace: 'ns',
      application: 'app',
      version: 'release',
      isChannel: true
    });
  });

  it('should successfully parse a "medic" version', () => {
    assert.deepEqual(packageUtils.parse('1.0.0'), {
      application: 'medic',
      namespace: 'medic',
      version: '1.0.0',
      isChannel: false
    });
  });
  it('should successfully parse a "medic" channel', () => {
    assert.deepEqual(packageUtils.parse('@release'), {
      application: 'medic',
      namespace: 'medic',
      version: 'release',
      isChannel: true
    });
  });
});
