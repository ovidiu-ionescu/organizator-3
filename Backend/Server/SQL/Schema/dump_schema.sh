#!/bin/bash

mv schema_dump.sql "schema_dump.$(date +%Y%m%d_%H%M).sql"

podman exec -i postgres-db pg_dump  -U organizator_prod -s -d organizator_prod > schema_dump.sql
