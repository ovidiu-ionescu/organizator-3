-- Delete one of the caller's own calendar entries.
--
-- $1 odate.id
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so there is no name to resolve again here.
--
-- odate has no row-level security, so this predicate is the whole of the rule. An entry that is
-- not the caller's answers `no_entry`, the same as one that does not exist, so ids cannot be
-- probed by trying to delete them.
--
-- Nothing else refers to an entry — the location and the type are referenced *by* it, not the
-- other way round — so there is no in-use case to refuse, the way delete_location and
-- delete_odate_type have one.
WITH requested AS (
  SELECT $1::INTEGER AS id
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_entry AS (
  SELECT odate.id
  FROM odate
  CROSS JOIN requested
  WHERE odate.id = requested.id
    AND odate.user_id = (SELECT user_id FROM current_user_row)
),
removed AS (
  DELETE FROM odate
  WHERE id IN (SELECT id FROM owned_entry)
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      -- A guard rather than an expected outcome: the setting is placed before this runs, so
      -- there is no name here left to fail to resolve.
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN NOT EXISTS (SELECT 1 FROM owned_entry) THEN 'no_entry'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
      ELSE 'no_entry'
    END
  )::TEXT AS json;
