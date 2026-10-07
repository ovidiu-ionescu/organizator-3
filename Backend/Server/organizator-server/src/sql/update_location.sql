-- Replace one of the caller's own locations.
--
-- $1 location.id
-- $2 the name
-- $3 latitude, or NULL
-- $4 longitude, or NULL
-- $5 timezone, or NULL
--
-- The whole location, not a field of it: the panel that sends this holds every field anyway, so
-- a caller that knows which parts changed would be a second way of saying the same thing, with
-- two chances to disagree. It is also what makes a rename safe — sending only the name would
-- take the coordinates away, since an absent parameter is a NULL here.
--
-- Only the caller's own row, and a location that is not theirs and one that does not exist are
-- one answer on purpose: a caller who cannot touch a row should not be able to learn that it is
-- there.
--
-- The name has to be free among the caller's own, the rule create_location.sql sets out, and
-- giving a location the name it already has is not a conflict — hence the id test.
--
-- The row comes back from RETURNING rather than from a second read: a data-modifying statement
-- and everything around it share one snapshot, so a SELECT beside it could not see the change
-- (see add_user_group_member.sql). The whole row, so the caller can replace its copy without
-- asking for the list again.
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so there is no name to resolve again here.
--
-- The parameters are given their types in `requested`, once, and the rest of the statement reads
-- named columns. Left to inference this fails: the name compared against the varchar column is
-- resolved through the `text = text` operator — varchar is binary-coercible to text, so that is
-- the operator Postgres picks — and the parameter becomes TEXT there, while the column it is
-- written to says CHARACTER VARYING. The two deductions conflict:
--
--     ERROR: inconsistent types deduced for parameter $2
--     DETAIL: text versus character varying
--
-- A literal has a type of its own, so this only appears with real bound parameters: the
-- statement passes in psql and fails from the application.
--
-- TEXT rather than the column's own VARCHAR(255): casting to that width would cut a too-long
-- name down to fit in silence, and the handler refuses one before it gets here.

WITH requested AS (
  SELECT
    $1::INTEGER AS id,
    $2::TEXT AS name,
    $3::DOUBLE PRECISION AS latitude,
    $4::DOUBLE PRECISION AS longitude,
    $5::TEXT AS timezone
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_location AS (
  SELECT location.id
  FROM location
  CROSS JOIN requested
  WHERE location.id = requested.id
    AND location.user_id = (SELECT user_id FROM current_user_row)
),
taken AS (
  SELECT 1
  FROM location
  CROSS JOIN requested
  WHERE location.user_id = (SELECT user_id FROM current_user_row)
    AND location.name = requested.name
    AND location.id <> requested.id
  LIMIT 1
),
updated AS (
  UPDATE location
  SET
    name = requested.name,
    latitude = requested.latitude,
    longitude = requested.longitude,
    timezone = requested.timezone
  FROM requested
  WHERE location.id IN (SELECT id FROM owned_location)
    AND NOT EXISTS (SELECT 1 FROM taken)
  RETURNING location.id, location.name, location.latitude, location.longitude,
            location.timezone, location.last_used
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      -- Before the name, so a caller who cannot touch this row learns nothing about whether
      -- the name they sent would have been free.
      WHEN NOT EXISTS (SELECT 1 FROM owned_location) THEN 'no_location'
      WHEN EXISTS (SELECT 1 FROM taken) THEN 'name_taken'
      WHEN EXISTS (SELECT 1 FROM updated) THEN 'updated'
      ELSE 'no_location'
    END,
    'location',
    (
      SELECT
        json_build_object(
          'id', updated.id,
          'name', updated.name,
          'latitude', updated.latitude,
          'longitude', updated.longitude,
          'timezone', updated.timezone,
          'last_used', updated.last_used
        )
      FROM updated
    )
  )::TEXT AS json;
