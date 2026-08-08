#!/usr/bin/env bash
# Creates one Postgres database per name listed in $POSTGRES_MULTIPLE_DATABASES
# (comma-separated, e.g. "n8n,autotube"). Runs automatically on first container
# start via /docker-entrypoint-initdb.d. The default POSTGRES_USER already owns
# the default DB; this script grants it ownership of every additional DB too.
set -euo pipefail

create_database() {
	local database=$1
	echo "Creating database '$database' (if not present)"
	psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
	    SELECT 'CREATE DATABASE "$database" OWNER "$POSTGRES_USER"'
	    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$database')\gexec
EOSQL
}

if [ -n "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
	echo "Multiple database creation requested: $POSTGRES_MULTIPLE_DATABASES"
	IFS=',' read -ra DATABASES <<< "$POSTGRES_MULTIPLE_DATABASES"
	for db in "${DATABASES[@]}"; do
		create_database "$(echo "$db" | xargs)"
	done
	echo "Multiple databases created"
fi
