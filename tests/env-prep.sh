#!/bin/sh

echo "Prepping test environment"

docker run -d -p 5984:5984 --name couch couchdb:2
echo "Starting CouchDB 2.x"
until nc -z localhost 5984; do sleep 1; done
echo "CouchDB Started"

# The next bit is pulled from our instructions: it should be updated
# if those instructions are

curl -X PUT http://localhost:5984/_config/admins/admin -d '"pass"'
curl -X PUT http://admin:pass@localhost:5986/_config/chttpd/require_valid_user \
  -d '"true"' -H "Content-Type: application/json";
curl -X POST http://admin:pass@localhost:5984/_users \
  -H "Content-Type: application/json" \
  -d '{"_id": "org.couchdb.user:admin", "name": "admin", "password":"pass", "type":"user", "roles":[]}'

echo "CouchDB setup correctly"

curl http://admin:pass@localhost:5984
