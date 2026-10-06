-- Update one of the caller's own calendar entries.
--
-- $1 odate.id
-- $2 start_time (epoch milliseconds)
-- $3 end_time   (epoch milliseconds)
-- $4 description
-- $5 memo_text
-- $6 location_id, or NULL
-- $7 odate_type id, or NULL
--
-- The whole entry, not a field of it: the form that sends this holds every field anyway, so a
-- caller that knows which parts changed would be a second way of saying the same thing, with
-- two chances to disagree.
--
-- The parameters are given their types in `requested`, once, for the reason create_odate.sql
-- sets out: left to inference, a comparison between two of them resolves to TEXT while the
-- columns they are written to want BIGINT, and Postgres refuses the statement.
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so there is no name to resolve again here.
--
-- An entry that is not the caller's is refused as though it did not exist, so a caller cannot
-- find out which ids belong to other people by trying to change them. The location and the type
-- have to be the caller's own for the reason create_odate.sql gives.

WITH requested AS (
  SELECT
    $2::BIGINT AS start_time,
    $3::BIGINT AS end_time,
    $4::TEXT AS description,
    $5::TEXT AS memo_text,
    $6::INTEGER AS location_id,
    $7::INTEGER AS type_id
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
own_entry AS (
  SELECT odate.id
  FROM odate
  WHERE odate.id = $1
    AND odate.user_id = (SELECT user_id FROM current_user_row)
),
own_location AS (
  SELECT location.id
  FROM location
  CROSS JOIN requested
  WHERE location.id = requested.location_id
    AND location.user_id = (SELECT user_id FROM current_user_row)
),
own_type AS (
  SELECT odate_type.id
  FROM odate_type
  CROSS JOIN requested
  WHERE odate_type.id = requested.type_id
    AND odate_type.user_id = (SELECT user_id FROM current_user_row)
),
updated AS (
  UPDATE odate
  SET
    start_time = requested.start_time,
    end_time = requested.end_time,
    description = requested.description,
    memo_text = requested.memo_text,
    location_id = (SELECT id FROM own_location),
    type = (SELECT id FROM own_type)
  FROM requested
  WHERE odate.id IN (SELECT id FROM own_entry)
    AND requested.end_time > requested.start_time
    AND (requested.location_id IS NULL OR EXISTS (SELECT 1 FROM own_location))
    AND (requested.type_id IS NULL OR EXISTS (SELECT 1 FROM own_type))
  RETURNING odate.id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      -- A guard rather than an expected outcome: the setting is placed before this runs, so
      -- there is no name here left to fail to resolve.
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      -- Checked before the values, so a caller who cannot touch this entry learns nothing
      -- about whether the times or the location in their request would have been accepted.
      WHEN NOT EXISTS (SELECT 1 FROM own_entry) THEN 'no_entry'
      WHEN requested.end_time <= requested.start_time THEN 'bad_interval'
      WHEN requested.location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM own_location) THEN 'bad_location'
      WHEN requested.type_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM own_type) THEN 'bad_type'
      WHEN EXISTS (SELECT 1 FROM updated) THEN 'updated'
      ELSE 'refused'
    END
  )::TEXT AS json
FROM requested;
