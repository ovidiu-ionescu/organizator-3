-- Verify that a calendar entry can be deleted by its owner and by nobody else.
--
-- odate has no row-level security, so the owner predicate in the delete statement
-- (organizator-server/src/sql/delete_odate.sql) is the whole of the rule. This runs as the
-- application role, not as the superuser, so that the test proves the statement's own predicate
-- rather than a policy: as the role, a caller trying to delete somebody else's entry must be
-- answered `no_entry` and the row must still be there afterwards.
--
-- Everything is inside a transaction that is rolled back, so the fixtures leave nothing behind.
BEGIN;

-- High ids and names of its own on purpose: the database this runs against is not guaranteed to
-- be empty, and a fixture that took ids 1, 2 and 3 or the names alice and bob would collide with
-- what is there.
INSERT INTO users (id, username) VALUES
  (1101, 'odate_alice'), (1102, 'odate_bob');
INSERT INTO odate (id, user_id, start_time, end_time, description) VALUES
  (2101, 1101, 1000, 2000, 'alice entry'),
  (2102, 1102, 1000, 2000, 'bob entry');

-- From here on, the statement is run as the role the application uses.
SET LOCAL ROLE organizator_prod;

CREATE TEMP TABLE odate_delete_results (case_name text, outcome text);

DO $$
DECLARE
  v_alice integer := 2101;
  v_bob   integer := 2102;
  v_unknown integer := 2999;
  v_outcome text;
  v_left    bigint;
BEGIN
  -- The query is the one the endpoint runs, with $1 written as the id each case names.
  --
  -- Case 1: the owner deletes their own entry. The row goes.
  BEGIN
    PERFORM set_current_user('odate_alice');
    WITH requested AS (
      SELECT v_alice::INTEGER AS id
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
    SELECT json_build_object(
      'outcome',
      CASE
        WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
        WHEN NOT EXISTS (SELECT 1 FROM owned_entry) THEN 'no_entry'
        WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
        ELSE 'no_entry'
      END
    )::TEXT INTO v_outcome;

    SELECT count(*) INTO v_left FROM odate WHERE id = v_alice;
    INSERT INTO odate_delete_results VALUES
      ('1. the owner deletes their own entry',
       format('%s, rows left %s (expect removed, 0)', v_outcome, v_left));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO odate_delete_results VALUES
      ('1. the owner deletes their own entry', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- Case 2: somebody else's entry. The answer is the one a missing entry gives, and the row
  -- survives — which is the part that matters.
  BEGIN
    PERFORM set_current_user('odate_alice');
    WITH requested AS (
      SELECT v_bob::INTEGER AS id
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
    SELECT json_build_object(
      'outcome',
      CASE
        WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
        WHEN NOT EXISTS (SELECT 1 FROM owned_entry) THEN 'no_entry'
        WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
        ELSE 'no_entry'
      END
    )::TEXT INTO v_outcome;

    SELECT count(*) INTO v_left FROM odate WHERE id = v_bob;
    INSERT INTO odate_delete_results VALUES
      ('2. a stranger tries to delete it',
       format('%s, rows left %s (expect no_entry, 1)', v_outcome, v_left));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO odate_delete_results VALUES
      ('2. a stranger tries to delete it', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- Case 3: the real owner may still delete it, and an id nobody owns is simply absent.
  BEGIN
    PERFORM set_current_user('odate_bob');
    WITH requested AS (
      SELECT v_bob::INTEGER AS id
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
    SELECT json_build_object(
      'outcome',
      CASE
        WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
        WHEN NOT EXISTS (SELECT 1 FROM owned_entry) THEN 'no_entry'
        WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
        ELSE 'no_entry'
      END
    )::TEXT INTO v_outcome;

    SELECT count(*) INTO v_left FROM odate WHERE id = v_bob;
    INSERT INTO odate_delete_results VALUES
      ('3. the owner deletes it after the refusal',
       format('%s, rows left %s (expect removed, 0)', v_outcome, v_left));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO odate_delete_results VALUES
      ('3. the owner deletes it after the refusal', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM set_current_user('odate_alice');
    WITH requested AS (
      SELECT v_unknown::INTEGER AS id
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
    SELECT json_build_object(
      'outcome',
      CASE
        WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
        WHEN NOT EXISTS (SELECT 1 FROM owned_entry) THEN 'no_entry'
        WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
        ELSE 'no_entry'
      END
    )::TEXT INTO v_outcome;

    INSERT INTO odate_delete_results VALUES
      ('4. an id nobody owns', format('%s (expect no_entry)', v_outcome));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO odate_delete_results VALUES
      ('4. an id nobody owns', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;
END $$;

\echo
\echo '== odate delete, owner only =='
SELECT case_name, outcome FROM odate_delete_results ORDER BY case_name;

ROLLBACK;
