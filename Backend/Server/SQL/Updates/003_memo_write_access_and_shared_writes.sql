-- Purpose: make the write side of a memo behave like the read side — report what the requester
-- may do with it, and be honest when it did not save.
--
-- Three changes, in the order they matter:
--
-- 1. memo_write now returns o_access_level, computed by the same function the read path uses
--    (get_memo_access_level_for_requester), so the two cannot disagree about what a user may do
--    with a memo. Until now a write reply carried no level at all, and a client could not tell
--    whether the memo it had just saved was one it may keep editing.
--
-- 2. memo_write now raises 2F002 if its UPDATE affected no row. A row level security policy
--    filters rows rather than refusing statements: a policy that does not admit the requester
--    makes the UPDATE touch nothing and raise nothing, while the function reported success and
--    the client cleared its unsaved marker. The edit was gone and nothing had said so.
--
-- 3. The policy on memo admits a shared writer. It was USING (user_id = current_user), while
--    memo_write allowed a non-owner holding access 2 on the memo's group to write the body —
--    so the two disagreed, and change 2 turns that disagreement into a visible refusal instead
--    of silent loss. The policy now admits the owner, or anybody the memo's group was granted
--    access 2 or higher.
--
-- 4. A trigger holds the column rule at the table: the title, the group and the ownership of a
--    memo belong to its owner, and no write by anybody else may change them, whichever route the
--    write arrives by. The row policy cannot help here — RLS decides which rows may be updated
--    and has no say over columns. Ownership is in that list because the widened policy below
--    made it reachable: a member holding access 2 can update the row, so without this check
--    nothing would stop them reassigning user_id and taking the memo.
--
--    memo_write keeps its own check on the same two columns, and that is not the trigger written
--    twice; the two refuse different things. The function refuses the *request*: its caller hands
--    it a title and a group, and it says no when either differs from what is stored. The trigger
--    refuses the *effect*: it sees what an UPDATE would actually write, whoever issued it. Drop
--    the function's check and a non-owner editing the first line of a shared memo — the caller
--    splits the memo into title and body at the first newline — has that edit quietly dropped,
--    because the UPDATE the function issues does not set the title at all: the write succeeds and
--    reports back the title that was asked for, which the table never took.
--
--    Both checks use IS DISTINCT FROM rather than <>. With <> a non-owner sending no group at all
--    compares NULL against the stored group, which is never true, so "take this memo out of its
--    group" was neither applied nor refused — it vanished the same way.
--
-- So the three layers each decide one thing: the policy decides which rows, the trigger decides
-- which columns for every write to the table, and memo_write decides the rest — who may write at
-- all, what it refuses to be asked for, and whether the write it performed actually landed.
--
-- Access level 3 is reserved for a future "may also delete" grant. The policy does not need it:
-- the owner is admitted by the first branch, and >= 2 covers a member holding it.
--
-- The DROP is not optional: adding an OUT parameter changes the row type this function returns,
-- and CREATE OR REPLACE refuses to change a return type. Dropping loses the function's grants,
-- which is why they are restored at the bottom — there are none on this function today, but the
-- statement is what makes that a decision rather than an accident.
--
-- NOTE: apply this before deploying a server binary built from a model.rs that reads
-- o_access_level. That read is a plain `row.get`, and a column that is not there panics the
-- handler rather than answering an error.

DROP FUNCTION IF EXISTS public.memo_write(integer, character varying, text, bigint, integer, character varying, uuid[]);

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
	OUT o_access_level integer,
	INOUT io_requester_name character varying,
	i_files uuid[])
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

      -- the reply has to say what the requester may do with the memo they just created. Read
      -- it back rather than assuming the owner's level, so there is one definition of what
      -- "owner" is worth and it is the same one the read path uses.
      o_access_level := get_memo_access_level_for_requester(io_memo_id);
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
     
      -- Set before the "nothing changed" return just below, which leaves the function without
      -- ever reaching its end. The requester may be the owner or someone the memo group was
      -- shared with, so ask rather than assume.
      o_access_level := get_memo_access_level_for_requester(io_memo_id);

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
		  -- update the included files
		  UPDATE filestore
		  SET memo_group_id = io_memo_group_id
		  WHERE user_id = o_user_id
		    AND id = ANY(i_files);
        END IF;
      ELSE
        -- requester is not owner, so only the body is theirs to write. Refuse the request here
        -- rather than leaving it to the trigger on memo: the UPDATE below sets neither column, so
        -- the trigger would never see a title or group this caller tried to change, and the write
        -- would report success for an edit the table did not take. The trigger is what covers
        -- everything that does not come through this function.
        IF io_memo_title IS DISTINCT FROM v_old_title THEN
          RAISE EXCEPTION 'user % (%) is not allowed to modify title for memo % because memo is owned by %',
            o_requester_id, io_requester_name, io_memo_id, o_user_id
            USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
        END IF;
        IF io_memo_group_id IS DISTINCT FROM v_old_memo_group_id THEN
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

          -- The policy on memo decides which rows may be updated at all, and a policy that does
          -- not admit the requester filters the row away instead of refusing: the UPDATE then
          -- touches nothing, raises nothing, and this function goes on to report success. The
          -- client clears its unsaved marker for an edit the database never took, and the two
          -- copies diverge in silence. If the row was not written, say so.
          IF NOT FOUND THEN
            RAISE EXCEPTION 'memo % was not updated: the requester may not write it', io_memo_id
              USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
          END IF;
      END IF;
      
    END IF;
    -- are we deleting an existing memo?
    -- does the group id belong to the memo owner?
    -- is the memo any different?
    -- does it belong to this user?
    -- write the old version to history
  END; 
$BODY$;

-- The column rule: the title and the group of a memo belong to its owner. RLS decides which rows
-- may be updated and cannot decide which columns, so this is where that rule lives — on the
-- table, where every write passes, not only the ones that come through memo_write.
--
-- The requester is whoever the session is set to, the same source the policies read. A session
-- that never called set_current_user errors here rather than slipping past, exactly as it does
-- against the policies.
CREATE OR REPLACE FUNCTION public.memo_owner_only_columns() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_requester_id integer;
BEGIN
  v_requester_id := (current_setting('organizator.current_user'::text))::integer;

  IF v_requester_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.title IS DISTINCT FROM OLD.title THEN
      RAISE EXCEPTION 'memo % belongs to user %, so user % may not change its title',
        OLD.id, OLD.user_id, v_requester_id
        USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
    END IF;
    IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
      RAISE EXCEPTION 'memo % belongs to user %, so user % may not move it to another group',
        OLD.id, OLD.user_id, v_requester_id
        USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
    END IF;
    -- Ownership itself. Without this, the row policy above is enough to take a shared memo over:
    -- a member holding access 2 may reach the row, so nothing but this stops them reassigning
    -- user_id — and an owner who has been replaced in the row cannot see the memo any more.
    -- The owner may still hand their own memo to somebody else, as they may rename it; this
    -- stops everybody else.
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'memo % belongs to user %, so user % may not take it over',
        OLD.id, OLD.user_id, v_requester_id
        USING ERRCODE = '2F002'; -- modifying_sql_data_not_permitted
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS memo_owner_only_columns ON public.memo;

CREATE TRIGGER memo_owner_only_columns
    BEFORE UPDATE ON public.memo
    FOR EACH ROW
    EXECUTE FUNCTION public.memo_owner_only_columns();

-- The row rule, widened to agree with memo_write.
DROP POLICY IF EXISTS update_policy_owner ON public.memo;

CREATE POLICY update_policy_owner ON public.memo
    AS PERMISSIVE
    FOR UPDATE
    TO public
    USING (
      (user_id = (current_setting('organizator.current_user'::text))::integer)
      OR EXISTS (
        SELECT 1
          FROM memo_acl
          JOIN user_group_detail
            ON user_group_detail.user_group_id = memo_acl.user_group_id
         WHERE memo_acl.memo_group_id = memo.group_id
           AND memo_acl.access >= 2
           AND user_group_detail.user_id =
               (current_setting('organizator.current_user'::text))::integer
      )
    );
