--- Each user gets two memo_groups: one with read-only access and one with read-write access
--- This way it's easy to share something with another user

--insert into user_group (id, user_group_name, user_id)
--values (nextval('user_group_id_seq'), 'Ovidiu (Individual)', 1);

---- user_group_id 25

---- select * from user_group;

--insert into user_group_detail (id, user_group_id, user_id)
--values(nextval('user_group_detail_id_seq'), 25, 1);

--insert into memo_group(id, name, user_id, public)
--values(nextval('memo_group_id_seq'), 'Ovidiu RO', 1, true);

--insert into memo_group(id, name, user_id, public)
--values(nextval('memo_group_id_seq'), 'Ovidiu RW', 1, true);

--- RO: 37, RW: 38
----select * from memo_group;

--insert into memo_acl(id, memo_group_id, user_group_id, access)
--values(nextval('memo_acl_id_seq'), 37, 25, 1);

--insert into memo_acl(id, memo_group_id, user_group_id, access)
--values(nextval('memo_acl_id_seq'), 38, 25, 2);

--select * from memo_acl;

CREATE OR REPLACE FUNCTION create_default_memo_groups(IN p_user_id integer, IN p_name users.username%TYPE)
RETURNS void AS $$
  DECLARE
    v_user_group_id integer;
    v_memo_group_id_ro integer;
    v_memo_group_id_rw integer;
    v_user_name users.username%TYPE;
    v_name users.username%TYPE;

    ADMIN_ID CONSTANT integer := 1;
    READ_ONLY_ACCESS CONSTANT integer := 1;
    READ_WRITE_ACCESS CONSTANT integer := 2;
  BEGIN
    -- Fetch the user name
    SELECT username INTO v_user_name FROM users WHERE id = p_user_id;
    v_name := COALESCE(p_name, v_user_name);

    -- Create a user group for the user; admin will own it
    INSERT INTO user_group (id, user_group_name, user_id)
    VALUES (nextval('user_group_id_seq'), v_name || ' (Individual)', ADMIN_ID)
    RETURNING id INTO v_user_group_id;

    -- Add the user to the user group
    INSERT INTO user_group_detail (id, user_group_id, user_id)
    VALUES (nextval('user_group_detail_id_seq'), v_user_group_id, p_user_id);

    -- Create a read-only memo group for the user
    INSERT INTO memo_group (id, name, user_id, public)
    VALUES (nextval('memo_group_id_seq'), v_name || ' RO', ADMIN_ID, true)
    RETURNING id INTO v_memo_group_id_ro;

    -- Create a read-write memo group for the user
    INSERT INTO memo_group (id, name, user_id, public)
    VALUES (nextval('memo_group_id_seq'), v_name || ' RW', ADMIN_ID, true)
    RETURNING id INTO v_memo_group_id_rw;

    -- Grant read-only access to the user group for the read-only memo group
    INSERT INTO memo_acl (id, memo_group_id, user_group_id, access)
    VALUES (nextval('memo_acl_id_seq'), v_memo_group_id_ro, v_user_group_id, READ_ONLY_ACCESS);

    -- Grant read-write access to the user group for the read-write memo group
    INSERT INTO memo_acl (id, memo_group_id, user_group_id, access)
    VALUES (nextval('memo_acl_id_seq'), v_memo_group_id_rw, v_user_group_id, READ_WRITE_ACCESS);

  END;
$$ LANGUAGE plpgsql;

