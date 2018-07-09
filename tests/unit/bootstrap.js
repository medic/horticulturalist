const chai = require("chai");
const chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);

const should = chai.should();

const sinon = require('sinon').sandbox.create();
const DB = require('../../src/dbs');
const packageUtils = require('../../src/package');
const bootstrap = require('../../src/bootstrap');

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
    return bootstrap.install(packageUtils.parse('test:test:1.0.0'))
      .then(deployDoc => {
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._id.should.equal('horti-upgrade');
        DB.app.put.args[0][0].action.should.equal('install');
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'test',
          application: 'test',
          version: '1.0.0'
        });

        deployDoc.should.deep.equal(DB.app.put.args[0][0]);
      });
  });

  it('creates an upgrade doc with a known version set to stage', () => {
    DB.app.get.rejects({status: 404});
    DB.app.put.resolves({rev: '1-some-rev'});
    return bootstrap.stage(packageUtils.parse('test:test:1.0.0'))
      .then(deployDoc => {
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._id.should.equal('horti-upgrade');
        DB.app.put.args[0][0].action.should.equal('stage');
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'test',
          application: 'test',
          version: '1.0.0'
        });

        deployDoc.should.deep.equal(DB.app.put.args[0][0]);
      });
  });

  it('finds out the latest version if a channel is given', () => {
    DB.app.get.rejects({status: 404});
    DB.app.put.resolves({rev: '1-some-rev'});
    DB.builds.query.resolves({rows: [{
      id: 'test:test:1.0.0'
    }]});

    return bootstrap.install(packageUtils.parse('@test:test:release'))
      .then(() => {
        DB.builds.query.callCount.should.equal(1);
        DB.builds.query.args[0][0].should.equal('builds/releases');
        DB.builds.query.args[0][1].startkey.should.deep.equal(['release', 'test', 'test', {}]);
        DB.builds.query.args[0][1].endkey.should.deep.equal(['release', 'test', 'test']);
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._id.should.equal('horti-upgrade');
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'test',
          application: 'test',
          version: '1.0.0'
        });
      });
  });

  it('Re-writes an existing deploy doc if it exists', () => {
    DB.app.get.resolves({_id: 'existing-doc', _rev: 'some-rev', extra: 'data'});
    DB.app.put.resolves({rev: '1-some-rev'});

    return bootstrap.install(packageUtils.parse('test:test:1.0.0'))
      .then(() => {
        DB.app.get.callCount.should.equal(1);
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0]._rev.should.equal('1-some-rev');
        should.not.exist(DB.app.put.args[0][0].extra);
        DB.app.put.args[0][0].build_info.should.deep.equal({
          namespace: 'test',
          application: 'test',
          version: '1.0.0'
        });
      });
  });

  it('Errors if you try to complete when there is no existing deploy doc', () => {
    DB.app.get.rejects({status: 404});
    return bootstrap.complete()
      .should.be.rejectedWith(/no installation to complete/);
  });

  it('Errors if you try to complete when the existing deploy is not ready', () => {
    DB.app.get.resolves({_id: 'horti-upgrade', _rev: 'some-rev'});

    return bootstrap.complete()
      .should.be.rejectedWith(/not ready to complete/);
  });

  it('Transitions a staged deploy into a real one', () => {
    DB.app.get.resolves({_id: 'horti-upgrade', _rev: 'some-rev', staging_complete: true});
    DB.app.put.resolves({rev: '1-some-rev'});

    return bootstrap.complete()
      .then(() => {
        DB.app.put.callCount.should.equal(1);
        DB.app.put.args[0][0].action.should.equal('complete');
      });
  });
});
