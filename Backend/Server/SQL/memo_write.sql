-- FUNCTION: public.memo_write(integer, character varying, text, bigint, integer, character varying)

-- DROP FUNCTION IF EXISTS public.memo_write(integer, character varying, text, bigint, integer, character varying);

CREATE OR REPLACE FUNCTION public.memo_write(
	INOUT io_memo_id integer,
	INOUT io_memo_title character varying,
	INOUT io_memo_memotext text,
	INOUT io_savetime bigint,
	INOUT io_memo_group_id integer,
	OUT o_memo_group_name character varying,
	OUT o_user_id integer,
	OUT o_username character varying,
	OUT o_requester_id integer,
	INOUT io_requester_name character varying)
    RETURNS record
    LANGUAGE 'plpgsql'
    COST 100
    VOLATILE PARALLEL UNSAFE
AS $BODY$
  DECLARE
    v_empty_content      boolean;
    v_old_title          io_memo_title%TYPE;
    v_old_memotext       io_memo_memotext%TYPE;
    v_old_memo_group_id  io_memo_group_id%TYPE;
    v_old_saveuser_id    memo.saveuser_id%TYPE;
    v_old_savetime       memo.savetime%TYPE;
    v_memo_group_user_id memo_group.user_id%TYPE;
	v_memo_group_public  memo_group.public%TYPE;
  BEGIN
    BEGIN
    -- 1) check the requester user exists
    SELECT users.id INTO STRICT o_requester_id FROM users WHERE users.username = io_requester_name;
    EXCEPTION 
      WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION 'user % not found', io_requester_name USING ERRCODE = '28000'; -- invalid_authorization_specification
      WHEN TOO_MANY_ROWS THEN
        RAISE EXCEPTION 'fetched more than one user for %', io_requester_name USING ERRCODE = '28000'; -- invalid_authorization_specification
    END;

    BEGIN
    -- fetch the owner of the memo group (also the name of the group)
      IF io_memo_group_id IS NOT NULL THEN
        SELECT user_id, name, public INTO STRICT v_memo_group_user_id, o_memo_group_name, v_memo_group_public FROM memo_group WHERE id = io_memo_group_id;
      END IF;
    EXCEPTION 
      WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION 'memo group % not found', io_memo_group_id USING ERRCODE = '02000'; -- no_data
    END;
      
    -- is the content of the new memo empty?
    v_empty_content := LENGTH(COALESCE(io_memo_title, '')) + LENGTH(COALESCE(io_memo_memotext, '')) = 0;

    -- are we creating a new memo?
    IF io_memo_id IS NULL THEN
      IF v_empty_content THEN
        -- 2) new memo can't be empty
        RAISE EXCEPTION 'You can not create an empty new memo' USING ERRCODE = '02000'; -- no_data
      END IF;

      o_user_id :=o_requester_id;
      o_username := io_requester_name;

      -- create the new memo
      io_memo_id := nextval('memo_id_seq');
      INSERT INTO memo (id, title, memotext, group_id, user_id, saveuser_id, savetime)
      VALUES (io_memo_id, io_memo_title, io_memo_memotext, io_memo_group_id, o_requester_id, o_requester_id, io_savetime);
    ELSE
      --update an existing memo
      
      -- fetch the old memo
      BEGIN
        SELECT memo.title, memo.memotext, memo.group_id, memo.user_id, memo.saveuser_id, memo.savetime, users.username
	  INTO STRICT v_old_title, v_old_memotext, v_old_memo_group_id, o_user_id, v_old_saveuser_id, v_old_savetime, o_username
	  FROM memo
	  JOIN users ON memo.user_id = users.id 
         WHERE memo.id = io_memo_id;
      EXCEPTION
      WHEN NO_DATA_FOUND THEN
        -- 3) Memo if specified, has to exist
        RAISE EXCEPTION 'memo % not found', io_memo_id USING ERRCODE = '02000'; -- no_data
      END;
     
      IF (io_memo_title IS NOT DISTINCT FROM v_old_title) 
	  AND (io_memo_memotext IS NOT DISTINCT FROM v_old_memotext) 
	  AND (io_memo_group_id IS NOT DISTINCT FROM v_old_memo_group_id)
	 THEN
	  -- 4) the previous memo is exactly the same, there's no need to save anything
	  RAISE NOTICE 'Memo values for % did not change, not saving', io_memo_id;
        RETURN;
      END IF;
      IF io_memo_group_id IS NOT NULL AND v_memo_group_user_id <> o_user_id AND (v_memo_group_public IS NOT TRUE)THEN
        -- 5) Owner can only change group_id to another one he owns
        RAISE EXCEPTION 'New memogroup belongs to user %, not user % who owns memo % and is not public',
          v_memo_group_user_id, o_user_id, io_memo_id
          USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
      END IF;

      IF o_requester_id = o_user_id THEN
        -- owner of the memo has full rights on the memo
        IF v_empty_content THEN
          -- delete the memo
          DELETE FROM memo WHERE id = io_memo_id;
          io_memo_id := NULL;
        ELSE
          -- modify the memo
          INSERT INTO memo_history (memo_id, group_id, title, memotext, user_id, saveuser_id, savetime)
          VALUES (io_memo_id, v_old_memo_group_id, v_old_title, v_old_memotext, o_user_id, v_old_saveuser_id, v_old_savetime);
          UPDATE memo SET 
            group_id = io_memo_group_id,
            title = io_memo_title,
            memotext = io_memo_memotext,
            saveuser_id = o_requester_id, -- same as user_id in this case
            savetime = io_savetime
          WHERE id = io_memo_id;
        END IF;
      ELSE
        -- requester is not owner, can only modify memotext
        IF io_memo_title <> v_old_title THEN
          RAISE EXCEPTION 'user % (%) is not allowed to modify title for memo % because memo is owned by %',
            o_requester_id, io_requester_name, io_memo_id, o_user_id
            USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
        END IF;
        IF io_memo_group_id <> v_old_memo_group_id THEN
          RAISE EXCEPTION 'user % (%) is not allowed to modify group id for memo % because memo is owned by %',
            o_requester_id, io_requester_name, io_memo_id, o_user_id
            USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
        END IF;
	-- check permission for user
	PERFORM memo_group_user_access(v_old_memo_group_id, o_requester_id, 2);

        -- update the memo
          INSERT INTO memo_history (memo_id, group_id, title, memotext, user_id, saveuser_id, savetime)
          VALUES (io_memo_id, v_old_memo_group_id, v_old_title, v_old_memotext, o_user_id, v_old_saveuser_id, v_old_savetime);
          UPDATE memo SET 
            memotext = io_memo_memotext,
            saveuser_id = o_requester_id,
            savetime = io_savetime
          WHERE id = io_memo_id;
      END IF;
      
    END IF;
    -- are we deleting an existing memo?
    -- does the group id belong to the memo owner?
    -- is the memo any different?
    -- does it belong to this user?
    -- write the old version to history
  END; 
$BODY$;

ALTER FUNCTION public.memo_write(integer, character varying, text, bigint, integer, character varying)
    OWNER TO organizator_prod;


