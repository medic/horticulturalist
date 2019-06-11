const chai = require('chai');
const sinon = require('sinon');

const ddocWrapper = require('../../src/install/ddocWrapper');
const fs = require('fs-extra');
const path = require('path');

describe('DDOC wrapper', () => {
  afterEach(() => sinon.restore());

  it('should return the correct object', () => {
    const wrapped = ddocWrapper({ my: 'ddoc' }, 'my-mode');
    chai.expect(wrapped.ddoc).to.deep.equal({ my: 'ddoc' });
    chai.expect(wrapped.mode).to.equal('my-mode');
    chai.expect(wrapped.getChangedApps).to.be.a('function');
    chai.expect(wrapped.getApps).to.be.a('function');
    chai.expect(wrapped.unzipChangedApps).to.be.a('function');
  });

  describe('getApps', () => {
    it('should return all legacy ddoc apps', () => {
      const ddoc = {
        _id: 'some_ddoc',
        node_modules: 'one-0.1.0.tgz,two-0.1.0.tgz',
        _attachments: {
          'one-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-onedigest'
          },
          'two-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest'
          },
          three: {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest'
          }
        }
      };

      const wrapped = ddocWrapper(ddoc, 'my-mode');
      const apps = wrapped.getApps();
      chai.expect(apps.length).to.equal(2);
      chai.expect(apps[0]).to.deep.include({
        name: 'one',
        attachmentName: 'one-0.1.0.tgz',
        digest: 'md5-onedigest'
      });
      chai.expect(apps[1]).to.deep.include({
        name: 'two',
        attachmentName: 'two-0.1.0.tgz',
        digest: 'md5-twodigest'
      });
    });

    it('should return all ddoc apps', () => {
      const ddoc = {
        _id: 'some_ddoc',
        build_info: {
          node_modules: [
            'one-0.1.0.tgz',
            'two-0.1.0.tgz'
          ]
        },
        _attachments: {
          'one-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-onedigest'
          },
          'two-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest'
          },
          three: {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest'
          }
        }
      };

      const wrapped = ddocWrapper(ddoc, 'my-mode');
      const apps = wrapped.getApps();
      chai.expect(apps.length).to.equal(2);
      chai.expect(apps[0]).to.deep.include({
        name: 'one',
        attachmentName: 'one-0.1.0.tgz',
        digest: 'md5-onedigest'
      });
      chai.expect(apps[1]).to.deep.include({
        name: 'two',
        attachmentName: 'two-0.1.0.tgz',
        digest: 'md5-twodigest'
      });
    });

    it('should crash when an app is not found', () => {
      const ddoc = {
        _id: 'some_ddoc',
        build_info: {
          node_modules: [
            'one-0.1.0.tgz',
          ]
        },
        _attachments: {
          'two-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest'
          },
          three: {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest'
          }
        }
      };
      const wrapped = ddocWrapper(ddoc, 'my-mode');
      chai.expect(wrapped.getApps).to.throw('one-0.1.0.tgz was specified in build_info.node_modules but is not attached');
    });
  });

  describe('getChangedApps', () => {
    const ddoc = {
      _id: 'some_ddoc',
      build_info: {
        node_modules: [
          'one-0.1.0.tgz',
          'two-0.1.0.tgz'
        ]
      },
      _attachments: {
        'one-0.1.0.tgz': {
          content_type: 'application/octet-stream',
          digest: 'md5-onedigest'
        },
        'two-0.1.0.tgz': {
          content_type: 'application/octet-stream',
          digest: 'md5-twodigest'
        }
      }
    };

    it('should return all apps when deployment is fresh', () => {
      const wrapped = ddocWrapper(ddoc, { deployments: 'dir' });
      sinon.stub(fs, 'existsSync').returns(false);
      sinon.stub(path, 'resolve').callsFake(path => path);

      const apps = wrapped.getChangedApps();
      chai.expect(apps.length).to.equal(2);
      chai.expect(apps[0]).to.deep.include({
        name: 'one',
        attachmentName: 'one-0.1.0.tgz',
        digest: 'md5-onedigest'
      });
      chai.expect(apps[1]).to.deep.include({
        name: 'two',
        attachmentName: 'two-0.1.0.tgz',
        digest: 'md5-twodigest'
      });
      chai.expect(fs.existsSync.callCount).to.equal(2);
      chai.expect(fs.existsSync.args[0]).to.deep.equal(['dir/one/current']);
      chai.expect(fs.existsSync.args[1]).to.deep.equal(['dir/two/current']);
    });

    it('should return all apps when deployment is updated', () => {
      const wrapped = ddocWrapper(ddoc, { deployments: 'dir' });
      sinon.stub(fs, 'existsSync').returns(true);
      sinon.stub(fs, 'readlinkSync');
      fs.readlinkSync.withArgs('dir/one/current').returns('dir/one/md5-onedigest-old');
      fs.readlinkSync.withArgs('dir/two/current').returns('dir/two/md5-twodigest-old');
      sinon.stub(path, 'resolve').callsFake(path => path);

      const apps = wrapped.getChangedApps();
      chai.expect(apps.length).to.equal(2);
      chai.expect(apps[0]).to.deep.include({
        name: 'one',
        attachmentName: 'one-0.1.0.tgz',
        digest: 'md5-onedigest'
      });
      chai.expect(apps[1]).to.deep.include({
        name: 'two',
        attachmentName: 'two-0.1.0.tgz',
        digest: 'md5-twodigest'
      });
      chai.expect(fs.existsSync.callCount).to.equal(4);
      chai.expect(fs.existsSync.args[0]).to.deep.equal(['dir/one/current']);
      chai.expect(fs.existsSync.args[1]).to.deep.equal(['dir/one/md5-onedigest-old']);
      chai.expect(fs.existsSync.args[2]).to.deep.equal(['dir/two/current']);
      chai.expect(fs.existsSync.args[3]).to.deep.equal(['dir/two/md5-twodigest-old']);
      chai.expect(fs.readlinkSync.callCount).to.equal(2);
    });

    it('should only return changed apps', () => {
      const ddoc = {
        _id: 'some_ddoc',
        build_info: {
          node_modules: [
            'one-0.1.0.tgz',
            'two-0.1.0.tgz'
          ]
        },
        _attachments: {
          'one-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-onedigest-new'
          },
          'two-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest-old'
          }
        }
      };

      const wrapped = ddocWrapper(ddoc, { deployments: 'dir' });
      sinon.stub(fs, 'existsSync').returns(true);
      sinon.stub(fs, 'readlinkSync');
      fs.readlinkSync.withArgs('dir/one/current').returns('dir/one/md5-onedigest-old');
      fs.readlinkSync.withArgs('dir/two/current').returns('dir/two/md5-twodigest-old');
      sinon.stub(path, 'resolve').callsFake(path => path);

      const apps = wrapped.getChangedApps();
      chai.expect(apps.length).to.equal(1);
      chai.expect(apps[0]).to.deep.include({
        name: 'one',
        attachmentName: 'one-0.1.0.tgz',
        digest: 'md5-onedigest-new'
      });

      chai.expect(fs.existsSync.callCount).to.equal(4);
      chai.expect(fs.existsSync.args[0]).to.deep.equal(['dir/one/current']);
      chai.expect(fs.existsSync.args[1]).to.deep.equal(['dir/one/md5-onedigest-old']);
      chai.expect(fs.existsSync.args[2]).to.deep.equal(['dir/two/current']);
      chai.expect(fs.existsSync.args[3]).to.deep.equal(['dir/two/md5-twodigest-old']);
      chai.expect(fs.readlinkSync.callCount).to.equal(2);
    });

    it('should return app when current symlink exists but the folder is missing (recover from failed upgrade?)', () => {
      const ddoc = {
        _id: 'some_ddoc',
        build_info: {
          node_modules: [
            'one-0.1.0.tgz',
            'two-0.1.0.tgz'
          ]
        },
        _attachments: {
          'one-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-onedigest-new'
          },
          'two-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest-old'
          }
        }
      };

      const wrapped = ddocWrapper(ddoc, { deployments: 'dir' });
      sinon.stub(fs, 'existsSync')
        .returns(true)
        .withArgs('dir/two/md5-twodigest-old').returns(false);

      sinon.stub(fs, 'readlinkSync');
      fs.readlinkSync.withArgs('dir/one/current').returns('dir/one/md5-onedigest-old');
      fs.readlinkSync.withArgs('dir/two/current').returns('dir/two/md5-twodigest-old');
      sinon.stub(path, 'resolve').callsFake(path => path);

      const apps = wrapped.getChangedApps();
      chai.expect(apps.length).to.equal(2);
      chai.expect(apps[0]).to.deep.include({
        name: 'one',
        attachmentName: 'one-0.1.0.tgz',
        digest: 'md5-onedigest-new'
      });
      chai.expect(apps[1]).to.deep.include({
        name: 'two',
        attachmentName: 'two-0.1.0.tgz',
        digest: 'md5-twodigest-old'
      });
      chai.expect(fs.existsSync.callCount).to.equal(4);
      chai.expect(fs.existsSync.args[0]).to.deep.equal(['dir/one/current']);
      chai.expect(fs.existsSync.args[1]).to.deep.equal(['dir/one/md5-onedigest-old']);
      chai.expect(fs.existsSync.args[2]).to.deep.equal(['dir/two/current']);
      chai.expect(fs.existsSync.args[3]).to.deep.equal(['dir/two/md5-twodigest-old']);
    });

    it('should return no apps when no updates', () => {
      const wrapped = ddocWrapper(ddoc, { deployments: 'dir' });
      sinon.stub(fs, 'existsSync').returns(true);
      sinon.stub(fs, 'readlinkSync');
      fs.readlinkSync.withArgs('dir/one/current').returns('dir/one/md5-onedigest');
      fs.readlinkSync.withArgs('dir/two/current').returns('dir/two/md5-twodigest');
      sinon.stub(path, 'resolve').callsFake(path => path);
      const apps = wrapped.getChangedApps();
      chai.expect(apps.length).to.equal(0);
      chai.expect(fs.existsSync.callCount).to.equal(4);
      chai.expect(fs.existsSync.args[0]).to.deep.equal(['dir/one/current']);
      chai.expect(fs.existsSync.args[1]).to.deep.equal(['dir/one/md5-onedigest']);
      chai.expect(fs.existsSync.args[2]).to.deep.equal(['dir/two/current']);
      chai.expect(fs.existsSync.args[3]).to.deep.equal(['dir/two/md5-twodigest']);
    });
  });

  describe('unzipChangedApps', () => {
    it('should not do anything when apps list is empty', () => {
      sinon.stub(fs, 'writeFile').resolves();
      const wrapped = ddocWrapper({ my: 'ddoc' }, 'my-mode');
      wrapped.unzipChangedApps([]);
      chai.expect(fs.writeFile.callCount).to.equal(0);
    });

    it('should not unzip apps that are already unzipped', () => {
      const ddoc = {
        _id: 'some_ddoc',
        build_info: {
          node_modules: [
            'one-0.1.0.tgz',
            'two-0.1.0.tgz'
          ]
        },
        _attachments: {
          'one-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-onedigest',
            data: 'my-one-dependency'
          },
          'two-0.1.0.tgz': {
            content_type: 'application/octet-stream',
            digest: 'md5-twodigest',
            data: 'my-two-dependency'
          }
        }
      };
      const wrapped = ddocWrapper(ddoc, { deployments: 'dir' });
      const apps = wrapped.getApps(); // using getApps instead of getChangedApps to avoid stubbing all fs calls
      chai.expect(apps.length).to.equal(2);
      sinon.stub(fs, 'existsSync').returns(true);
      sinon.stub(path, 'resolve').callsFake(path => path);
      wrapped.unzipChangedApps(apps);
      chai.expect(fs.existsSync.callCount).to.equal(2);
      chai.expect(fs.existsSync.args[0]).to.deep.equal(['dir/one/md5-onedigest']);
      chai.expect(fs.existsSync.args[1]).to.deep.equal(['dir/two/md5-twodigest']);
    });
  });
});
