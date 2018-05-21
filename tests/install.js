require('chai').should();

const sinon = require('sinon').sandbox.create();
const DB = require('../src/dbs');
const install = require('../src/install'),
      deploySteps = require('../src/install/deploySteps'),
      utils = require('../src/utils');

describe('Installation flow', () => {
  const deployDoc = {
    _id: 'horti-upgrade',
    user: 'admin',
    build_info: {
      namespace: 'medic',
      application: 'medic',
      version: '1.0.0'
    },
    log: []
  };

  afterEach(() => sinon.restore());
  beforeEach(() => {
    DB.app.allDocs = sinon.stub();
    DB.app.bulkDocs = sinon.stub();
    DB.app.get = sinon.stub();
    DB.app.put = sinon.stub();
    DB.app.query = sinon.stub();
    DB.app.remove = sinon.stub();
    DB.app.viewCleanup = sinon.stub();
    DB.app.compact = sinon.stub();
    DB.builds.get = sinon.stub();
    DB.activeTasks = sinon.stub();
  });

  describe('Pre cleanup', () => {
    it('deletes docs left over from previous (bad) deploys', () => {
      DB.app.allDocs.resolves({rows: []});
      DB.app.viewCleanup.resolves();
      DB.app.compact.resolves();
      return install._preCleanup()
        .then(() => {
          DB.app.allDocs.callCount.should.equal(1);
          DB.app.viewCleanup.callCount.should.equal(1);
          DB.app.compact.callCount.should.equal(1);
        });
    });
  });

  describe('Download Build', () => {
    it('Gets the correct build from the builds server and stages it', () => {
      DB.builds.get.resolves({
        _id: '1.0.0'
      });
      DB.app.put.resolves({rev: '1-somerev'});

      return install._downloadBuild(deployDoc)
        .then(() => {
          DB.builds.get.callCount.should.equal(1);
          DB.app.put.callCount.should.equal(1);

          const actual = DB.app.put.args[0][0];

          // actual._id.should.equal('_design/:staged:1.0.0:medic');
          actual._id.should.equal('_design/:staged:medic');
          actual._rev.should.equal('1-somerev');
          actual.deploy_info.user.should.equal('admin');
          actual.deploy_info.version.should.equal('1.0.0');
        });
    });
  });

  describe('Extract ddocs', () => {
    const compiled = {
      docs: [{
        _id: '_design/medic-test'
      }]
    };

    const stagedMainDoc = {
      _id: '_design/:staged:medic',
      _attachments: {
        'ddocs/compiled.json': {
          data: Buffer.from(JSON.stringify(compiled))
        }
      }
    };

    it('Takes the ddoc attachment and stores them as staged ddocs', () => {
      DB.app.bulkDocs.resolves([]);

      return install._extractDdocs(stagedMainDoc).then(() => {
        DB.app.bulkDocs.callCount.should.equal(1);
        DB.app.bulkDocs.args[0][0].should.deep.equal([{
          _id: '_design/:staged:medic-test'
        }, stagedMainDoc]);
      });
    });

    it('Writes attached ddocs individually if the bulk write times out', () => {
      // These very large writes seem to timeout quite a lot, regardless of timeout
      // settings used by PouchDB, so we need this to fall back on.
      // However, bulk delete can only *partially* fail with a socket timeout, writing
      // some docs and not others, so we also must deal with that.

      DB.app.bulkDocs.rejects({code: 'ESOCKETTIMEDOUT'});
      DB.app.get.withArgs('_design/:staged:medic-test').rejects({status: 404});
      DB.app.get.withArgs('_design/:staged:medic').resolves({
        _id: '_design/:staged:medic',
        _rev: '1-test'
      });
      DB.app.put.rejects({status: 409});

      return install._extractDdocs(stagedMainDoc).then(() => {
        DB.app.bulkDocs.callCount.should.equal(1);
        DB.app.get.callCount.should.equal(2);
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0].should.deep.equal({
          _id: '_design/:staged:medic-test'
        });
      });
    });
  });

  describe('Warming views', () => {
    it('Finds all staged ddocs and queries a view from each, writing progress to the deployDoc', () => {
      const relevantIndexer = {
        "changes_done": 5454,
        "database": "shards/80000000-ffffffff/medic.1525076838",
        "design_document": "_design/:staged:medic",
        "pid": "<0.6838.4>",
        "progress": 7,
        "started_on": 1376116632,
        "total_changes": 76215,
        "type": "indexer",
        "updated_on": 1376116651
      };
      const irrelevantIndexer = {
        "changes_done": 5454,
        "database": "shards/80000000-ffffffff/medic.1525076838",
        "design_document": "_design/medic",
        "pid": "<0.6838.4>",
        "progress": 7,
        "started_on": 1376116632,
        "total_changes": 76215,
        "type": "indexer",
        "updated_on": 1376116651
      };

      DB.app.allDocs.resolves({ rows: [
        { doc: {
          _id: '_design/:staged:no-views'
        }},
        { doc: {
          _id: '_design/:staged:also-no-views',
          views: {}
        }},
        { doc: {
          _id: '_design/:staged:some-views',
          views: {
            a_view: 'the map etc'
          }
        }},
        { doc: {
          _id: '_design/:staged:some-more-views',
          views: {
            lib: 'shared libaries that is not a view even though it is located here',
            yet_another_view: 'the map etc'
          }
        }}
      ]});
      DB.app.query.resolves();
      DB.app.put.resolves({});
      DB.activeTasks.resolves([relevantIndexer, irrelevantIndexer]);

      return install._warmViews(deployDoc)
        .then(() => {
        console.log('13243214324312');
        DB.app.query.callCount.should.equal(2);
        DB.app.query.args[0][0].should.equal(':staged:some-views/a_view');
        DB.app.query.args[0][1].should.deep.equal({limit: 1});
        DB.app.query.args[1][0].should.equal(':staged:some-more-views/yet_another_view');

        // First to init the warm log, second after querying for indexes
        DB.app.put.callCount.should.equal(2);
        DB.app.put.args[1][0].log.length.should.equal(1);
        DB.app.put.args[1][0].log[0].should.deep.equal({
          type: 'warm_log',
          indexers: [relevantIndexer]
        });
      });
    });
  });

  describe('Deploy steps', () => {
    describe('Deploy staged ddocs', () => {
      const steps = deploySteps(null, null, deployDoc);

      const primaryDdoc = {_id: '_design/:staged:medic', _rev: '1-medic', staged: true};
      const secondaryDdocs = [
        {_id: '_design/:staged:secondary1', _rev: '1-secondary1', staged: true},
        {_id: '_design/:staged:secondary2', _rev: '1-secondary2', staged: true}
      ];
      const allStagedDdocs = [primaryDdoc].concat(secondaryDdocs);

      it('deploys primary and secondary ddocs', () => {
        sinon.stub(steps, '_loadStagedDdocs').resolves({
          primaryDdoc: primaryDdoc,
          secondaryDdocs: secondaryDdocs
        });
        sinon.stub(steps, '_deploySecondaryDdocs').resolves();
        sinon.stub(steps, '_deployPrimaryDdoc').resolves();

        return steps._deployStagedDdocs()
          .then(() => {
            steps._loadStagedDdocs.callCount.should.equal(1);
            steps._deploySecondaryDdocs.callCount.should.equal(1);
            steps._deploySecondaryDdocs.args[0][0].should.deep.equal(secondaryDdocs);
            steps._deployPrimaryDdoc.callCount.should.equal(1);
            steps._deployPrimaryDdoc.args[0][0].should.deep.equal(primaryDdoc);
          });
      });
      it('Loads and splits staged ddocs into primary and secondary', () => {
        sinon.stub(utils, 'getStagedDdocs').resolves(allStagedDdocs);

        return steps._loadStagedDdocs()
          .then(results => {
            results.primaryDdoc.should.deep.equal(primaryDdoc);
            results.secondaryDdocs.should.deep.equal(secondaryDdocs);
          });
      });
      it('Deploys secondary ddocs, including over existing ddocs', () => {
        DB.app.allDocs.resolves({
          rows: [{
            id: '_design/secondary1',
            value: {
              rev: '1-existingDdoc'
            }
          }]
        });

        DB.app.bulkDocs.resolves([]);

        return steps._deploySecondaryDdocs(secondaryDdocs)
          .then(() => {
            DB.app.allDocs.callCount.should.equal(1);
            DB.app.allDocs.args[0][0].keys.should.deep.equal(
              secondaryDdocs.map(d => d._id)
            );
            DB.app.bulkDocs.callCount.should.equal(1);
            DB.app.bulkDocs.args[0][0].should.deep.equal([
              {_id: '_design/secondary1', _rev: '1-existingDdoc', staged: true},
              {_id: '_design/secondary2', staged: true}
            ]);
          });
      });
      it('Deploys primary ddoc when none existed before', () => {
        DB.app.get.rejects({status: 404});
        DB.app.put.resolves();

        return steps._deployPrimaryDdoc(primaryDdoc)
          .then(() => {
            DB.app.put.callCount.should.equal(1);
            DB.app.put.args[0][0].should.deep.equal({
              _id: '_design/medic',
              staged: true
            });
          });
      });
      it('Deploys primary ddoc when one existed before, copying app settings', () => {
        DB.app.get.resolves({
          _id: '_design/medic',
          _rev: '1-existingDdoc',
          app_settings: {
            some: 'settings'
          }
        });
        DB.app.put.resolves();

        return steps._deployPrimaryDdoc(primaryDdoc)
          .then(() => {
            DB.app.put.callCount.should.equal(1);
            DB.app.put.args[0][0].should.deep.equal({
              _id: '_design/medic',
              _rev: '1-existingDdoc',
              app_settings: {
                some: 'settings'
              },
              staged: true
            });
          });
      });
    });
  });

  describe('Post cleanup', () => {
    it('deletes docs used in deploy', () => {
      DB.app.put.resolves();
      DB.app.allDocs.resolves({rows: [{id: 'foo', value: {rev: '1-bar'}}]});
      DB.app.bulkDocs.resolves([]);
      DB.app.viewCleanup.resolves();
      return install._postCleanup(deployDoc)
        .then(() => {
          DB.app.put.callCount.should.equal(1);
          DB.app.put.args[0][0]._id.should.equal('horti-upgrade');
          DB.app.put.args[0][0]._deleted.should.equal(true);
          DB.app.allDocs.callCount.should.equal(1);
          DB.app.bulkDocs.callCount.should.equal(1);
          DB.app.bulkDocs.args[0][0].should.deep.equal([{
            _id: 'foo',
            _rev: '1-bar',
            _deleted: true
          }]);
          DB.app.viewCleanup.callCount.should.equal(1);
        });
    });
  });
});
