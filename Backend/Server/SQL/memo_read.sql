CREATE OR REPLACE FUNCTION public.memo_read(p_memo_id integer, p_username character varying, 
  OUT o_id integer, 
  OUT o_title character varying, 
  OUT o_memotext text, 
  OUT o_savetime bigint, 
  OUT o_memo_group_id integer, 
  OUT o_memo_group_name character varying, 
  OUT o_user_id integer, 
  OUT o_username character varying, 
  OUT o_requester_id integer, 
  OUT o_requester_name character varying
)
 RETURNS record
 LANGUAGE plpgsql
AS $function$
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
  
  END; $function$
;

