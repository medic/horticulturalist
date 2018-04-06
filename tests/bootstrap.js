require('chai').should();

const sinon = require('sinon').sandbox.create();
const DB = require('../src/dbs');
const bootstrap = require('../src/bootstrap');

describe('Bootstrap', () => {
  afterEach(() => sinon.restore());
  beforeEach(() => {
    sinon.stub(DB.app, 'get');
    sinon.stub(DB.app, 'put');
    sinon.stub(DB.builds, 'query');

    DB.app.put.resolves();
  });

  it('creates an upgrade doc with a known version', () => {
    DB.app.get.rejects({status: 404});
    return bootstrap.bootstrap('1.0.0')
      .then(deployDoc => {
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._id.should.equal('horti-upgrade');
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'medic',
          application: 'medic',
          version: '1.0.0'
        });

        deployDoc.should.deep.equal(DB.app.put.args[0][0]);
      });
  });

  it('finds out the latest version if a version type is given', () => {
    DB.app.get.rejects({status: 404});
    DB.builds.query.resolves({rows: [{
      id: 'medic:medic:1.0.0'
    }]});

    return bootstrap.bootstrap('@release')
      .then(() => {
        DB.builds.query.callCount.should.equal(1);
        DB.builds.query.args[0][0].should.equal('builds/releases');
        DB.builds.query.args[0][1].startkey.should.deep.equal(['release', 'medic', 'medic', {}]);
        DB.builds.query.args[0][1].endkey.should.deep.equal(['release', 'medic', 'medic']);
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._id.should.equal('horti-upgrade');
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'medic',
          application: 'medic',
          version: '1.0.0'
        });
      });
  });

  it('Re-writes an existing deploy doc first', () => {
    DB.app.get.resolves({_id: 'existing-doc', _rev: 'some-rev'});

    return bootstrap.bootstrap('1.0.0')
      .then(() => {
        DB.app.get.callCount.should.equal(1);
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._rev.should.equal('some-rev');
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'medic',
          application: 'medic',
          version: '1.0.0'
        });
      });
  });
});
