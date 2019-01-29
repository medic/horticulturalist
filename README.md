Horticulturalist
================

Deploys and manages [Medic](https://github.com/medic/medic).

For more detailed documentation on how to start Medic using Horticulturalist, [see this guide](https://github.com/medic/medic#deploy-locally-using-horticulturalist-beta).

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

    --install[=build|channel]
        Download the latest master (or specified) build and deploy to the
        local db at startup. Alternatively specify a channel to download the
        latest release from that channel.
    --stage[=build|channel]
        The same as install, but only prepares the deploy while not actually 
        installing or deploying it.
    --complete-install
        Completes a staged install or errors if one does not exist.
    --no-daemon
        Does not start node modules or watch for new installations, but does 
        perform one of the above actions if specified.


# Builds and Channels

A build is an fully qualified name that points to a specific release. A channel specifies a type of release, of which there may be many, and in the context of installations maps to the latest of those releases.

An example of a build is `medic:medic:2.14.0`. An example of a channel would be `@medic:medic:release`. When installing, this channel would be set to install the latest version in the release channel.

There are two ways to write builds and channels, full and Medic-only.

The full format contains both the namespace and application name of what you wish to deploy: `foo:bar:1.0.0` would install the `bar` application at version `1.0.0` from the `foo` namespace. The Medic-only version is just the version section, and is so `1.0.0` is equivilent to `medic:medic:1.0.0`.

Similarly, if you wish to specific a certain type (e.g. `@release`), the full format would be `@foo:bar:release`.

The Medic-only formatting may go away at some point, it's just convenient for now!

## Releasing

Horti follows semver. Releasing is currently a manual process:
 - All tests in master should pass!
 - Tag the release, increasing the patch, minor or major depending on what's changed.
 - Publish to npm with `npm publish`. If you don't have access ask someone in Slack.
