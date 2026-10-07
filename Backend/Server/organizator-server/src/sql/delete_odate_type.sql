-- Delete one of the caller's own date types.
--
-- $1 odate_type.id
--
-- The same statement as delete_location.sql with the other table under it; that file explains
-- why an entry still pointing at the row is refused rather than left holding an id for nothing,
-- why the count covers finished entries too, and why it is always a number.

WITH requested AS (
  SELECT $1::INTEGER AS id
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
used AS (
  SELECT count(*) AS used_by
  FROM odate
  CROSS JOIN requested
  WHERE odate.type = requested.id
    AND odate.user_id = (SELECT user_id FROM current_user_row)
),
removed AS (
  DELETE FROM odate_type
  WHERE id IN (SELECT id FROM owned_type)
    AND (SELECT used_by FROM used) = 0
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN NOT EXISTS (SELECT 1 FROM owned_type) THEN 'no_type'
      WHEN (SELECT used_by FROM used) > 0 THEN 'in_use'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
      ELSE 'no_type'
    END,
    'used_by',
    (SELECT used_by FROM used)
  )::TEXT AS json;
