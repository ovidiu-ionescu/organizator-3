-- Rename one of the caller's own date types.
--
-- $1 odate_type.id
-- $2 the new name
--
-- The same statement as rename_location.sql with the other table under it; that file explains
-- the ownership test, the name rule, the RETURNING, and the parameter types given once in
-- `requested` so the name does not collide with the varchar column's own type.

WITH requested AS (
  SELECT
    $1::INTEGER AS id,
    $2::TEXT AS name
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_type AS (
  SELECT odate_type.id
  FROM odate_type
  CROSS JOIN requested
  WHERE odate_type.id = requested.id
    AND odate_type.user_id = (SELECT user_id FROM current_user_row)
),
taken AS (
  SELECT 1
  FROM odate_type
  CROSS JOIN requested
  WHERE odate_type.user_id = (SELECT user_id FROM current_user_row)
    AND odate_type.name = requested.name
    AND odate_type.id <> requested.id
  LIMIT 1
),
renamed AS (
  UPDATE odate_type
  SET name = requested.name
  FROM requested
  WHERE odate_type.id IN (SELECT id FROM owned_type)
    AND NOT EXISTS (SELECT 1 FROM taken)
  RETURNING odate_type.id, odate_type.name
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      -- Before the name, so a caller who cannot touch this row learns nothing about whether
      -- the name they sent would have been free.
      WHEN NOT EXISTS (SELECT 1 FROM owned_type) THEN 'no_type'
      WHEN EXISTS (SELECT 1 FROM taken) THEN 'name_taken'
      WHEN EXISTS (SELECT 1 FROM renamed) THEN 'renamed'
      ELSE 'no_type'
    END,
    'odate_type',
    (
      SELECT json_build_object('id', renamed.id, 'name', renamed.name)
      FROM renamed
    )
  )::TEXT AS json;
