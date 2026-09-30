-- What happens to a shared memo write, with RLS in force as production has it?
--
-- memo_write's explicit check lets a non-owner holding level 2 write the body. The policy on
-- memo, update_policy_owner, is USING (user_id = current_user) — the owner's rows only. RLS
-- filters rows rather than refusing statements, so the two can disagree without anybody noticing.
--
-- Runs as the superuser for the fixture, then SET LOCAL ROLE organizator_prod (not a superuser,
-- not bypassrls — checked) so the writes go through the policies. Rolled back.

BEGIN;

INSERT INTO users (id, username) VALUES (1, 'alice'), (2, 'bob'), (3, 'carol');
INSERT INTO memo_group (id, name, user_id, public) VALUES (1, 'shared', 1, false);
INSERT INTO user_group (id, user_group_name, user_id) VALUES (1, 'rw', 1), (2, 'ro', 1);
INSERT INTO user_group_detail (id, user_group_id, user_id) VALUES (1, 1, 2), (2, 2, 3);
INSERT INTO memo_acl (id, memo_group_id, user_group_id, access) VALUES (1, 1, 1, 2), (2, 1, 2, 1);

-- From here on, RLS is in force. The results table is made after the switch so the role that
-- writes into it owns it.
SET LOCAL ROLE organizator_prod;

CREATE TEMP TABLE rls_results (step text, detail text);

DO $$
DECLARE
  v_id    integer;
  v_level integer;
BEGIN
  BEGIN
    PERFORM set_current_user('alice');
    SELECT io_memo_id, o_access_level INTO v_id, v_level
      FROM memo_write(NULL, 'shared title', 'alice original', 1000, 1, 'alice', '{}'::uuid[]);
    INSERT INTO rls_results VALUES ('1. owner creates', format('id=%s level=%s', v_id, v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO rls_results VALUES ('1. owner creates', 'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM set_current_user('bob');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'shared title', 'bob was here', 2000, 1, 'bob', '{}'::uuid[]);
    INSERT INTO rls_results VALUES ('2. bob (granted level 2) writes body',
      format('accepted, level=%s', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO rls_results VALUES ('2. bob (granted level 2) writes body',
      'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM set_current_user('carol');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'shared title', 'carol was here', 3000, 1, 'carol', '{}'::uuid[]);
    INSERT INTO rls_results VALUES ('3. carol (level 1) writes body',
      format('accepted, level=%s — should not happen', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO rls_results VALUES ('3. carol (level 1) writes body', 'REFUSED ' || SQLSTATE);
  END;

  BEGIN
    PERFORM set_current_user('alice');
    SELECT o_access_level INTO v_level
      FROM memo_write(v_id, 'shared title', 'alice edited', 4000, 1, 'alice', '{}'::uuid[]);
    INSERT INTO rls_results VALUES ('4. owner edits the body', format('level=%s', v_level));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO rls_results VALUES ('4. owner edits the body', 'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM set_current_user('alice');
    INSERT INTO rls_results VALUES ('5. stored text now',
      (SELECT memotext FROM memo WHERE id = v_id));
    INSERT INTO rls_results VALUES ('6. history rows',
      (SELECT count(*)::text FROM memo_history WHERE memo_id = v_id));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO rls_results VALUES ('5. stored text now', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;
END $$;

RESET ROLE;

INSERT INTO rls_results VALUES ('7. row read as superuser',
  (SELECT memotext FROM memo ORDER BY id DESC LIMIT 1));

SELECT step, detail FROM rls_results ORDER BY step;

ROLLBACK;
