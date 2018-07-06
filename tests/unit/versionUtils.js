const assert = require('chai').assert;

const versionUtils = require('../../src/versionUtils');

describe('Version utilities', () => {
  it('parses complete versions', () => {
    assert.deepEqual(versionUtils.parse('ns:app:1.0.0'), {
      namespace: 'ns',
      application: 'app',
      version: '1.0.0',
      isChannel: false
    });
  });

  it('parses complete channels', () => {
    assert.deepEqual(versionUtils.parse('@ns:app:release'), {
      namespace: 'ns',
      application: 'app',
      version: 'release',
      isChannel: true
    });
  });

  it('should successfully parse a "medic" version', () => {
    assert.deepEqual(versionUtils.parse('1.0.0'), {
      application: 'medic',
      namespace: 'medic',
      version: '1.0.0',
      isChannel: false
    });
  });
  it('should successfully parse a "medic" channel', () => {
    assert.deepEqual(versionUtils.parse('@release'), {
      application: 'medic',
      namespace: 'medic',
      version: 'release',
      isChannel: true
    });
  });
});
