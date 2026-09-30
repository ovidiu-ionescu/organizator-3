-- Does the column rule hold for writes that do not come through memo_write?
--
-- Run as organizator_prod (not a superuser, not bypassrls) so the policy is in force: it decides
-- which rows bob may update, and the trigger decides which columns. Rolled back.

BEGIN;

INSERT INTO users (id, username) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO memo_group (id, name, user_id, public) VALUES (1, 'shared', 1, false);
INSERT INTO user_group (id, user_group_name, user_id) VALUES (1, 'rw', 1);
INSERT INTO user_group_detail (id, user_group_id, user_id) VALUES (1, 1, 2);
INSERT INTO memo_acl (id, memo_group_id, user_group_id, access) VALUES (1, 1, 1, 2);

SET LOCAL ROLE organizator_prod;

CREATE TEMP TABLE trg_results (step text, detail text);

DO $$
DECLARE
  v_id integer;
BEGIN
  BEGIN
    PERFORM set_current_user('alice');
    SELECT io_memo_id INTO v_id
      FROM memo_write(NULL, 'orig title', 'orig body', 1000, 1, 'alice', '{}'::uuid[]);
    INSERT INTO trg_results VALUES ('0. setup: alice creates', 'id=' || v_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('0. setup: alice creates', 'ERROR ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- Through the function: the body is bob's to write.
  BEGIN
    PERFORM set_current_user('bob');
    PERFORM memo_write(v_id, 'orig title', 'bob body', 2000, 1, 'bob', '{}'::uuid[]);
    INSERT INTO trg_results VALUES ('1. bob writes body via memo_write', 'accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('1. bob writes body via memo_write', 'REFUSED ' || SQLSTATE);
  END;

  -- Through the function: the title is not. The function refuses the request, because its own
  -- UPDATE would never carry the title to the trigger.
  BEGIN
    PERFORM set_current_user('bob');
    PERFORM memo_write(v_id, 'bob title', 'bob body', 3000, 1, 'bob', '{}'::uuid[]);
    INSERT INTO trg_results VALUES ('2. bob changes title via memo_write', 'ACCEPTED — should not happen');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('2. bob changes title via memo_write', 'REFUSED ' || SQLSTATE);
  END;

  -- Through the function: sending no group at all, while the memo is in one.
  BEGIN
    PERFORM set_current_user('bob');
    PERFORM memo_write(v_id, 'orig title', 'bob body', 4000, NULL, 'bob', '{}'::uuid[]);
    INSERT INTO trg_results VALUES ('3. bob takes it out of its group', 'ACCEPTED — should not happen');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('3. bob takes it out of its group', 'REFUSED ' || SQLSTATE);
  END;

  -- Around the function: the same column, written directly. The policy lets bob reach the row.
  BEGIN
    PERFORM set_current_user('bob');
    UPDATE memo SET title = 'direct edit' WHERE id = v_id;
    INSERT INTO trg_results VALUES ('4. bob changes title by direct SQL', 'ACCEPTED — should not happen');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('4. bob changes title by direct SQL', 'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- Around the function: the group, cleared directly.
  BEGIN
    PERFORM set_current_user('bob');
    UPDATE memo SET group_id = NULL WHERE id = v_id;
    INSERT INTO trg_results VALUES ('5. bob clears the group by direct SQL', 'ACCEPTED — should not happen');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('5. bob clears the group by direct SQL', 'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- Around the function: the body, written directly. His to write, so the trigger stays quiet.
  BEGIN
    PERFORM set_current_user('bob');
    UPDATE memo SET memotext = 'bob body direct' WHERE id = v_id;
    INSERT INTO trg_results VALUES ('6. bob writes the body by direct SQL', 'accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('6. bob writes the body by direct SQL', 'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  -- The owner changing his own memo's title, through the function.
  BEGIN
    PERFORM set_current_user('alice');
    PERFORM memo_write(v_id, 'alice new title', 'bob body', 5000, 1, 'alice', '{}'::uuid[]);
    INSERT INTO trg_results VALUES ('7. owner changes the title', 'accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('7. owner changes the title', 'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM set_current_user('alice');
    INSERT INTO trg_results VALUES ('8. stored row now',
      (SELECT title || ' | group ' || COALESCE(group_id::text, 'null') || ' | ' || memotext
         FROM memo WHERE id = v_id));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('8. stored row now', 'ERROR ' || SQLSTATE);
  END;

  -- Around the function: ownership. The widened policy lets bob reach the row, so this rests on
  -- the trigger alone.
  BEGIN
    PERFORM set_current_user('bob');
    UPDATE memo SET user_id = 2 WHERE id = v_id;
    INSERT INTO trg_results VALUES ('9. bob takes ownership by direct SQL', 'ACCEPTED — should not happen');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('9. bob takes ownership by direct SQL', 'REFUSED ' || SQLSTATE || ': ' || SQLERRM);
  END;

  BEGIN
    PERFORM set_current_user('alice');
    INSERT INTO trg_results VALUES ('10. can alice still see it',
      COALESCE((SELECT title FROM memo WHERE id = v_id), 'no — it is not hers any more'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO trg_results VALUES ('10. can alice still see it', 'ERROR ' || SQLSTATE);
  END;
END $$;

RESET ROLE;

SELECT step, detail FROM trg_results ORDER BY step;

ROLLBACK;
