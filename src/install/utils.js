const DB = require('../dbs');

module.exports = {
  mainDdocId: deployDdoc => `_design/${deployDdoc.build_info.application}`,
  getStagedDdocId: id => id.replace('_design/', '_design/:staged:'),
  getDeployedDdocId: id => id.replace(':staged:', ''),
  stageDdoc: doc => {
    doc._id = module.exports.getStagedDdocId(doc._id);
    delete doc._rev;

    return doc;
  },
  getStagedDdocs: (includeDocs, attachments) =>
    DB.app.allDocs({
      startkey: '_design/:staged:',
      endkey: '_design/:staged:\ufff0',
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
    }),
};
