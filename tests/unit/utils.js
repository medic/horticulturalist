const assert = require('chai').assert;
const sinon = require('sinon');

const utils = require('../../src/utils');

describe('General utilities', () => {
  describe('Ready stage', () => {
    beforeEach(() => {
      sinon.restore();
    });

    it('Writes and readies a new stage not seen by this deployment', () => {
      sinon.stub(utils, 'update').resolves();

      const deployLog = {
        log: [
          {
            type: 'stage',
            key: 'test-stage-1'
          }
        ]
      };

      return utils.readyStage(deployLog, 'test-stage-2', 'the next stage')
        .then(shouldRunStage => {
          assert.equal(shouldRunStage, true);
          assert.equal(utils.update.callCount, 1);
        });
    });

    it('Readies but does not write a stage when it exists already and is this last stage written', () => {
      sinon.stub(utils, 'update').resolves();

      const deployLog = {
        log: [
          {
            type: 'stage',
            key: 'test-stage-1'
          }
        ]
      };

      return utils.readyStage(deployLog, 'test-stage-1', 'the last run stage')
        .then(shouldRunStage => {
          assert.equal(shouldRunStage, true);
          assert.equal(utils.update.callCount, 0);
        });
    });

    it('Requests you skip a stage that is written to the log and is not the latest stage written', () => {
      sinon.stub(utils, 'update').resolves();

      const deployLog = {
        log: [
          {
            type: 'stage',
            key: 'test-stage-1'
          },
          {
            type: 'stage',
            key: 'test-stage-2'
          }
        ]
      };

      return utils.readyStage(deployLog, 'test-stage-1', 'we are past this')
        .then(shouldRunStage => {
          assert.equal(shouldRunStage, false);
          assert.equal(utils.update.callCount, 0);
        });
    });
  });
});
