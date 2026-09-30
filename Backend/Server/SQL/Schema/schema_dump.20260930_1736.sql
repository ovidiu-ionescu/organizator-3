--
-- PostgreSQL database dump
--

\restrict JjSS1glAkhtlsEix6sa20ZMxzQf4VZpWvEcrWWySyWau1U1rLreL52zF8JRG9ha

-- Dumped from database version 18.3 (Debian 18.3-1.pgdg13+1)
-- Dumped by pg_dump version 18.3 (Debian 18.3-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: correct_all_seq(); Type: FUNCTION; Schema: public; Owner: organizator_prod
--

CREATE FUNCTION public.correct_all_seq() RETURNS integer
    LANGUAGE plpgsql
    AS $$
begin
perform correct_seq('fileshare_acl');
perform correct_seq('fileshare');
perform correct_seq('location');
perform correct_seq('memo_acl');
perform correct_seq('memo_group');
perform correct_seq('memo');
perform correct_seq('odate');
perform correct_seq('odate_type');
perform correct_seq('script');
perform correct_seq('user_group_detail');
perform correct_seq('user_group');
perform correct_seq('users');
return 0;
end;
$$;


ALTER FUNCTION public.correct_all_seq() OWNER TO organizator_prod;

--
-- Name: correct_seq(character varying); Type: FUNCTION; Schema: public; Owner: organizator_prod
--

CREATE FUNCTION public.correct_seq(character varying) RETURNS integer
    LANGUAGE plpgsql
    AS $_$
DECLARE
	tabname ALIAS FOR $1;
	mx int;
BEGIN
	EXECUTE 'SELECT max(id) + 1 FROM ' || quote_ident(tabname) INTO mx;

	EXECUTE 'ALTER SEQUENCE ' || tabname || '_id_seq RESTART WITH ' || mx;
	RETURN mx;
END;
$_$;


ALTER FUNCTION public.correct_seq(character varying) OWNER TO organizator_prod;

--
-- Name: create_default_memo_groups(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_default_memo_groups(p_user_id integer) RETURNS void
    LANGUAGE plpgsql
    AS $$
  DECLARE
    v_user_group_id integer;
    v_memo_group_id_ro integer;
    v_memo_group_id_rw integer;
    v_user_name users.username%TYPE;

    ADMIN_ID CONSTANT integer := 1;
    READ_ONLY_ACCESS CONSTANT integer := 1;
    READ_WRITE_ACCESS CONSTANT integer := 2;
  BEGIN
    -- Fetch the user name
    SELECT username INTO v_user_name FROM users WHERE id = p_user_id;

    -- Create a user group for the user; admin will own it
    INSERT INTO user_group (id, user_group_name, user_id)
    VALUES (nextval('user_group_id_seq'), v_user_name || ' (Individual)', ADMIN_ID)
    RETURNING id INTO v_user_group_id;

    -- Add the user to the user group
    INSERT INTO user_group_detail (id, user_group_id, user_id)
    VALUES (nextval('user_group_detail_id_seq'), v_user_group_id, p_user_id);

    -- Create a read-only memo group for the user
    INSERT INTO memo_group (id, name, user_id, public)
    VALUES (nextval('memo_group_id_seq'), v_user_name || ' RO', ADMIN_ID, true)
    RETURNING id INTO v_memo_group_id_ro;

    -- Create a read-write memo group for the user
    INSERT INTO memo_group (id, name, user_id, public)
    VALUES (nextval('memo_group_id_seq'), v_user_name || ' RW', ADMIN_ID, true)
    RETURNING id INTO v_memo_group_id_rw;

    -- Grant read-only access to the user group for the read-only memo group
    INSERT INTO memo_acl (id, memo_group_id, user_group_id, access)
    VALUES (nextval('memo_acl_id_seq'), v_memo_group_id_ro, v_user_group_id, READ_ONLY_ACCESS);

    -- Grant read-write access to the user group for the read-write memo group
    INSERT INTO memo_acl (id, memo_group_id, user_group_id, access)
    VALUES (nextval('memo_acl_id_seq'), v_memo_group_id_rw, v_user_group_id, READ_WRITE_ACCESS);

  END;
$$;


ALTER FUNCTION public.create_default_memo_groups(p_user_id integer) OWNER TO postgres;

--
-- Name: create_default_memo_groups(integer, character varying); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_default_memo_groups(p_user_id integer, p_name character varying) RETURNS void
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.create_default_memo_groups(p_user_id integer, p_name character varying) OWNER TO postgres;

--
-- Name: file_user_access(uuid, character varying, integer); Type: FUNCTION; Schema: public; Owner: organizator_prod
--

CREATE FUNCTION public.file_user_access(i_id uuid, OUT o_requester_id integer, INOUT io_requester_name character varying, OUT o_user_id integer, OUT o_username character varying, OUT o_memo_group_id integer, i_min_required integer, OUT o_access integer) RETURNS record
    LANGUAGE plpgsql
    AS $$
  DECLARE
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
      SELECT filestore.user_id, filestore.memo_group_id, users.username INTO o_user_id, o_memo_group_id, o_username
      FROM filestore
      JOIN users ON filestore.user_id = users.id
      WHERE filestore.id = i_id;
      EXCEPTION 
        WHEN NO_DATA_FOUND THEN
          RAISE EXCEPTION 'file % not found', i_id USING ERRCODE = '02000'; -- no_data
    END;
    IF o_user_id = o_requester_id THEN
      o_access := 10;
      RETURN;
    END IF;

    -- if we are here the requester is not the file owner
    IF o_memo_group_id IS NULL THEN
      IF i_min_requred IS NOT NULL THEN
        RAISE EXCEPTION 'User % does not have permissions on file %', io_requester_name, i_id
          USING ERRCODE = '2F003'; -- prohibited_sql_statement_attempted
      ELSE
        o_access := 0;
        RETURN;
      END IF;
      
    END IF;
    -- check permission for user
    SELECT memo_group_user_access(o_memo_group_id, o_requester_id, i_min_required) INTO o_access;
  END; $$;


ALTER FUNCTION public.file_user_access(i_id uuid, OUT o_requester_id integer, INOUT io_requester_name character varying, OUT o_user_id integer, OUT o_username character varying, OUT o_memo_group_id integer, i_min_required integer, OUT o_access integer) OWNER TO organizator_prod;

--
-- Name: get_memo_access_level_for_requester(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.get_memo_access_level_for_requester(p_memo_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_user_id integer;
  v_memo_group_id memo_group.id%TYPE;
  v_owner_id memo.user_id%TYPE;

  FULL_ACCESS CONSTANT integer := 3;

BEGIN
  v_user_id = (current_setting('organizator.current_user'::text))::integer;
  SELECT user_id, group_id INTO v_owner_id, v_memo_group_id FROM memo WHERE id = p_memo_id;
  IF v_user_id = v_owner_id THEN
    RETURN FULL_ACCESS; -- Owner has full access
  END IF;

  RETURN COALESCE(
    (SELECT access FROM memo_acl
     WHERE memo_group_id = v_memo_group_id
       AND user_group_id IN (
         SELECT user_group_id FROM user_group_detail WHERE user_id = v_user_id
       )
     ORDER BY access DESC
     LIMIT 1),
    0 -- No access if no matching ACL entry is found
  );

  END;
$$;


ALTER FUNCTION public.get_memo_access_level_for_requester(p_memo_id integer) OWNER TO postgres;

--
-- Name: memo_group_user_access(integer, integer, integer); Type: FUNCTION; Schema: public; Owner: organizator_prod
--

CREATE FUNCTION public.memo_group_user_access(p_memo_group_id integer, p_user_id integer, p_min_required integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_access memo_acl.access%TYPE;
BEGIN
  SELECT MAX(memo_acl.access) INTO v_access
    FROM user_group,
         user_group_detail,
         memo_acl
   WHERE user_group.id = user_group_detail.user_group_id
     AND user_group.id = memo_acl.user_group_id
     AND user_group_detail.user_id = p_user_id -- requesting user is in this group
     -- and user_group.user_id <> o_requester_id -- not owner of the group
     AND memo_acl.memo_group_id = p_memo_group_id;

  IF v_access IS NULL OR (p_min_required IS NOT NULL AND v_access < p_min_required) THEN
    RAISE EXCEPTION 'User % does not have permissions on memo group %', p_user_id, p_memo_group_id
      USING ERRCODE = '2F003'; -- prohibited_sql_statement_attempted
  END IF;
  
  RETURN v_access;
END;
$$;


ALTER FUNCTION public.memo_group_user_access(p_memo_group_id integer, p_user_id integer, p_min_required integer) OWNER TO organizator_prod;

--
-- Name: memo_read(integer, character varying); Type: FUNCTION; Schema: public; Owner: organizator_prod
--

CREATE FUNCTION public.memo_read(p_memo_id integer, p_username character varying, OUT o_id integer, OUT o_title character varying, OUT o_memotext text, OUT o_savetime bigint, OUT o_memo_group_id integer, OUT o_memo_group_name character varying, OUT o_user_id integer, OUT o_username character varying, OUT o_requester_id integer, OUT o_requester_name character varying) RETURNS record
    LANGUAGE plpgsql
    AS $$
  DECLARE
    v_access  memo_acl.access%TYPE;
  BEGIN
    BEGIN
    -- check the requester user exists
    SELECT users.id INTO STRICT o_requester_id FROM users WHERE users.username = p_username;
    EXCEPTION 
      WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION 'user % not found', p_username USING ERRCODE = '28000'; -- invalid_authorization_specification
      WHEN TOO_MANY_ROWS THEN
        RAISE EXCEPTION 'fetched more than one user for %', p_username USING ERRCODE = '28000'; -- invalid_authorization_specification
    END;

    o_requester_name := p_username;

    -- fetch the memo
    SELECT
     memo.id,
     memo.title,
     memo.memotext,
     memo.savetime,
     memo.group_id,
     memo_group.name,
     users.id,
     users.username
     INTO o_id, o_title, o_memotext, o_savetime, o_memo_group_id, o_memo_group_name, o_user_id, o_username

     FROM memo 
     JOIN users ON memo.user_id = users.id
     LEFT JOIN memo_group ON memo.group_id = memo_group.id
     WHERE memo.id = p_memo_id
    ;

    -- check if we found the memo
    IF o_id IS NULL THEN
      RAISE EXCEPTION 'No memo with id %', p_memo_id USING ERRCODE = '02000'; -- no_data
    END IF;

    -- check if the requester is allowed to see the memo. if he's the owner he can by default
    IF o_user_id <> o_requester_id THEN
    --  if requester is not the memo owner see if there's an acl entry to grant permissions
      SELECT MAX(memo_acl.access) INTO v_access
        FROM user_group,
             user_group_detail,
             memo_acl
       WHERE user_group.id = user_group_detail.user_group_id
         AND user_group.id = memo_acl.user_group_id
         AND user_group_detail.user_id = o_requester_id -- requesting user is in this group
         -- and user_group.user_id <> o_requester_id -- not owner of the group
         AND memo_acl.memo_group_id = o_memo_group_id;

         IF v_access IS NULL THEN
           RAISE EXCEPTION 'User % does not have permissions on memo %', p_username, p_memo_id
	     USING ERRCODE = '2F004'; -- reading_sql_data_not_permitted;
          END IF;
     END IF;
  
  END; $$;


ALTER FUNCTION public.memo_read(p_memo_id integer, p_username character varying, OUT o_id integer, OUT o_title character varying, OUT o_memotext text, OUT o_savetime bigint, OUT o_memo_group_id integer, OUT o_memo_group_name character varying, OUT o_user_id integer, OUT o_username character varying, OUT o_requester_id integer, OUT o_requester_name character varying) OWNER TO organizator_prod;

--
-- Name: memo_write(integer, character varying, text, bigint, integer, character varying, uuid[]); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.memo_write(INOUT io_memo_id integer, INOUT io_memo_title character varying, INOUT io_memo_memotext text, INOUT io_savetime bigint, INOUT io_memo_group_id integer, OUT o_memo_group_name character varying, OUT o_user_id integer, OUT o_username character varying, OUT o_requester_id integer, INOUT io_requester_name character varying, i_files uuid[]) RETURNS record
    LANGUAGE plpgsql
    AS $$
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
		  -- update the included files
		  UPDATE filestore
		  SET memo_group_id = io_memo_group_id
		  WHERE user_id = o_user_id
		    AND id = ANY(i_files);
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
$$;


ALTER FUNCTION public.memo_write(INOUT io_memo_id integer, INOUT io_memo_title character varying, INOUT io_memo_memotext text, INOUT io_savetime bigint, INOUT io_memo_group_id integer, OUT o_memo_group_name character varying, OUT o_user_id integer, OUT o_username character varying, OUT o_requester_id integer, INOUT io_requester_name character varying, i_files uuid[]) OWNER TO postgres;

--
-- Name: set_current_user(character varying); Type: FUNCTION; Schema: public; Owner: organizator_prod
--

CREATE FUNCTION public.set_current_user(p_username character varying, OUT o_user_id integer) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    --o_user_id users.id%TYPE;
BEGIN
    BEGIN
    -- Look up the user's ID in the users table
    SELECT users.id INTO STRICT o_user_id FROM users WHERE users.username = p_username;
    EXCEPTION 
      WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION 'user % not found', p_username USING ERRCODE = '28000'; -- invalid_authorization_specification
      WHEN TOO_MANY_ROWS THEN
        RAISE EXCEPTION 'fetched more than one user for %', p_username USING ERRCODE = '28000'; -- invalid_authorization_specification
    END;
	--o_username := p_username;
    
    -- Set the session variable
    PERFORM set_config('organizator.current_user', o_user_id::TEXT, true);
END;
$$;


ALTER FUNCTION public.set_current_user(p_username character varying, OUT o_user_id integer) OWNER TO organizator_prod;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: contact; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.contact (
    id integer NOT NULL,
    user_id integer NOT NULL,
    type character(1),
    address character varying(65535),
    name character varying(65535),
    mobile character varying(255)
);


ALTER TABLE public.contact OWNER TO organizator_prod;

--
-- Name: contact_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.contact_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.contact_id_seq OWNER TO organizator_prod;

--
-- Name: contact_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.contact_id_seq OWNED BY public.contact.id;


--
-- Name: fileshare; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.fileshare (
    id integer NOT NULL,
    owner_id integer,
    filename character varying(255)
);


ALTER TABLE public.fileshare OWNER TO organizator_prod;

--
-- Name: fileshare_acl; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.fileshare_acl (
    id integer NOT NULL,
    file_id integer,
    user_id integer
);


ALTER TABLE public.fileshare_acl OWNER TO organizator_prod;

--
-- Name: fileshare_acl_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.fileshare_acl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fileshare_acl_id_seq OWNER TO organizator_prod;

--
-- Name: fileshare_acl_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.fileshare_acl_id_seq OWNED BY public.fileshare_acl.id;


--
-- Name: fileshare_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.fileshare_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fileshare_id_seq OWNER TO organizator_prod;

--
-- Name: fileshare_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.fileshare_id_seq OWNED BY public.fileshare.id;


--
-- Name: filestore; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.filestore (
    id uuid NOT NULL,
    user_id integer NOT NULL,
    filename character varying(255),
    memo_group_id integer,
    uploaded_on bigint
);


ALTER TABLE public.filestore OWNER TO organizator_prod;

--
-- Name: location; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.location (
    id integer NOT NULL,
    latitude double precision,
    longitude double precision,
    name character varying(255),
    timezone character varying(255),
    last_used bigint,
    user_id integer
);


ALTER TABLE public.location OWNER TO organizator_prod;

--
-- Name: location_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.location_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.location_id_seq OWNER TO organizator_prod;

--
-- Name: location_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.location_id_seq OWNED BY public.location.id;


--
-- Name: memo; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.memo (
    id integer NOT NULL,
    group_id integer,
    title character varying(255) NOT NULL,
    memotext text NOT NULL,
    user_id integer,
    savetime bigint,
    saveuser_id integer
);

ALTER TABLE ONLY public.memo FORCE ROW LEVEL SECURITY;


ALTER TABLE public.memo OWNER TO organizator_prod;

--
-- Name: memo_acl; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.memo_acl (
    id integer NOT NULL,
    memo_group_id integer,
    user_group_id integer,
    access integer
);


ALTER TABLE public.memo_acl OWNER TO organizator_prod;

--
-- Name: memo_acl_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.memo_acl_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.memo_acl_id_seq OWNER TO organizator_prod;

--
-- Name: memo_acl_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.memo_acl_id_seq OWNED BY public.memo_acl.id;


--
-- Name: memo_group; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.memo_group (
    id integer NOT NULL,
    name character varying(255) DEFAULT ''::character varying NOT NULL,
    user_id integer,
    public boolean
);


ALTER TABLE public.memo_group OWNER TO organizator_prod;

--
-- Name: memo_group_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.memo_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.memo_group_id_seq OWNER TO organizator_prod;

--
-- Name: memo_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.memo_group_id_seq OWNED BY public.memo_group.id;


--
-- Name: memo_history; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.memo_history (
    id integer NOT NULL,
    memo_id integer NOT NULL,
    group_id integer,
    title character varying(255),
    memotext text,
    user_id integer,
    saveuser_id integer,
    savetime bigint
);


ALTER TABLE public.memo_history OWNER TO organizator_prod;

--
-- Name: memo_history_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.memo_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.memo_history_id_seq OWNER TO organizator_prod;

--
-- Name: memo_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.memo_history_id_seq OWNED BY public.memo_history.id;


--
-- Name: memo_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.memo_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.memo_id_seq OWNER TO organizator_prod;

--
-- Name: memo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.memo_id_seq OWNED BY public.memo.id;


--
-- Name: odate; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.odate (
    id integer NOT NULL,
    user_id integer,
    start_time bigint,
    end_time bigint,
    memo_text text,
    location_id integer,
    description character varying(255),
    type integer,
    node integer
);


ALTER TABLE public.odate OWNER TO organizator_prod;

--
-- Name: odate_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.odate_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.odate_id_seq OWNER TO organizator_prod;

--
-- Name: odate_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.odate_id_seq OWNED BY public.odate.id;


--
-- Name: odate_type; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.odate_type (
    id integer NOT NULL,
    user_id integer,
    name character varying(255)
);


ALTER TABLE public.odate_type OWNER TO organizator_prod;

--
-- Name: odate_type_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.odate_type_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.odate_type_id_seq OWNER TO organizator_prod;

--
-- Name: odate_type_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.odate_type_id_seq OWNED BY public.odate_type.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.roles (
    id bigint NOT NULL,
    name character varying(50) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.roles OWNER TO organizator_prod;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

ALTER TABLE public.roles ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.roles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: script; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.script (
    id integer NOT NULL,
    user_id integer,
    code text
);


ALTER TABLE public.script OWNER TO organizator_prod;

--
-- Name: script_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.script_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.script_id_seq OWNER TO organizator_prod;

--
-- Name: script_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.script_id_seq OWNED BY public.script.id;


--
-- Name: url; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.url (
    id integer NOT NULL,
    group_id integer DEFAULT 0 NOT NULL,
    name character varying(255) DEFAULT ''::character varying NOT NULL,
    url character varying(255) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE public.url OWNER TO organizator_prod;

--
-- Name: url_group; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.url_group (
    id integer CONSTRAINT url_group_id_not_null1 NOT NULL,
    name character varying(255) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE public.url_group OWNER TO organizator_prod;

--
-- Name: url_group_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.url_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.url_group_id_seq OWNER TO organizator_prod;

--
-- Name: url_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.url_group_id_seq OWNED BY public.url_group.id;


--
-- Name: url_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.url_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.url_id_seq OWNER TO organizator_prod;

--
-- Name: url_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.url_id_seq OWNED BY public.url.id;


--
-- Name: user_group; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.user_group (
    id integer NOT NULL,
    user_group_name character varying(255),
    user_id integer
);


ALTER TABLE public.user_group OWNER TO organizator_prod;

--
-- Name: user_group_detail; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.user_group_detail (
    id integer NOT NULL,
    user_group_id integer,
    user_id integer
);


ALTER TABLE public.user_group_detail OWNER TO organizator_prod;

--
-- Name: user_group_detail_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.user_group_detail_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_group_detail_id_seq OWNER TO organizator_prod;

--
-- Name: user_group_detail_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.user_group_detail_id_seq OWNED BY public.user_group_detail.id;


--
-- Name: user_group_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.user_group_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_group_id_seq OWNER TO organizator_prod;

--
-- Name: user_group_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.user_group_id_seq OWNED BY public.user_group.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.user_roles (
    user_id bigint NOT NULL,
    role_id bigint NOT NULL,
    assigned_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.user_roles OWNER TO organizator_prod;

--
-- Name: users; Type: TABLE; Schema: public; Owner: organizator_prod
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(255),
    password text,
    msn_user character varying(255),
    msn_pwd character varying(255),
    imap text,
    xmpp_user character varying(255),
    mobile character varying(255),
    pbkdf2 bytea,
    salt bytea,
    password_hash text
);

ALTER TABLE ONLY public.users FORCE ROW LEVEL SECURITY;


ALTER TABLE public.users OWNER TO organizator_prod;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: organizator_prod
--

CREATE SEQUENCE public.users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO organizator_prod;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: organizator_prod
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: contact id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.contact ALTER COLUMN id SET DEFAULT nextval('public.contact_id_seq'::regclass);


--
-- Name: fileshare id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare ALTER COLUMN id SET DEFAULT nextval('public.fileshare_id_seq'::regclass);


--
-- Name: fileshare_acl id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare_acl ALTER COLUMN id SET DEFAULT nextval('public.fileshare_acl_id_seq'::regclass);


--
-- Name: location id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.location ALTER COLUMN id SET DEFAULT nextval('public.location_id_seq'::regclass);


--
-- Name: memo id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo ALTER COLUMN id SET DEFAULT nextval('public.memo_id_seq'::regclass);


--
-- Name: memo_acl id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_acl ALTER COLUMN id SET DEFAULT nextval('public.memo_acl_id_seq'::regclass);


--
-- Name: memo_group id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_group ALTER COLUMN id SET DEFAULT nextval('public.memo_group_id_seq'::regclass);


--
-- Name: memo_history id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_history ALTER COLUMN id SET DEFAULT nextval('public.memo_history_id_seq'::regclass);


--
-- Name: odate id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.odate ALTER COLUMN id SET DEFAULT nextval('public.odate_id_seq'::regclass);


--
-- Name: odate_type id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.odate_type ALTER COLUMN id SET DEFAULT nextval('public.odate_type_id_seq'::regclass);


--
-- Name: script id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.script ALTER COLUMN id SET DEFAULT nextval('public.script_id_seq'::regclass);


--
-- Name: url id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.url ALTER COLUMN id SET DEFAULT nextval('public.url_id_seq'::regclass);


--
-- Name: url_group id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.url_group ALTER COLUMN id SET DEFAULT nextval('public.url_group_id_seq'::regclass);


--
-- Name: user_group id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_group ALTER COLUMN id SET DEFAULT nextval('public.user_group_id_seq'::regclass);


--
-- Name: user_group_detail id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_group_detail ALTER COLUMN id SET DEFAULT nextval('public.user_group_detail_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: contact contact_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.contact
    ADD CONSTRAINT contact_pkey PRIMARY KEY (id);


--
-- Name: fileshare_acl fileshare_acl_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare_acl
    ADD CONSTRAINT fileshare_acl_pkey PRIMARY KEY (id);


--
-- Name: fileshare_acl fileshare_acl_user_id_key; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare_acl
    ADD CONSTRAINT fileshare_acl_user_id_key UNIQUE (user_id, file_id);


--
-- Name: fileshare fileshare_owner_id_key; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare
    ADD CONSTRAINT fileshare_owner_id_key UNIQUE (owner_id, filename);


--
-- Name: fileshare fileshare_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare
    ADD CONSTRAINT fileshare_pkey PRIMARY KEY (id);


--
-- Name: filestore filestore_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.filestore
    ADD CONSTRAINT filestore_pkey PRIMARY KEY (id);


--
-- Name: location location_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.location
    ADD CONSTRAINT location_pkey PRIMARY KEY (id);


--
-- Name: memo_acl memo_acl_memo_group_id_user_group_id_key; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_acl
    ADD CONSTRAINT memo_acl_memo_group_id_user_group_id_key UNIQUE (memo_group_id, user_group_id);


--
-- Name: memo_acl memo_acl_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_acl
    ADD CONSTRAINT memo_acl_pkey PRIMARY KEY (id);


--
-- Name: memo_group memo_group_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_group
    ADD CONSTRAINT memo_group_pkey PRIMARY KEY (id);


--
-- Name: memo_history memo_history_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_history
    ADD CONSTRAINT memo_history_pkey PRIMARY KEY (id);


--
-- Name: memo memo_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo
    ADD CONSTRAINT memo_pkey PRIMARY KEY (id);


--
-- Name: odate odate_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.odate
    ADD CONSTRAINT odate_pkey PRIMARY KEY (id);


--
-- Name: odate_type odate_type_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.odate_type
    ADD CONSTRAINT odate_type_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: script script_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.script
    ADD CONSTRAINT script_pkey PRIMARY KEY (id);


--
-- Name: script script_user_id_key; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.script
    ADD CONSTRAINT script_user_id_key UNIQUE (user_id);


--
-- Name: url_group url_group_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.url_group
    ADD CONSTRAINT url_group_pkey PRIMARY KEY (id);


--
-- Name: url url_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.url
    ADD CONSTRAINT url_pkey PRIMARY KEY (id);


--
-- Name: user_group_detail user_group_detail_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_group_detail
    ADD CONSTRAINT user_group_detail_pkey PRIMARY KEY (id);


--
-- Name: user_group user_group_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_group
    ADD CONSTRAINT user_group_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: users users_username_key1; Type: CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key1 UNIQUE (username, password);


--
-- Name: contact_index; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX contact_index ON public.contact USING btree (user_id);


--
-- Name: fileshare_acl_file_id_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX fileshare_acl_file_id_idx ON public.fileshare_acl USING btree (file_id);


--
-- Name: fileshare_acl_user_id_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX fileshare_acl_user_id_idx ON public.fileshare_acl USING btree (user_id);


--
-- Name: fki_memo_group_foreign_key; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX fki_memo_group_foreign_key ON public.memo USING btree (group_id);


--
-- Name: memo_acl_memo_group_id_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX memo_acl_memo_group_id_idx ON public.memo_acl USING btree (memo_group_id);


--
-- Name: memo_acl_user_group_id_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX memo_acl_user_group_id_idx ON public.memo_acl USING btree (user_group_id);


--
-- Name: odate_end_index_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX odate_end_index_idx ON public.odate USING btree (node, end_time);


--
-- Name: odate_end_index_uid_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX odate_end_index_uid_idx ON public.odate USING btree (user_id, node, end_time);


--
-- Name: odate_start_index_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX odate_start_index_idx ON public.odate USING btree (node, start_time);


--
-- Name: odate_start_index_uid_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX odate_start_index_uid_idx ON public.odate USING btree (user_id, node, start_time);


--
-- Name: user_group_detail_user_group_id_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX user_group_detail_user_group_id_idx ON public.user_group_detail USING btree (user_group_id);


--
-- Name: user_group_detail_user_id_idx; Type: INDEX; Schema: public; Owner: organizator_prod
--

CREATE INDEX user_group_detail_user_id_idx ON public.user_group_detail USING btree (user_id);


--
-- Name: contact contact_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.contact
    ADD CONSTRAINT contact_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: fileshare_acl fileshare_acl_file_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare_acl
    ADD CONSTRAINT fileshare_acl_file_id_fkey FOREIGN KEY (file_id) REFERENCES public.fileshare(id) ON DELETE CASCADE;


--
-- Name: fileshare_acl fileshare_acl_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.fileshare_acl
    ADD CONSTRAINT fileshare_acl_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: filestore filestore_memo_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.filestore
    ADD CONSTRAINT filestore_memo_group_id_fkey FOREIGN KEY (memo_group_id) REFERENCES public.memo_group(id);


--
-- Name: filestore filestore_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.filestore
    ADD CONSTRAINT filestore_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles fk_role; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_role FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles fk_user; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: memo_acl memo_acl_memo_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_acl
    ADD CONSTRAINT memo_acl_memo_group_id_fkey FOREIGN KEY (memo_group_id) REFERENCES public.memo_group(id) ON DELETE CASCADE;


--
-- Name: memo_acl memo_acl_user_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_acl
    ADD CONSTRAINT memo_acl_user_group_id_fkey FOREIGN KEY (user_group_id) REFERENCES public.user_group(id) ON DELETE CASCADE;


--
-- Name: memo memo_group_foreign_key; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo
    ADD CONSTRAINT memo_group_foreign_key FOREIGN KEY (group_id) REFERENCES public.memo_group(id) ON DELETE SET NULL NOT VALID;


--
-- Name: memo_history memo_history_memo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_history
    ADD CONSTRAINT memo_history_memo_id_fkey FOREIGN KEY (memo_id) REFERENCES public.memo(id) ON DELETE CASCADE;


--
-- Name: memo_history memo_history_saveuser_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_history
    ADD CONSTRAINT memo_history_saveuser_id_fkey FOREIGN KEY (saveuser_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: memo_history memo_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.memo_history
    ADD CONSTRAINT memo_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: script script_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.script
    ADD CONSTRAINT script_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_group_detail user_group_detail_user_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_group_detail
    ADD CONSTRAINT user_group_detail_user_group_id_fkey FOREIGN KEY (user_group_id) REFERENCES public.user_group(id) ON DELETE CASCADE;


--
-- Name: user_group_detail user_group_detail_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: organizator_prod
--

ALTER TABLE ONLY public.user_group_detail
    ADD CONSTRAINT user_group_detail_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: memo delete_memo_policy; Type: POLICY; Schema: public; Owner: organizator_prod
--

CREATE POLICY delete_memo_policy ON public.memo FOR DELETE USING (((current_setting('organizator.current_user'::text))::integer = user_id));


--
-- Name: memo insert_memo_policy; Type: POLICY; Schema: public; Owner: organizator_prod
--

CREATE POLICY insert_memo_policy ON public.memo FOR INSERT WITH CHECK (((current_setting('organizator.current_user'::text))::integer = user_id));


--
-- Name: memo; Type: ROW SECURITY; Schema: public; Owner: organizator_prod
--

ALTER TABLE public.memo ENABLE ROW LEVEL SECURITY;

--
-- Name: users select_policy; Type: POLICY; Schema: public; Owner: organizator_prod
--

CREATE POLICY select_policy ON public.users FOR SELECT USING (true);


--
-- Name: users update_policy; Type: POLICY; Schema: public; Owner: organizator_prod
--

CREATE POLICY update_policy ON public.users FOR UPDATE USING ((((current_setting('organizator.current_user'::text))::integer = id) OR ((current_setting('organizator.current_user'::text))::integer = 1)));


--
-- Name: memo update_policy_owner; Type: POLICY; Schema: public; Owner: organizator_prod
--

CREATE POLICY update_policy_owner ON public.memo FOR UPDATE USING ((user_id = (current_setting('organizator.current_user'::text))::integer));


--
-- Name: memo user_policy; Type: POLICY; Schema: public; Owner: organizator_prod
--

CREATE POLICY user_policy ON public.memo FOR SELECT USING ((((current_setting('organizator.current_user'::text))::integer = user_id) OR ((current_setting('organizator.current_user'::text))::integer = 0) OR ((current_setting('organizator.current_user'::text))::integer IN ( SELECT user_group_detail.user_id
   FROM public.memo_acl,
    public.user_group_detail
  WHERE ((memo_acl.memo_group_id = memo.group_id) AND (memo_acl.access > 0) AND (user_group_detail.user_group_id = memo_acl.user_group_id))))));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: organizator_prod
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: TABLE user_group; Type: ACL; Schema: public; Owner: organizator_prod
--

GRANT SELECT ON TABLE public.user_group TO auth;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: organizator_prod
--

GRANT SELECT ON TABLE public.users TO auth;


--
-- PostgreSQL database dump complete
--

\unrestrict JjSS1glAkhtlsEix6sa20ZMxzQf4VZpWvEcrWWySyWau1U1rLreL52zF8JRG9ha

