-- Verify that only a duplicate archived version can be deleted, and only by its owner.
--
-- memo_history has no row-level security, so the endpoint's delete query carries the owner
-- predicate itself (organizator-server/src/sql/delete_memo_history.sql). This runs as the
-- application role for the same reason the history read test does: as the role, a shared reader
-- may read the memo and must still not touch its history.
--
-- A version is a duplicate when it says exactly what the one before it says, or when it is the
-- latest version and says exactly what the memo table says now. The second case is the one where
-- the newer row of the pair is the memo itself, which is not in memo_history.
--
-- Everything is inside a transaction that is rolled back.
BEGIN;

INSERT INTO users (id, username) VALUES (2101, 'delete_history_alice'),
                                        (2102, 'delete_history_bob');
-- Bob is given level 2 on memo C through a group: he can read the memo and write it, and must
-- still not be able to delete its history. The control below reads the memo as him.
INSERT INTO memo_group (id, name, user_id, public)
  VALUES (1101, 'delete history writers', 2101, false);
INSERT INTO user_group (id, user_group_name, user_id)
  VALUES (1101, 'writers', 2101);
INSERT INTO user_group_detail (id, user_group_id, user_id)
  VALUES (1101, 1101, 2102);
INSERT INTO memo_acl (id, memo_group_id, user_group_id, access)
  VALUES (1101, 1101, 1101, 2);
INSERT INTO memo (id, group_id, title, memotext, user_id, saveuser_id, savetime) VALUES
  (3001, NULL, 'memo A current', E'\nA current body', 2101, 2101, 100),
  (3002, NULL, 'memo B current', E'\nB current body', 2101, 2101, 100),
  (3003, 1101, 'memo C current', E'\nC current body', 2101, 2101, 100),
  (3004, NULL, 'memo D current', E'\nD current body', 2101, 2101, 100);
INSERT INTO memo_history (id, memo_id, group_id, title, memotext, user_id, saveuser_id, savetime) VALUES
  -- A: the newer of two identical rows; it is the top history row.
  (4001, 3001, NULL, 'a one', E'\na one body', 2101, 2101, 10),
  (4002, 3001, NULL, 'a one', E'\na one body', 2101, 2101, 20),
  -- B: the latest row is identical to the memo table's row.
  (4003, 3002, NULL, 'b old', E'\nb old body', 2101, 2101, 10),
  (4004, 3002, NULL, 'memo B current', E'\nB current body', 2101, 2101, 20),
  -- C: neither kind of duplicate.
  (4005, 3003, 1101, 'c one', E'\nc one body', 2101, 2101, 10),
  (4006, 3003, 1101, 'c two', E'\nc two body', 2101, 2101, 20),
  -- D: a duplicate that is not the top history row; deleting it must not touch the memo's time.
  (4007, 3004, NULL, 'd one', E'\nd one body', 2101, 2101, 10),
  (4008, 3004, NULL, 'd one', E'\nd one body', 2101, 2101, 20),
  (4009, 3004, NULL, 'd two', E'\nd two body', 2101, 2101, 30);

-- The endpoint's query, with its single parameter as the function's argument. The function is
-- security invoker (the default), so the role, the RLS policy and the current-user setting below
-- are the ones the query sees.
CREATE FUNCTION public.try_delete_history(integer) RETURNS text LANGUAGE sql AS $fn$
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
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN NOT EXISTS (SELECT 1 FROM target) THEN 'no_history'
      WHEN NOT EXISTS (SELECT 1 FROM deletable) THEN 'not_duplicate'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
      ELSE 'not_duplicate'
    END
  )::TEXT
$fn$;

SET LOCAL ROLE organizator_prod;

\echo
\echo '== memo history delete, duplicates only =='
SELECT set_current_user('delete_history_alice');

SELECT '1. older of a pair' AS case_name, public.try_delete_history(4001) AS outcome,
       '{"outcome" : "not_duplicate"}' AS expect
UNION ALL
SELECT '2. newer of a pair', public.try_delete_history(4002),
       '{"outcome" : "removed"}'
UNION ALL
SELECT '3. non-latest, not equal current', public.try_delete_history(4003),
       '{"outcome" : "not_duplicate"}'
UNION ALL
SELECT '4. latest, equal current', public.try_delete_history(4004),
       '{"outcome" : "removed"}'
UNION ALL
SELECT '5. latest, not a duplicate', public.try_delete_history(4006),
       '{"outcome" : "not_duplicate"}'
UNION ALL
SELECT '6. no such history row', public.try_delete_history(9999),
       '{"outcome" : "no_history"}'
UNION ALL
SELECT '7. duplicate below the top', public.try_delete_history(4008),
       '{"outcome" : "removed"}';

SELECT '8. deleting the top row copies its time' AS case_name,
       (SELECT savetime FROM memo WHERE id = 3001)::text AS outcome, '20' AS expect;
SELECT '9. also when it is the current memo' AS case_name,
       (SELECT savetime FROM memo WHERE id = 3002)::text AS outcome, '20' AS expect;
SELECT '10. a lower row leaves the memo time' AS case_name,
       (SELECT savetime FROM memo WHERE id = 3004)::text AS outcome, '100' AS expect;

SELECT set_current_user('delete_history_bob');
SELECT '11. a shared writer reads the memo' AS case_name,
       (SELECT count(*) FROM memo WHERE id = 3003)::text AS outcome,
       '1' AS expect;
SELECT '12. a shared writer deletes a version' AS case_name,
       public.try_delete_history(4006) AS outcome,
       '{"outcome" : "no_history"}' AS expect;

ROLLBACK;
