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

	--bootstrap[=buildname]
		Download the latest master (or specified) build and deploy to the local db at startup.
