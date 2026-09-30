-- Verify that memo_write reports the access level of the requester.
--
-- Safe to run against any database: everything is inside a transaction that is rolled back at
-- the end, so the fixture and the memos it writes leave nothing behind.
--
-- Run it before applying SQL/Updates/003: every case reports a missing column, which is the gap
-- the migration closes. Run it again after: the levels appear.

BEGIN;

-- Fixture: alice owns a memo group, bob is in a group granted level 2 on it, carol level 1.
INSERT INTO users (id, username) VALUES (1, 'alice'), (2, 'bob'), (3, 'carol');
INSERT INTO memo_group (id, name, user_id, public) VALUES (1, 'verify group', 1, false);
INSERT INTO user_group (id, user_group_name, user_id) VALUES (1, 'rw', 1), (2, 'ro', 1);
INSERT INTO user_group_detail (id, user_group_id, user_id) VALUES (1, 1, 2), (2, 2, 3);
INSERT INTO memo_acl (id, memo_group_id, user_group_id, access) VALUES (1, 1, 1, 2), (2, 1, 2, 1);

CREATE TEMP TABLE verify_results (case_name text, outcome text);

DO $$
DECLARE
  v_id    integer;
  v_level integer;
BEGIN
  -- 1) the owner creates a memo
  BEGIN
    PERFORM set_current_user('alice');
    SELECT io_memo_id, o_access_level INTO v_id, v_level
      FROM memo_write(NULL, 'verify title', 'verify body', 1000, 1, 'alice', '{}'::uuid[]);
    INSERT INTO verify_results VALUES ('1. new memo, owner alice',
      format('id=%s level=%s (expect 3)', v_id, v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verify_results VALUES ('1. new memo, owner alice', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- 2) the owner changes the text
  BEGIN
    PERFORM set_current_user('alice');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'verify title', 'owner edit', 2000, 1, 'alice', '{}'::uuid[]);
    INSERT INTO verify_results VALUES ('2. owner edits it',
      format('level=%s (expect 3)', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verify_results VALUES ('2. owner edits it', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- 3) bob writes the body of a memo he holds level 2 on. He may not touch the title or the
  --    group, so those go back unchanged.
  BEGIN
    PERFORM set_current_user('bob');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'verify title', 'bob edit', 3000, 1, 'bob', '{}'::uuid[]);
    INSERT INTO verify_results VALUES ('3. bob edits body (granted level 2)',
      format('level=%s (expect 2)', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verify_results VALUES ('3. bob edits body (granted level 2)', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- 4) the owner resends exactly what is stored. memo_write returns early here, before the end
  --    of the function, which is why the level has to be set before that return.
  BEGIN
    PERFORM set_current_user('alice');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'verify title', 'bob edit', 4000, 1, 'alice', '{}'::uuid[]);
    INSERT INTO verify_results VALUES ('4. nothing changed, early return',
      format('level=%s (expect 3, not NULL)', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verify_results VALUES ('4. nothing changed, early return', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- 5) carol holds level 1, which is not enough to write. This refusal is what makes a 200 from
  --    this function proof of write access.
  BEGIN
    PERFORM set_current_user('carol');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'verify title', 'carol edit', 5000, 1, 'carol', '{}'::uuid[]);
    INSERT INTO verify_results VALUES ('5. carol has only level 1',
      format('level=%s (expect a refusal, not a level)', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verify_results VALUES ('5. carol has only level 1', 'refused: SQLSTATE ' || SQLSTATE);
  END;

  -- 6) the write reply and the read path must agree, or a client can be told two things
  BEGIN
    PERFORM set_current_user('alice');
    INSERT INTO verify_results VALUES ('6a. read path as alice',
      format('level=%s (expect 3)', get_memo_access_level_for_requester(v_id)));
    PERFORM set_current_user('bob');
    INSERT INTO verify_results VALUES ('6b. read path as bob',
      format('level=%s (expect 2, same as his write reply)', get_memo_access_level_for_requester(v_id)));
    PERFORM set_current_user('carol');
    INSERT INTO verify_results VALUES ('6c. read path as carol',
      format('level=%s (expect 1)', get_memo_access_level_for_requester(v_id)));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO verify_results VALUES ('6. read path', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;
END $$;

SELECT case_name, outcome FROM verify_results ORDER BY case_name;

ROLLBACK;
