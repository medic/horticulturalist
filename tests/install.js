require('chai').should();

const sinon = require('sinon').sandbox.create();
const DB = require('../src/dbs');
const install = require('../src/install');

describe('Installation flow', () => {
  const deployDoc = {
    _id: 'horti-upgrade',
    creator: 'admin',
    build_info: {
      namespace: 'medic',
      application: 'medic',
      version: '1.0.0'
    }
  };

  afterEach(() => sinon.restore());
  beforeEach(() => {
    sinon.stub(DB.builds, 'get');
    sinon.stub(DB.app, 'put');
    sinon.stub(DB.app, 'get');
    sinon.stub(DB.app, 'remove');
  });

  describe('Pre cleanup', () => {
    it('deletes docs left over from previous (bad) deploys', () => {
      DB.app.get.resolves();
      DB.app.put.resolves();
      return install._preCleanup()
        .then(() => {
          DB.app.get.callCount.should.equal(1);
          DB.app.remove.callCount.should.equal(1);
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

          // actual._id.should.equal('_design/1.0.0:medic:staging');
          actual._id.should.equal('_design/medic:staging');
          actual._rev.should.equal('1-somerev');
          actual.deploy_info.user.should.equal('admin');
          actual.deploy_info.version.should.equal('1.0.0');
        });
    });
  });

  describe('Post cleanup', () => {
    it('deletes docs used in deploy', () => {
      DB.app.put.resolves();
      return install._postCleanup(deployDoc)
        .then(() => {
          DB.app.put.callCount.should.equal(1);
          DB.app.put.args[0][0]._id.should.equal('horti-upgrade');
          DB.app.put.args[0][0]._deleted.should.equal(true);
        });
    });
  });
});
