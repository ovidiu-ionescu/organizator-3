-- Verify that a memo's history is readable by its owner and by nobody else.
--
-- memo_history has no row-level security — it is the one memo table without it — so the endpoint's
-- query carries the owner predicate itself (organizator-server/src/sql/memo_history.sql). This
-- runs as the application role, not as the superuser, precisely so that the test proves that
-- predicate and not a policy: as the role, a shared reader may read the *memo* (its policy lets
-- them) and must still get none of the history. The control below reads the memo as each one of
-- them for that reason — a refusal that came from having no access at all would prove nothing.
--
-- Everything is inside a transaction that is rolled back, so the fixture and the versions it
-- writes leave nothing behind.
BEGIN;

-- Fixture: alice owns a memo group, bob is in a group granted level 2 on it, carol level 1.
--
-- High ids and names of its own on purpose: the database this runs against is not guaranteed to
-- be empty — the dump carries rows and earlier runs leave their own — so a fixture that took ids
-- 1, 2 and 3 or the names alice, bob and carol would collide with what was there.
INSERT INTO users (id, username) VALUES
  (1001, 'history_alice'), (1002, 'history_bob'), (1003, 'history_carol');
INSERT INTO memo_group (id, name, user_id, public) VALUES (1001, 'verify history group', 1001, false);
INSERT INTO user_group (id, user_group_name, user_id) VALUES (1001, 'rw', 1001), (1002, 'ro', 1001);
INSERT INTO user_group_detail (id, user_group_id, user_id) VALUES (1001, 1001, 1002), (1002, 1002, 1003);
INSERT INTO memo_acl (id, memo_group_id, user_group_id, access) VALUES (1001, 1001, 1001, 2), (1002, 1001, 1002, 1);

-- The sequences, moved past whatever this database already holds. A row inserted by hand with an
-- explicit id does not advance the sequence it came from, and memo_write takes its history ids
-- from memo_history_id_seq — so without this, a database with such rows in it collides on the
-- first archive. This is the one thing here that survives the rollback, because a sequence does
-- not take part in transactions; it only ever moves the next id forward, past rows that are
-- already there.
SELECT setval('memo_history_id_seq',
              GREATEST(COALESCE((SELECT MAX(id) FROM memo_history), 0), 10000));

-- The memo itself, written directly rather than through memo_write's create: that takes its id
-- from a sequence, and a database whose rows were inserted by hand with explicit ids has a
-- sequence that no longer agrees with them. The two updates below are what this test is about,
-- and each of them archives the state it found.
INSERT INTO memo (id, group_id, title, memotext, user_id, saveuser_id, savetime)
VALUES (2001, 1001, 'history title', 'first body', 1001, 1001, 1000);

-- From here on, RLS is in force. The results table is made after the switch so the role that
-- writes into it owns it.
SET LOCAL ROLE organizator_prod;

CREATE TEMP TABLE history_results (case_name text, outcome text);

DO $$
DECLARE
  v_id     integer := 2001;
  v_level  integer;
  v_count  bigint;
  v_texts  text;
  v_memo   bigint;
BEGIN
  -- Two versions archived: alice's change archives "first body", bob's archives "second body".
  BEGIN
    PERFORM set_current_user('history_alice');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'history title', 'second body', 2000, 1001, 'history_alice', '{}'::uuid[]);
    INSERT INTO history_results VALUES ('1. alice edits the body', format('level=%s', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO history_results VALUES ('1. alice edits the body', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM set_current_user('history_bob');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'history title', 'third body', 3000, 1001, 'history_bob', '{}'::uuid[]);
    INSERT INTO history_results VALUES ('2. bob edits the body (level 2)', format('level=%s', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO history_results VALUES ('2. bob edits the body (level 2)', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- The owner: both versions, oldest first, each holding the text as it was *before* the change
  -- that followed it. The query is the one the endpoint runs, with $1 written as v_id.
  BEGIN
    PERFORM set_current_user('history_alice');
    SELECT count(*), string_agg(h.memotext, ' | ' ORDER BY h.id) INTO v_count, v_texts
      FROM memo_history h
      JOIN memo ON memo.id = h.memo_id
      JOIN users owner ON owner.id = h.user_id
      LEFT JOIN users saver ON saver.id = h.saveuser_id
     WHERE h.memo_id = v_id
       AND memo.user_id = (current_setting('organizator.current_user'))::INTEGER;

    INSERT INTO history_results VALUES ('3. the owner reads the history',
      format('rows=%s texts=%s (expect 2, "first body | second body")', v_count, coalesce(v_texts, 'none')));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO history_results VALUES ('3. the owner reads the history', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- A shared writer, who may read the memo (the control) and may write it, and still gets none of
  -- its history.
  BEGIN
    PERFORM set_current_user('history_bob');
    SELECT count(*) INTO v_memo FROM memo WHERE id = v_id;
    SELECT count(*) INTO v_count
      FROM memo_history h
      JOIN memo ON memo.id = h.memo_id
      JOIN users owner ON owner.id = h.user_id
      LEFT JOIN users saver ON saver.id = h.saveuser_id
     WHERE h.memo_id = v_id
       AND memo.user_id = (current_setting('organizator.current_user'))::INTEGER;

    INSERT INTO history_results VALUES ('4. a shared writer reads the history',
      format('memo rows=%s history rows=%s (expect 1, then 0)', v_memo, v_count));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO history_results VALUES ('4. a shared writer reads the history', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- A shared reader, likewise: the memo yes, the history no.
  BEGIN
    PERFORM set_current_user('history_carol');
    SELECT count(*) INTO v_memo FROM memo WHERE id = v_id;
    SELECT count(*) INTO v_count
      FROM memo_history h
      JOIN memo ON memo.id = h.memo_id
      JOIN users owner ON owner.id = h.user_id
      LEFT JOIN users saver ON saver.id = h.saveuser_id
     WHERE h.memo_id = v_id
       AND memo.user_id = (current_setting('organizator.current_user'))::INTEGER;

    INSERT INTO history_results VALUES ('5. a shared reader reads the history',
      format('memo rows=%s history rows=%s (expect 1, then 0)', v_memo, v_count));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO history_results VALUES ('5. a shared reader reads the history', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- An id that is nobody's: the same empty answer, not an error.
  BEGIN
    PERFORM set_current_user('history_alice');
    SELECT count(*) INTO v_count
      FROM memo_history h
      JOIN memo ON memo.id = h.memo_id
      JOIN users owner ON owner.id = h.user_id
      LEFT JOIN users saver ON saver.id = h.saveuser_id
     WHERE h.memo_id = v_id + 1000
       AND memo.user_id = (current_setting('organizator.current_user'))::INTEGER;

    INSERT INTO history_results VALUES ('6. an id that is nobody''s',
      format('rows=%s (expect 0)', v_count));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO history_results VALUES ('6. an id that is nobody''s', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;
END $$;

\echo
\echo '== memo history, owner only =='
SELECT case_name, outcome FROM history_results ORDER BY case_name;

ROLLBACK;
