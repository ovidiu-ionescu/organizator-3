-- fetches the access level the requester has for a specific memo.
CREATE OR REPLACE FUNCTION get_memo_access_level_for_requester(IN p_memo_id memo.id%TYPE)
RETURNS integer AS $$
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
$$ LANGUAGE plpgsql;

