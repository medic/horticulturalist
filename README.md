Horticulturalist
================

Deploys and manages [CHT applications](https://github.com/medic/cht-core). 

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
        When running this from within medic-os, if horticulturalist, medic-api,
        etc are already installed and running, you need to stop them using 
        `svc-stop` before running this.  You will also need to delete directories
        where medic-api/medic-sentinel are installed before running this.

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
 
# Example

[Horticulturalist](https://github.com/medic/horticulturalist) is an easy way to deploy CHT Core applications locally if you're not going to be developing against it.

To use it locally:

- Install, [configure](https://github.com/medic/cht-core/blob/master/DEVELOPMENT.md#setup-couchdb-on-a-single-node) and [secure](https://github.com/medic/cht-core/blob/master/DEVELOPMENT.md#enabling-a-secure-couchdb) CouchDB
- Install [npm](https://npms.io/)
- Install Horticulturalist with `npm install -g horticulturalist`

Use the `horti` tool to bootstrap CHT and launch it:

```shell
COUCH_NODE_NAME=couchdb@localhost COUCH_URL=http://myAdminUser:myAdminPass@localhost:5984/medic horti --local --bootstrap
```

This will download, configure and install the latest Master build of medic. If you're looking to deploy a specific version, provide it to the `bootstrap` command:

```shell
COUCH_NODE_NAME=couchdb@localhost COUCH_URL=http://myAdminUser:myAdminPass@localhost:5984/medic horti --local --bootstrap=3.0.0-beta.1
```

To kill Horti hit CTRL+C. To start Horti (and Medic) again, run the same command as above, but this time don't bootstrap:

```shell
COUCH_NODE_NAME=couchdb@localhost COUCH_URL=http://myAdminUser:myAdminPass@localhost:5984/medic horti --local
```

If you wish to change the version of Medic installed, you can either bootstrap again, or use the [Instance Upgrade configuration screen](http://localhost:5988/medic/_design/medic/_rewrite/#/configuration/upgrade).

**NB**: Horticulturalist doesn't wipe your database when it bootstraps, it just installs the provided version (or master) over whatever you already have. To completely start again, stop Horti and delete the `medic` database, either using Futon / Fauxton, or from the command line:

```shell
curl -X DELETE $COUCH_URL
```
