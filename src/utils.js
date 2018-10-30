const { debug } = require('./log');

const DB = require('./dbs');

//
// TODO: work out how this should really work
//
// DB.app.bulkDocs calls can time out.
//
// It's not clear if getting a ESOCKETTIMEOUT will *always* result in eventual
// successful writes, or just sometimes. In local testing it has been always,
// but that's not definite.
//
// If it's always, we could re-write this as a promise loop that blocks by
// checking allDocs every few seconds to see if all staged ddocs are present in
// the DB before continuing.
//
// If it's sometimes, this code is mostly correct. However, only because at this
// stage we know that preDeployCleanup has been called, and so any staged ddocs
// present in the system should be from this deploy. If we wish to be more sure
// we might need to make sure the ones in CouchDB are the ones in memory, by
// checking hashes or just forcing a write from us.
//
const writeDocsInSeries = docs => {
  return docs.reduce((promise, doc) => promise
    .then(() => debug(`Updating ${doc._id}`))
    .then(() => DB.app.get(doc._id))
    .catch(err => {
      if (err.status !== 404) {
        throw err;
      }
     })
    .then(existingDoc => {
      if (!existingDoc) {
        debug(`${doc._id} doesn't exist (yet), writing`);
        delete doc._rev;

        return DB.app.put(doc).catch(err => {
          // Already exists, the bulkDocs must have written it in the time
          // between our get and our put
          if (err.status !== 409) {
            throw err;
          }
        });
      }
    }),
    Promise.resolve());
};

// Like getDdocs, but instead of doing it in one go tries to break it
// up. This will be slower but less likely to cause timeouts.
const getDdocsSlower = (ddocSuffix, attachments) => {
  debug('Falling back onto getting staged ddocs in a slower, safer way');
  debug('Getting list of ddocs');
  return DB.app.allDocs({
    startkey: `_design/${ddocSuffix}`,
    endkey: `_design/${ddocSuffix}\ufff0`
  }).then(({rows}) => {
    const ids = rows.map(r => r.id);

    const fetchedDocuments = [];
    return ids.reduce((promise, id) => promise
      .then(() => debug(`Individually fetching ${id}`))
      .then(() => DB.app.get(id, {attachments: attachments, binary: attachments}))
      .then(doc => fetchedDocuments.push(doc)),
      Promise.resolve()
    ).then(() => fetchedDocuments);
  });
};

module.exports = {
  mainDdocId: deployDdoc => `_design/${deployDdoc.build_info.application}`,
  getStagedDdocId: id => id.replace('_design/', '_design/:staged:'),
  getDeployedDdocId: id => id.replace(':staged:', ''),
  stageDdoc: doc => {
    doc._id = module.exports.getStagedDdocId(doc._id);
    delete doc._rev;

    return doc;
  },
  getStagedDdocs: (includeDocs, attachments) => module.exports.getDdocs(':staged:', includeDocs, attachments),
  getDdocs: (ddocSuffix, includeDocs, attachments) => {
    return DB.app.allDocs({
      startkey: `_design/${ddocSuffix}`,
      endkey: `_design/${ddocSuffix}\ufff0`,
      include_docs: includeDocs,
      attachments: attachments,
      binary: attachments
    }).then(({rows}) => {
      if (includeDocs) {
        return rows.map(r => r.doc);
      } else {
        return rows.map(r => ({
          _id: r.id,
          _rev: r.value.rev
        }));
      }
    }).catch(err => {
      if (err.error === 'timeout' && includeDocs) {
        return getDdocsSlower(ddocSuffix, attachments);
      } else {
        throw err;
      }
    });
  },
  appendDeployLog: (deployDoc, message, type='stage') => {
    if (!deployDoc.log) {
      deployDoc.log = [];
    }

    deployDoc.log.push({
      type: type,
      datetime: new Date().getTime(),
      message: message
    });

    return module.exports.update(deployDoc);
  },
  update: doc => {
    return DB.app.put(doc).then(({rev}) => {
      doc._rev = rev;
      return doc;
    });
  },
  betterBulkDocs: docs => {
    return DB.app.bulkDocs(docs)
      .then(result => {
        const errors = result.filter(r => r.error);

        if (errors.length) {
          const error = Error('bulkDocs did not complete successfully');
          error.errors = errors;
          throw error;
        }

        return result;
      })
      .catch(err => {
        if (err.code === 'EPIPE') {
          err.horticulturalist = `Failed to perform bulk docs, you may need to increase CouchDB's max_http_request_size`;
          throw err;
        }

        if (err.code === 'ESOCKETTIMEDOUT') {
          debug('Bulk docs timed out, attempting to write one by one');
          return writeDocsInSeries(docs);
        }
      });
  }
};
