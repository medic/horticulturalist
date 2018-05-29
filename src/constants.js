module.exports = {
  LEGACY_0_8_UPGRADE_DOC: '_design/medic:staged',
  HORTI_UPGRADE_DOC: 'horti-upgrade',
  ACTIONS: {
    // A complete installation from start to finish. End result is a deleted
    // HORTI_UPGRADE_DOC and the system running on the new version.
    INSTALL: 'install',
    // A partial installation that aims to complete as much work as possible
    // without actually deploying to the new version. End result is the
    // HORTI_UPGRADE_DOC being marked as `staging_complete`, ready to be
    // COMPLETEd.
    STAGE: 'stage',
    // Completes a STAGEd installation. The expectation is that an installation
    // has already been STAGEd and is ready to be deployed. This expectation is
    // maintined in the api that writes the HORTI_UPGRADE_DOC.
    COMPLETE: 'complete'
  }
};
