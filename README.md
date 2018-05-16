Horticulturalist
================

Deploys and manages [Medic](github.com/medic/medic-webapp).

For more detailed documentation on how to start Medic using Horticulturalist, [see this guide](https://github.com/medic/medic-webapp#deploy-locally-using-horticulturalist-beta).

# Usage

## From `npm`

    npm install horticulturalist
    COUCH_URL=http://admin:pass@localhost:5984/medic horti --local --bootstrap

## From source

	COUCH_URL=http://admin:pass@localhost:5984/medic node src --dev

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
        the MedicOS daemon.

Additional options:

    --bootstrap[=buildname|@type]
        Download the latest master (or specified) build and deploy to the
        local db at startup. Buildname can either be an exact build name (eg
        'master'), or @type for the latest of that type (eg @release or @beta).
    --only-bootstrap[=buildname|@type]
        Like above this bootstraps to the given build, but doesn't start the 
        daemon or deploy any applications
