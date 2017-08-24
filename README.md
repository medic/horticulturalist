Horticulturalist
================

Deploys and manages [Medic](github.com/medic/medic-webapp).

# Usage

## From `npm`

	npm install horticulturalist
	COUCH_NODE_NAME=couchdb@localhost COUCH_URL=http://admin:pass@localhost:5984/medic horti --local --bootstrap

## From source

	COUCH_URL=http://admin:pass@localhost:5984/medic node src/index.js --dev

# Options

Pick one mode to run in:

    --local
        If you don't know which one you want, you want this one. For general
        local use. Deploys applications to a hidden directory in your home
        folder.
    --dev
        Runs horti in 'dev' mode, directly out of the given directory under a
        'temp' directory. For developers and for use while developing horti.
    --medic-os
        Only of interest to those who deploy using MedicOS. Deploys apps using
        the MedicOS' daemon.

Additional options:

    --bootstrap[=buildname]
        Download the latest master (or specified) build and deploy to the
        local db at startup.
