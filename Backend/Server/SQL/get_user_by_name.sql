CREATE OR REPLACE FUNCTION public.get_user_by_name(p_username character varying, OUT o_user_id integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
  BEGIN
    SELECT users.id INTO STRICT o_user_id FROM users WHERE users.username = p_username;
    EXCEPTION 
      WHEN NO_DATA_FOUND THEN
        RAISE EXCEPTION 'user % not found', p_username USING ERRCODE = '28000'; -- invalid_authorization_specification
      WHEN TOO_MANY_ROWS THEN
        RAISE EXCEPTION 'fetched more than one user for %', p_username USING ERRCODE = '28000'; -- invalid_authorization_specification
    END;
$function$
;

