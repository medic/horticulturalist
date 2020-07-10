const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
chai.use(chaiAsPromised);
chai.should();

const sinon = require('sinon').createSandbox();
const DB = require('../../src/dbs');
const install = require('../../src/install'),
      deploySteps = require('../../src/install/deploySteps'),
      warmViews = require('../../src/install/warmViews'),
      utils = require('../../src/utils'),
      ddocWrapper = require('../../src/install/ddocWrapper'),
      fs = require('fs-extra');

describe('Installation flow', () => {
  const deployDoc = () => ({
    _id: 'horti-upgrade',
    user: 'admin',
    build_info: {
      namespace: 'medic',
      application: 'medic',
      version: '1.0.0'
    },
    log: []
  });

  afterEach(() => {
    sinon.restore();
  });

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

      return install._downloadBuild(deployDoc())
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

    it('should work read ddocs from medic.json attachment', () => {
      const newStagedMainDdoc = {
        _id: '_design/:staged:medic',
        _attachments: {
          'ddocs/medic.json': {
            data: Buffer.from(JSON.stringify(compiled))
          }
        }
      };

      DB.app.bulkDocs.resolves([]);

      return install._extractDdocs(newStagedMainDdoc).then(() => {
        DB.app.bulkDocs.callCount.should.equal(1);
        DB.app.bulkDocs.args[0][0].should.deep.equal([{
          _id: '_design/:staged:medic-test'
        }, newStagedMainDdoc]);
      });
    });
  });

  describe('Warming views', () => {
    it('writeProgress should pull progress from active tasks and write it to the deploy doc warm log', () => {
      const activeTasksToProgress = [{
        activeTasks: [
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
        progress: [
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
      }, {
        activeTasks: [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 22, pid: 's-d1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc1', progress: 29, pid: 's-d1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 18, pid: 's-d1-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: ':staged:ddoc2', progress: 36, pid: 's-d2-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc2', progress: 41, pid: 's-d2-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc2', progress: 55, pid: 's-d2-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: 'ddoc1', progress: 87, pid: 'd1-1', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: 'ddoc1', progress: 95, pid: 'd1-3', type: 'indexer'},
        ],
        progress: [
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
      }, {
        activeTasks: [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 49, pid: 's-d1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc1', progress: 65, pid: 's-d1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 38, pid: 's-d1-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: ':staged:ddoc2', progress: 65, pid: 's-d2-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc2', progress: 72, pid: 's-d2-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc2', progress: 81, pid: 's-d2-3', type: 'indexer'},
        ],
        progress: [
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
        ],
      }, {
        activeTasks: [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 72, pid: 's-d1-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc1', progress: 92, pid: 's-d1-2', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 75, pid: 's-d1-3', type: 'indexer'},

          {database: 's1', node: 'n1', design_document: ':staged:ddoc2', progress: 93, pid: 's-d2-1', type: 'indexer'},
          {database: 's2', node: 'n1', design_document: ':staged:ddoc2', progress: 97, pid: 's-d2-2', type: 'indexer'},
        ],
        progress: [
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
        ],
      }, {
        activeTasks: [
          {database: 's1', node: 'n1', design_document: ':staged:ddoc1', progress: 92, pid: 's-d1-1', type: 'indexer'},
          {database: 's3', node: 'n1', design_document: ':staged:ddoc1', progress: 94, pid: 's-d1-3', type: 'indexer'},
        ],
        progress: [
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
      }];

      activeTasksToProgress.forEach(({activeTasks}, idx) => {
        DB.activeTasks.onCall(idx).resolves(activeTasks);
      });
      DB.app.put.resolves({});

      const _deployDoc = deployDoc();
      _deployDoc.log.push({
        type: 'warm_log'
      });

      let p = Promise.resolve();
      activeTasksToProgress.forEach(({progress}) => {
        p = p
          .then(() => warmViews()._writeProgress(_deployDoc))
          .then(() => {
            _deployDoc.log.should.deep.equal([{
              type: 'warm_log',
              indexers: progress
            }]);
          });
      });
      return p;
    });

    it('viewQueries should determine which views to query to correctly warm the DB', () => {
      warmViews()._viewQueries([
        {
          _id: '_design/:staged:no-views'
        },
        {
          _id: '_design/:staged:also-no-views',
          views: {}
        },
        {
          _id: '_design/:staged:some-views',
          views: {
            a_view: 'the map etc'
          }
        },
      ]).should.deep.equal([
        ':staged:some-views/a_view'
      ]);
    });
    it('viewQueries should ignore the lib "view" when finding a view to query', () => {
      warmViews()._viewQueries([
        {
          _id: '_design/:staged:some-views',
          views: {
            lib: 'shared libaries that is not a view even though it is located here',
            yet_another_view: 'the map etc'
          }
        }
      ]).should.deep.equal([
        ':staged:some-views/yet_another_view'
      ]);
    });

    // https://github.com/medic/horticulturalist/issues/39
    it('viewQueries should ignore mango indexes');
    it('we should also warm mango indexes');

    it('should ignore errors from the view warming loop', () => {
      DB.app.query.onCall(0).rejects(new Error('This error should not crash view warming'));
      DB.app.query.onCall(1).resolves();
      DB.app.put.resolves({});
      DB.activeTasks.resolves([]);

      return warmViews()._probeViewsLoop(deployDoc(), [':staged:some-views/a_view'])
        .then(() => {
          DB.app.query.callCount.should.equal(2);
      });
    });
    it('should NOT ignore errors from the query active tasks loop', () => {
      DB.activeTasks.rejects(new Error('This error should crash view warming'));

      return warmViews()._progressLoop(deployDoc(), 0).should.be.rejectedWith('should crash');
    });
  });

  describe('Deploy steps', () => {
    describe('Deploy staged ddocs', () => {
      const steps = deploySteps(null, deployDoc());

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

    describe('updateSymlink', () => {
      let steps,
          deployPathStub;
      const deployPath = function(pathParam) {
        return deployPathStub(this.name, pathParam);
      };

      beforeEach(() => {
        sinon.stub(fs, 'existsSync');
        sinon.stub(fs, 'readlinkSync');
        sinon.stub(fs, 'unlinkSync');
        sinon.stub(fs, 'symlinkSync');

        steps = deploySteps(null, deployDoc());
        deployPathStub = sinon.stub().callsFake((app, pathParam) => ['path', app, pathParam].join('/'));
      });

      it('does nothing if no changed apps', () => {
        return steps._updateSymlink([]).then(() => {
          fs.existsSync.callCount.should.equal(0);
          fs.readlinkSync.callCount.should.equal(0);
          fs.unlinkSync.callCount.should.equal(0);
          fs.symlinkSync.callCount.should.equal(0);
        });
      });

      it('creates `current` symlink', () => {
        fs.existsSync.returns(false);

        const apps = [{
          name: 'app1',
          deployPath: deployPath
        }, {
          name: 'app2',
          deployPath: deployPath
        }];

        return steps._updateSymlink(apps).then(() => {
          deployPathStub.callCount.should.equal(4);
          deployPathStub.args[0].should.deep.equal(['app1', 'current']);
          deployPathStub.args[1].should.deep.equal(['app1', undefined]);
          deployPathStub.args[2].should.deep.equal(['app2', 'current']);
          deployPathStub.args[3].should.deep.equal(['app2', undefined]);

          fs.existsSync.callCount.should.equal(2);
          fs.existsSync.args[0].should.deep.equal(['path/app1/current']);
          fs.existsSync.args[1].should.deep.equal(['path/app2/current']);
          fs.symlinkSync.callCount.should.equal(2);
          fs.symlinkSync.args[0].should.deep.equal(['path/app1/', 'path/app1/current']);
          fs.symlinkSync.args[1].should.deep.equal(['path/app2/', 'path/app2/current']);
        });
      });

      it('overwrites existing `current` symlink', () => {
        const apps = [{
          name: 'app1',
          deployPath: deployPath
        }, {
          name: 'app2',
          deployPath: deployPath
        }];

        fs.existsSync.returns(false);
        fs.existsSync.withArgs('path/app1/current').returns(true);
        fs.existsSync.withArgs('path/app2/current').returns(true);

        fs.readlinkSync.callsFake(path => `actual-${path}`);

        return steps._updateSymlink(apps).then(() => {
          deployPathStub.callCount.should.equal(4);
          deployPathStub.args[0].should.deep.equal(['app1', 'current']);
          deployPathStub.args[1].should.deep.equal(['app1', undefined]);
          deployPathStub.args[2].should.deep.equal(['app2', 'current']);
          deployPathStub.args[3].should.deep.equal(['app2', undefined]);

          fs.existsSync.callCount.should.equal(4);
          fs.existsSync.args[0].should.deep.equal(['path/app1/current']);
          fs.existsSync.args[1].should.deep.equal(['actual-path/app1/current']);
          fs.existsSync.args[2].should.deep.equal(['path/app2/current']);
          fs.existsSync.args[3].should.deep.equal(['actual-path/app2/current']);

          fs.symlinkSync.callCount.should.equal(2);
          fs.symlinkSync.args[0].should.deep.equal(['path/app1/', 'path/app1/current']);
          fs.symlinkSync.args[1].should.deep.equal(['path/app2/', 'path/app2/current']);

          fs.unlinkSync.callCount.should.equal(2);
          fs.unlinkSync.args[0].should.deep.equal(['path/app1/current']);
          fs.unlinkSync.args[1].should.deep.equal(['path/app2/current']);
        });
      });

      it('overwrites existing `old` symlink', () => {
        const apps = [{
          name: 'app1',
          deployPath: deployPath
        }, {
          name: 'app2',
          deployPath: deployPath
        }];

        fs.existsSync.returns(true);
        fs.readlinkSync.callsFake(path => `actual-${path}`);

        return steps._updateSymlink(apps).then(() => {
          deployPathStub.callCount.should.equal(6);
          deployPathStub.args[0].should.deep.equal(['app1', 'current']);
          deployPathStub.args[1].should.deep.equal(['app1', 'old']);
          deployPathStub.args[2].should.deep.equal(['app1', undefined]);
          deployPathStub.args[3].should.deep.equal(['app2', 'current']);
          deployPathStub.args[4].should.deep.equal(['app2', 'old']);
          deployPathStub.args[5].should.deep.equal(['app2', undefined]);

          fs.existsSync.callCount.should.equal(6);
          fs.existsSync.args[0].should.deep.equal(['path/app1/current']);
          fs.existsSync.args[1].should.deep.equal(['actual-path/app1/current']);
          fs.existsSync.args[2].should.deep.equal(['path/app1/old']);
          fs.existsSync.args[3].should.deep.equal(['path/app2/current']);
          fs.existsSync.args[4].should.deep.equal(['actual-path/app2/current']);
          fs.existsSync.args[5].should.deep.equal(['path/app2/old']);

          fs.symlinkSync.callCount.should.equal(4);
          fs.symlinkSync.args[0].should.deep.equal(['actual-path/app1/current', 'path/app1/old']);
          fs.symlinkSync.args[1].should.deep.equal(['path/app1/', 'path/app1/current']);
          fs.symlinkSync.args[2].should.deep.equal(['actual-path/app2/current', 'path/app2/old']);
          fs.symlinkSync.args[3].should.deep.equal(['path/app2/', 'path/app2/current']);


          fs.unlinkSync.callCount.should.equal(4);
          fs.unlinkSync.args[0].should.deep.equal(['path/app1/old']);
          fs.unlinkSync.args[1].should.deep.equal(['path/app1/current']);
          fs.unlinkSync.args[2].should.deep.equal(['path/app2/old']);
          fs.unlinkSync.args[3].should.deep.equal(['path/app2/current']);
        });
      });
    });
  });

  describe('Post cleanup', () => {
    const ddoc = ddocWrapper(null, {});

    beforeEach(() => {
      sinon.stub(fs, 'existsSync');
      sinon.stub(fs, 'readlinkSync');
      sinon.stub(fs, 'removeSync');
      sinon.stub(fs, 'unlinkSync');
    });

    it('deletes docs used in deploy', () => {
      DB.app.put.resolves();
      DB.app.allDocs.resolves({rows: [{id: 'foo', value: {rev: '1-bar'}}]});
      DB.app.bulkDocs.resolves([]);
      DB.app.viewCleanup.resolves();
      sinon.stub(ddoc, 'getApps').returns([]);

      return install._postCleanup(ddoc, deployDoc())
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
          ddoc.getApps.callCount.should.equal(1);
        });
    });

    it('should delete old apps', () => {
      DB.app.put.resolves();
      DB.app.allDocs.resolves({rows: [{id: 'foo', value: {rev: '1-bar'}}]});
      DB.app.bulkDocs.resolves([]);
      DB.app.viewCleanup.resolves();
      const app1 = { deployPath: sinon.stub().callsFake(path => `${path}-1-path`) },
            app2 = { deployPath: sinon.stub().callsFake(path => `${path}-2-path`) },
            app3 = { deployPath: sinon.stub().callsFake(path => `${path}-3-path`) };
      sinon.stub(ddoc, 'getApps').returns([app1, app2, app3]);

      fs.existsSync
        .withArgs('old-1-path').returns(true)
        .withArgs('old-2-path').returns(true)
        .withArgs('old-3-path').returns(false)
        .withArgs('prev-1-path').returns(true)
        .withArgs('prev-2-path').returns(false);

      fs.readlinkSync
        .withArgs('old-1-path').returns('prev-1-path')
        .withArgs('old-2-path').returns('prev-2-path');

      return install
        ._postCleanup(ddoc, deployDoc())
        .then(() => {
          ddoc.getApps.callCount.should.equal(1);
          app1.deployPath.callCount.should.equal(1);
          fs.existsSync.withArgs('old-1-path').callCount.should.equal(1);
          fs.readlinkSync.withArgs('old-1-path').callCount.should.equal(1);
          fs.existsSync.withArgs('prev-1-path').callCount.should.equal(1);
          fs.removeSync.withArgs('prev-1-path').callCount.should.equal(1);
          fs.unlinkSync.withArgs('old-1-path').callCount.should.equal(1);

          app2.deployPath.callCount.should.equal(1);
          fs.existsSync.withArgs('old-2-path').callCount.should.equal(1);
          fs.readlinkSync.withArgs('old-2-path').callCount.should.equal(1);
          fs.existsSync.withArgs('prev-2-path').callCount.should.equal(1);
          fs.removeSync.withArgs('prev-2-path').callCount.should.equal(0);
          fs.unlinkSync.withArgs('old-2-path').callCount.should.equal(1);

          app3.deployPath.callCount.should.equal(1);
          fs.existsSync.withArgs('old-3-path').callCount.should.equal(1);
          fs.readlinkSync.withArgs('old-3-path').callCount.should.equal(0);
        });
    });
  });
});
