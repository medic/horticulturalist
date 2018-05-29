Horticulturalist
================

Deploys and manages [Medic](github.com/medic/medic-webapp).

For more detailed documentation on how to start Medic using Horticulturalist, [see this guide](https://github.com/medic/medic-webapp#deploy-locally-using-horticulturalist-beta).

# Usage

## From `npm`

    npm install -g horticulturalist
    COUCH_URL=http://admin:pass@localhost:5984/medic horti --local --install

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

You can also specify a deployment action to perform:

    --install[=buildname|@type]
        Download the latest master (or specified) build and deploy to the
        local db at startup. Buildname can either be an exact build name (eg
        'master'), or @type for the latest of that type (eg @release or @beta).
    --stage[=buildname|@type]
        The same as install, but prepares a deploy and does not actually 
        install and deploy it.
    --complete-install
        Completes a staged install or errors if one does not exist.
    --no-daemon
        Does not start node modules or watch for new installations, but does 
        perform one of the above actions if specified.
