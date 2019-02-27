const should = require('chai').should();
const sinon = require('sinon');

const DB = require('../../src/dbs'),
      install = require('../../src/install');

const daemon = require('../../src/daemon');

describe('Daemon', () => {
  afterEach(() => sinon.restore());

  describe('Performing deployments', () => {
    describe('_newDeployment', () => {
      it('no deployDoc !== deployment', () => {
        daemon._newDeployment().should.equal(false);
      });
      it('legacy doc !== deployment', () => {
        // Legacy docs get ignored as they get converted into the new style first
        daemon._newDeployment({_id: '_design/medic:staged'}).should.equal(false);
      });
      it('completed staging !== deployment', () => {
        // Doc only gets deleted once an upgrade is complete. If we complete a staging
        // we don't want to start re-staging it if horti restarts
        daemon._newDeployment({_id: 'horti-upgrade', action: 'stage', staging_complete: true}).should.equal(false);
      });
      it('install action === deployment', () => {
        daemon._newDeployment({_id: 'horti-upgrade', action: 'install'}).should.equal(true);
      });
      it('complete action === deployment', () => {
        daemon._newDeployment({_id: 'horti-upgrade', action: 'complete'}).should.equal(true);
      });
    });
    describe('_performDeployment', () => {
      beforeEach(() => {
        sinon.stub(install, 'install');
        sinon.stub(install, 'stage');
        sinon.stub(install, 'complete');
      });

      const mode = 'mode';
      const firstRun = 'firstRun';
      const deployResult = Promise.resolve();

      it('installs with no action', () => {
        // There are some branches lying around created 2.15 <= x <= 3.0.0
        // that generate the `horti-upgrade` doc without an action, so for
        // completeness we count no action as the full install action

        install.install.returns(deployResult);

        const deployDoc = {};
        daemon._performDeployment(deployDoc, mode, firstRun)
          .should.equal(deployResult);

        install.install.args[0].should.deep.equal([deployDoc, mode, firstRun]);
      });
      it('installs with the install action', () => {
        install.install.returns(deployResult);

        const deployDoc = {action: 'install'};
        daemon._performDeployment(deployDoc, mode, firstRun)
          .should.equal(deployResult);

        install.install.args[0].should.deep.equal([deployDoc, mode, firstRun]);
      });
      it('stages with the stage action', () => {
        install.stage.returns(deployResult);

        const deployDoc = {action: 'stage'};
        daemon._performDeployment(deployDoc, mode, firstRun)
          .should.equal(deployResult);

        install.stage.args[0].should.deep.equal([deployDoc]);
      });
      it('completes with the complete action', () => {
        install.complete.returns(deployResult);

        const deployDoc = {action: 'complete'};
        daemon._performDeployment(deployDoc, mode, firstRun)
          .should.equal(deployResult);

        install.complete.args[0].should.deep.equal([deployDoc, mode, firstRun]);
      });
    });
  });

  describe('Watching for deployments', () => {
    const changes = () => {
      // Real `function` so we get arguments
      const handler = function() {
        const on = (type, fn) => {
          state.listeners[type] = fn;
          return on;
        };

        const state = {
          listeners: [],
          canceled: false
        };

        state.arguments = arguments;
        handler._ = state;
        return {
          on: on,
          cancel: () => state.canceled = true,
        };
      };

      return handler;
    };

    beforeEach(() => {
      DB.app.changes = changes();
      daemon._newDeployment = sinon.stub();
      daemon._performDeployment = sinon.stub();
      daemon._watchForDeployments('mode', 'apps');
    });

    it('sets up a changes handler', () => {
      // It gets actually setup in the beforeEach

      DB.app.changes._.arguments[0].should.deep.equal({
        live: true,
        since: 'now',
        doc_ids: [ 'horti-upgrade', '_design/medic:staged'],
        include_docs: true,
        timeout: false,
      });

      should.exist(DB.app.changes._.listeners.change);
      should.exist(DB.app.changes._.listeners.error);
    });

    it('converts legacy deploy docs into correct ones', () => {
      DB.app.remove = sinon.stub();
      DB.app.remove.resolves();
      DB.app.put = sinon.stub();
      DB.app.put.resolves();

      const legacyDeployDoc = {
        _id: '_design/medic:staged',
        deploy_info: {
          user: 'test',
          timestamp: 1234,
          version: '1.2.3'
        }
      };

      return DB.app.changes._.listeners.change({doc: legacyDeployDoc})
        .then(() => {
          // Don't cancel the changes feed, we're about to write something
          // that will feed into the normal changes flow
          DB.app.changes._.canceled.should.equal(false);

          DB.app.remove.callCount.should.equal(1);
          DB.app.remove.args[0][0].should.deep.equal(legacyDeployDoc);
          DB.app.put.callCount.should.equal(1);
          DB.app.put.args[0][0].should.deep.equal({
            _id: 'horti-upgrade',
            schema_version: 1,
            user: legacyDeployDoc.deploy_info.user,
            created: legacyDeployDoc.deploy_info.timestamp,
            build_info: {
              namespace: 'medic',
              application: 'medic',
              version: legacyDeployDoc.deploy_info.version
            },
            action: 'install'
          });
        });
    });
    it('Ignores non-new deployments', () => {
      daemon._newDeployment.returns(false);

      return Promise.resolve()
        .then(() => DB.app.changes._.listeners.change({doc: {}}))
        .then(() => {
          DB.app.changes._.canceled.should.equal(false);
          daemon._performDeployment.callCount.should.equal(0);
        });
    });
    it('cancels, fires the deployment then re-initiates itself afterwards', () => {
      daemon._newDeployment.returns(true);
      daemon._performDeployment.returns(Promise.resolve().then(() => {
        // Before starting the deploy the watch must be canceled, otherwise
        // the writing of stages into the log would cause more deployments to
        // be started!
        DB.app.changes._.canceled.should.equal(true);
      }));

      return DB.app.changes._.listeners.change({doc: {_id: 'horti-upgrade'}})
        .then(() => {
          // At this point the changes listener has been re-initalised
          DB.app.changes._.canceled.should.equal(false);
          daemon._performDeployment.callCount.should.equal(1);
        });
    });
  });
});
