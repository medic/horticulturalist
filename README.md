Horticulturalist
================

Watch your ddoc and pull out [`medic-api`](https://github.com/medic/medic-api) and [`medic-sentinel`](https://github.com/medic/medic-api) updates after `kanso push`.

# Usage

## From `npm`

	npm install horticulturalist
	COUCH_NODE_NAME=couchdb@localhost COUCH_URL=http://admin:pass@localhost:5984/medic horti --local --bootstrap

## From source

	COUCH_URL=http://admin:pass@localhost:5984/medic node src/index.js --dev

# Options

	--bootstrap
		Download the latest master build and deploy to the local db at startup.
