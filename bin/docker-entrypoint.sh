#!/bin/bash

info()
{
    echo "Info: $*"
}

warn()
{
    echo "Warning: $*"
}

fatal()
{
    echo "Fatal: $*"
}

wait_for_api()
{
  local n=20
  # In the case of a long migration, we should fix this loop or ensure docs clarify user will have to start horti and medic-sentinel
  # after API container finishes.

  while [ "$n" -gt 0 ]; do
    curl "http://$API_SVC_NAME:5988/setup/poll" &>/dev/null
    [ "$?" -eq 0 ] && return 0
    sleep 10
    info "Waiting for API to be Ready..."
    n=$[$n-1]
  done

  return 1
}

get_couchdb_url()
{
  echo "http://$COUCHDB_USER:$COUCHDB_PASSWORD@$COUCHDB_SERVICE_NAME:5985"
}

is_setup_needed()
{
  ! is_existing_user 'horticulturalist'
}

is_existing_user()
{
  local user="$1"
  local url="`get_couchdb_url`"
  local id="org.couchdb.user:$user"
  shift 1

  local userdoc=$(curl -X GET $url/_users/$id | jq '._id?')

  if [ "$userdoc" = \"org.couchdb.user:$user\" -a -f /srv/storage/$user/passwd/$user ]; then
    return 0
  else
    return 1
  fi
}

create_couchdb_put()
{
  local should_auth="$1"
  local payload="$2"
  local payload_is_file="$3"

  local cmd='cat'

  if [ -z "$payload_is_file" ]; then
    cmd='echo'
  fi

  if [ "$#" -gt 1 ]; then
    echo -n 'data = "\"' &&
    "$cmd" "$payload" &&
    echo '\""'
  fi
}

create_couchdb_admin()
{
  local user="$1"
  local url="`get_couchdb_url`"

  # generate password and create user
  local passwd=$(< /dev/urandom tr -dc _A-Z-a-z-0-9 | head -c${4:-32};)
  curl -X PUT $url/_node/couchdb@127.0.0.1/_config/admins/$user -d '"'"$passwd"'"'
  mkdir -p /srv/storage/$user/passwd
  echo "$passwd" > /srv/storage/$user/passwd/$user

  # Create user document for administrator
  local id="org.couchdb.user:$user" &&
  \
  local doc="{
    \"id\": \"$id\", \"roles\": [],
    \"type\": \"user\", \"name\": \"$user\"
  }" &&
  \
  create_couchdb_put 't' \
    | curl -K- -sfX PUT -H 'Content-Type: application/json' \
        --data-binary "$doc" "$url/_users/$id" >/dev/null

  if [ ${PIPESTATUS[1]} -ne 0 ]; then
    return 126
  fi

  return 0
}

postinstall()
{

  info 'Creating CouchDB service accounts'
  create_couchdb_admin 'horticulturalist'

  if [ "$?" -ne 0 ]; then
    fatal "Failed to create one or more service accounts"
  fi

  info 'New CouchDB User: horticulturalist'

  info 'horti setup successful'
}

wait_for_api
if is_setup_needed; then
    info 'Setting up horticulturalist..'
    postinstall "$@"
fi

export COUCH_URL=http://horticulturalist:$(cat /srv/storage/horticulturalist/passwd/horticulturalist)@$HAPROXY_SVC:5984/medic 
node /app/horticulturalist/src/index.js --medic-os