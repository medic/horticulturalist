const should = require('chai').should();

const sinon = require('sinon').sandbox.create();
const DB = require('../src/dbs');
const bootstrap = require('../src/bootstrap');

describe('Bootstrap', () => {
  afterEach(() => sinon.restore());
  beforeEach(() => {
    DB.app.get = sinon.stub();
    DB.app.put = sinon.stub();
    DB.builds.query = sinon.stub();
  });

  it('creates an upgrade doc with a known version', () => {
    DB.app.get.rejects({status: 404});
    DB.app.put.resolves({rev: '1-some-rev'});
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
    DB.app.put.resolves({rev: '1-some-rev'});
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

  it('Re-writes an existing deploy doc if it exists', () => {
    DB.app.get.resolves({_id: 'existing-doc', _rev: 'some-rev', extra: 'data'});
    DB.app.put.resolves({rev: '1-some-rev'});

    return bootstrap.bootstrap('1.0.0')
      .then(() => {
        DB.app.get.callCount.should.equal(1);
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._rev.should.equal('1-some-rev');
        should.not.exist(DB.app.put.args[0][0].extra);
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'medic',
          application: 'medic',
          version: '1.0.0'
        });
      });
  });
});
