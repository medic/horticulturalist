require('chai').should();

const sinon = require('sinon').sandbox.create();
const DB = require('../../src/dbs');
const install = require('../../src/install'),
      deploySteps = require('../../src/install/deploySteps'),
      utils = require('../../src/utils'),
      ddocWrapper = require('../../src/install/ddocWrapper');

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
        "node": "couchdb@localhost",
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
        "node": "couchdb@localhost",
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
        // third after all views are warmed
        DB.app.put.callCount.should.equal(3);
        DB.app.put.args[1][0].log.length.should.equal(1);
        DB.app.put.args[1][0].log[0].should.deep.equal({
          type: 'warm_log',
          indexers: [{
            design_document: '_design/:staged:medic',
            progress: 100,
            tasks: {
              'couchdb@localhost-<0.6838.4>': 100
            }
          }]
        });
        DB.activeTasks.callCount.should.equal(1);
      });
    });

    it('Groups active tasks by ddoc and calculates an overall progress', () => {
      const indexers = [
        [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 3, pid: 's-d1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc1', progress: 4, pid: 's-d1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 2, pid: 's-d1-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: ':staged:ddoc2', progress: 7, pid: 's-d2-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc2', progress: 10, pid: 's-d2-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc2', progress: 5, pid: 's-d2-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: 'ddoc1', progress: 77, pid: 'd1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: 'ddoc1', progress: 99, pid: 'd1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: 'ddoc1', progress: 52, pid: 'd1-3', type: 'indexer'},
        ],
        [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 22, pid: 's-d1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc1', progress: 29, pid: 's-d1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 18, pid: 's-d1-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: ':staged:ddoc2', progress: 36, pid: 's-d2-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc2', progress: 41, pid: 's-d2-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc2', progress: 55, pid: 's-d2-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: 'ddoc1', progress: 87, pid: 'd1-1', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: 'ddoc1', progress: 95, pid: 'd1-3', type: 'indexer'},
        ],
        [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 49, pid: 's-d1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc1', progress: 65, pid: 's-d1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 38, pid: 's-d1-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: ':staged:ddoc2', progress: 65, pid: 's-d2-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc2', progress: 72, pid: 's-d2-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc2', progress: 81, pid: 's-d2-3', type: 'indexer'},
        ],
        [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 72, pid: 's-d1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc1', progress: 92, pid: 's-d1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 75, pid: 's-d1-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: ':staged:ddoc2', progress: 93, pid: 's-d2-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc2', progress: 97, pid: 's-d2-2', type: 'indexer'},
        ],
        [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 92, pid: 's-d1-1', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 94, pid: 's-d1-3', type: 'indexer'},
        ]
      ];
      const deployDocs = [];

      DB.app.allDocs.resolves({ rows: [
          { doc: {
              _id: ':staged:some-views',
              views: {
                a_view: 'the map etc'
              }
            }}
        ]});

      DB.app.query.rejects({ code: 'ESOCKETTIMEDOUT' });
      DB.app.query.onCall(4).resolves();
      indexers.forEach((indexer, key) => {
        DB.activeTasks.onCall(key).resolves(indexer);
      });
      deployDoc.log = [];
      sinon.stub(utils, 'update').callsFake(doc => {
        deployDocs.push(JSON.parse(JSON.stringify(doc)));
        return Promise.resolve();
      });

      return install._warmViews(deployDoc).then(() => {
        DB.activeTasks.callCount.should.equal(5);
        DB.app.query.callCount.should.equal(5);
        utils.update.callCount.should.equal(7);

        deployDoc.log.length.should.equal(1);
        deployDoc.log[0].indexers.should.deep.equal([
          {
            design_document: ':staged:ddoc1',
            progress: 100,
            tasks: { 'n1-s-d1-1': 100, 'n1-s-d1-2': 100, 'n1-s-d1-3': 100 }
          },
          {
            design_document: ':staged:ddoc2',
            progress: 100,
            tasks: { 'n1-s-d2-1': 100, 'n1-s-d2-2': 100, 'n1-s-d2-3': 100 }
          }
        ]);

        deployDocs[0].log.should.deep.equal([{ type: 'warm_log' }]);
        deployDocs[1].log.should.deep.equal([{
          type: 'warm_log',
          indexers: [
            {
              design_document: ':staged:ddoc1',
              progress: 3,
              tasks: { 'n1-s-d1-1': 3, 'n1-s-d1-2': 4, 'n1-s-d1-3': 2 }
            },
            {
              design_document: ':staged:ddoc2',
              progress: 7,
              tasks: { 'n1-s-d2-1': 7, 'n1-s-d2-2': 10, 'n1-s-d2-3': 5 }
            }
          ]
        }]);

        deployDocs[2].log.should.deep.equal([{
          type: 'warm_log',
          indexers: [
            {
              design_document: ':staged:ddoc1',
              progress: 23,
              tasks: { 'n1-s-d1-1': 22, 'n1-s-d1-2': 29, 'n1-s-d1-3': 18 }
            },
            {
              design_document: ':staged:ddoc2',
              progress: 44,
              tasks: { 'n1-s-d2-1': 36, 'n1-s-d2-2': 41, 'n1-s-d2-3': 55 }
            }
          ]
        }]);

        deployDocs[3].log.should.deep.equal([{
          type: 'warm_log',
          indexers: [
            {
              design_document: ':staged:ddoc1',
              progress: 51,
              tasks: { 'n1-s-d1-1': 49, 'n1-s-d1-2': 65, 'n1-s-d1-3': 38 }
            },
            {
              design_document: ':staged:ddoc2',
              progress: 73,
              tasks: { 'n1-s-d2-1': 65, 'n1-s-d2-2': 72, 'n1-s-d2-3': 81 }
            }
          ]
        }]);

        deployDocs[4].log.should.deep.equal([{
          type: 'warm_log',
          indexers: [
            {
              design_document: ':staged:ddoc1',
              progress: 80,
              tasks: { 'n1-s-d1-1': 72, 'n1-s-d1-2': 92, 'n1-s-d1-3': 75 }
            },
            {
              design_document: ':staged:ddoc2',
              progress: 97,
              tasks: { 'n1-s-d2-1': 93, 'n1-s-d2-2': 97, 'n1-s-d2-3': 100 }
            }
          ]
        }]);

        deployDocs[5].log.should.deep.equal([{
          type: 'warm_log',
          indexers: [
            {
              design_document: ':staged:ddoc1',
              progress: 95,
              tasks: { 'n1-s-d1-1': 92, 'n1-s-d1-2': 100, 'n1-s-d1-3': 94 }
            },
            {
              design_document: ':staged:ddoc2',
              progress: 100,
              tasks: { 'n1-s-d2-1': 100, 'n1-s-d2-2': 100, 'n1-s-d2-3': 100 }
            }
          ]
        }]);

        deployDocs[6].log.should.deep.equal([{
          type: 'warm_log',
          indexers: [
            {
              design_document: ':staged:ddoc1',
              progress: 100,
              tasks: { 'n1-s-d1-1': 100, 'n1-s-d1-2': 100, 'n1-s-d1-3': 100 }
            },
            {
              design_document: ':staged:ddoc2',
              progress: 100,
              tasks: { 'n1-s-d2-1': 100, 'n1-s-d2-2': 100, 'n1-s-d2-3': 100 }
            }
          ]
        }]);

      });
    });
  });

  describe('Deploy steps', () => {
    describe('Deploy staged ddocs', () => {
      const steps = deploySteps(null, deployDoc);

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
    const ddoc = ddocWrapper(null, {});

    it('deletes docs used in deploy', () => {
      DB.app.put.resolves();
      DB.app.allDocs.resolves({rows: [{id: 'foo', value: {rev: '1-bar'}}]});
      DB.app.bulkDocs.resolves([]);
      DB.app.viewCleanup.resolves();
      sinon.stub(ddoc, 'getChangedApps').returns([]);

      return install._postCleanup(ddoc, deployDoc)
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
          ddoc.getChangedApps.callCount.should.equal(1);
        });
    });
  });
});