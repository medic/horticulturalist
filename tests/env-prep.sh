#!/bin/sh
set -e

echo "Prepping test environment"

docker run -d -p 5984:5984 --name couch couchdb:2
echo "Starting CouchDB 2.x"
until nc -z localhost 5984; do sleep 1; done
echo "CouchDB Started"

# Spoiler, CouchDB hasn't actually started yet!
sleep 5;

echo "Adding default databases"
curl -X PUT 'http://localhost:5984/{_users,_replicator,_global_changes,_metadata,admins}'

echo "Adding default admin user to config"
curl -X PUT http://localhost:5984/_node/${COUCH_NODE_NAME}/_config/admins/admin -d '"pass"';

echo "Adding default admin user to _users"
curl -X POST http://admin:pass@localhost:5984/_users \
  -H "Content-Type: application/json" \
  -d 'z{"_id": "org.couchdb.user:admin", "name": "admin", "password":"pass", "type":"user", "roles":[]}'

echo "Configuring require_valid_user"
curl -X PUT --data '"true"' http://admin:pass@localhost:5984/_node/${COUCH_NODE_NAME}/_config/chttpd/require_valid_user

echo "Configuring max_http_request_size"
curl -X PUT --data '"4294967296"' http://admin:pass@localhost:5984/_node/${COUCH_NODE_NAME}/_config/httpd/max_http_request_size

echo "CouchDB setup correctly"

curl http://admin:pass@localhost:5984
