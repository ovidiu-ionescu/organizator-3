CREATE OR REPLACE FUNCTION set_current_user(
    IN p_username users.username%TYPE,
    OUT o_user_id users.id%TYPE
	--OUT o_username users.username%TYPE
	) AS $$
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
    PERFORM set_config('organizator.current_user', o_user_id::TEXT, false);
END;
$$ LANGUAGE plpgsql;
