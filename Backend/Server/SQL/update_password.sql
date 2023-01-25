CREATE OR REPLACE FUNCTION public.update_password(p_requester_name character varying, p_username character varying, p_pbkdf2 bytea, p_salt bytea)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
  declare
  v_requester_id users.id%type;
  v_user_id users.id%TYPE;
begin
  select get_user_by_name(p_requester_name) into v_requester_id;
  select get_user_by_name(p_username) into v_user_id;
  if v_requester_id <> v_user_id and v_requester_id <> 1 then
      RAISE EXCEPTION 'User % is not allowed to change password for user %', p_requester_name, p_username
      USING ERRCODE = '2F003'; -- prohibited_sql_statement_attempted
  end if;
 
 update users set pbkdf2 = p_pbkdf2, salt = p_salt where id = v_user_id;
END; $function$
;

