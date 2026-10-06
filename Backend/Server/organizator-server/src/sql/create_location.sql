-- Create a location of the caller's own.
--
-- $1 the name
-- $2 latitude, or NULL
-- $3 longitude, or NULL
-- $4 timezone, or NULL
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so there is no name to resolve again here.
--
-- Refuses a name the caller already has a location under, the same rule the groups keep: a
-- dropdown with two "Office" rows is one nobody can choose between. The columns are nullable
-- (DDL/location.sql), so everything but the name may be left out — a location with no
-- coordinates is still somewhere to say an entry happened.
--
-- The whole response comes from RETURNING rather than from a second read: a data-modifying
-- statement and everything around it share one snapshot, so a SELECT here could not see the row
-- the INSERT just added (see add_user_group_member.sql).
--
-- The parameters are given their types in `requested`, once, and the rest of the statement
-- reads named columns. Left to inference this fails: the name compared against the varchar
-- column is resolved through the `text = text` operator — varchar is binary-coercible to text,
-- so that is the operator Postgres picks — and the parameter becomes TEXT there, while the
-- column it is inserted into says CHARACTER VARYING. The two deductions conflict:
--
--     ERROR: inconsistent types deduced for parameter $1
--     DETAIL: text versus character varying
--
-- A literal has a type of its own, so this only appears with real bound parameters: the
-- statement passes in psql and fails from the application.
--
-- TEXT rather than the column's own VARCHAR(255): casting to that width would cut a too-long
-- name down to fit in silence.
--
WITH requested AS (
  SELECT
    $1::TEXT AS name,
    $2::DOUBLE PRECISION AS latitude,
    $3::DOUBLE PRECISION AS longitude,
    $4::TEXT AS timezone
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
created AS (
  -- No id: location.id is serial, so the column default draws the next value.
  INSERT INTO location (name, latitude, longitude, timezone, user_id)
  SELECT
    requested.name,
    requested.latitude,
    requested.longitude,
    requested.timezone,
    current_user_row.user_id
  FROM current_user_row
  CROSS JOIN requested
  WHERE current_user_row.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM location
      WHERE location.user_id = current_user_row.user_id
        AND location.name = requested.name
    )
  RETURNING id, name, latitude, longitude, timezone, last_used
)
SELECT
  json_build_object(
    'outcome',
    CASE
      -- A guard rather than an expected outcome: the setting is placed before this runs, so
      -- there is no name here left to fail to resolve.
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN EXISTS (SELECT 1 FROM created) THEN 'created'
      ELSE 'name_taken'
    END,
    'location',
    (
      SELECT
        json_build_object(
          'id', created.id,
          'name', created.name,
          'latitude', created.latitude,
          'longitude', created.longitude,
          'timezone', created.timezone,
          -- Always NULL on a location that has just been made, which is what it means.
          'last_used', created.last_used
        )
      FROM created
    )
  )::TEXT AS json;
