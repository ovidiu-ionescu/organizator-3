-- Delete one archived version of a memo, when that version is a duplicate.
--
-- $1 memo_history.id
--
-- The history id is unique, so it addresses the row on its own; the memo it belongs to is read
-- from the row. The join to memo carries the owner predicate: memo_history has no RLS, and a row
-- that is not the caller's answers `no_history`, the same as one that does not exist, so ids
-- cannot be probed.
--
-- A version is deleted only when it is one of two kinds of duplicate:
--   * the newer of two consecutive rows with the same title and body — the step before it says
--     exactly what it says; or
--   * the latest archived version when it says exactly what the memo table says now, since the
--     current memo is then the newer of the pair and the history row is the copy to remove.
--
-- The comparison is on both stored columns, and IS NOT DISTINCT FROM because either may be null.
-- The id order is the writing order, the same order the read uses.
WITH requested AS (
  SELECT $1::INTEGER AS history_id
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
target AS (
  SELECT h.id, h.memo_id, h.title, h.memotext, h.savetime,
         memo.title AS current_title, memo.memotext AS current_memotext,
         NOT EXISTS (
           SELECT 1
           FROM memo_history newer
           WHERE newer.memo_id = h.memo_id
             AND newer.id > h.id
         ) AS latest
  FROM memo_history h
  JOIN memo ON memo.id = h.memo_id
  CROSS JOIN requested
  WHERE h.id = requested.history_id
    AND memo.user_id = (SELECT user_id FROM current_user_row)
),
previous AS (
  SELECT h.title, h.memotext
  FROM memo_history h
  CROSS JOIN target
  WHERE h.memo_id = target.memo_id
    AND h.id < target.id
  ORDER BY h.id DESC
  LIMIT 1
),
deletable AS (
  SELECT target.id
  FROM target
  WHERE EXISTS (
    SELECT 1
    FROM previous
    WHERE previous.title IS NOT DISTINCT FROM target.title
      AND previous.memotext IS NOT DISTINCT FROM target.memotext
  )
  OR (
    target.latest
    AND target.current_title IS NOT DISTINCT FROM target.title
    AND target.current_memotext IS NOT DISTINCT FROM target.memotext
  )
),
removed AS (
  DELETE FROM memo_history
  WHERE id IN (SELECT id FROM deletable)
  RETURNING id
),
-- Removing the newest version also gives the memo that version's save time. The memo's own time
-- is the one the last save wrote; when the newest archived version is the same state, its time is
-- the real save time of that state, and deleting it would otherwise lose that. A lower version's
-- time says nothing about the memo's current state, so it is left alone. A version with no saved
-- time carries none.
updated_memo AS (
  UPDATE memo
  SET savetime = target.savetime
  FROM target
  WHERE memo.id = target.memo_id
    AND target.latest
    AND target.savetime IS NOT NULL
    AND target.id IN (SELECT id FROM removed)
  RETURNING memo.id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      -- A guard rather than an expected outcome: the setting is placed before this runs.
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'no_history'
      WHEN NOT EXISTS (SELECT 1 FROM deletable) THEN 'not_duplicate'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
      ELSE 'not_duplicate'
    END
  )::TEXT AS json;
