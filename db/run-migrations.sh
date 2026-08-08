#!/usr/bin/env sh
# Applies db/migrations/*.sql to $POSTGRES_DB in filename order, tracked in
# schema_migrations so re-running the migrate container is a no-op for
# already-applied files (docs/DATABASE.md "Migrations").
set -eu

export PGPASSWORD="$POSTGRES_PASSWORD"
PSQL="psql -v ON_ERROR_STOP=1 -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB"

$PSQL -c "CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());"

for file in /migrations/*.sql; do
	version=$(basename "$file")
	already_applied=$($PSQL -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'")
	if [ "$already_applied" = "1" ]; then
		echo "skip (already applied): $version"
		continue
	fi
	echo "applying: $version"
	$PSQL -f "$file"
	$PSQL -c "INSERT INTO schema_migrations (version) VALUES ('$version');"
done

echo "migrations complete"
