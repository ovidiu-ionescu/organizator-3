# Database Design

As modern databases allow row based security, it should be used to protect 
access to documents. This way the rest of the application can be kept simple.

As the number of SQL statements is very limited, they should be prepared and 
cached for all database connections in the pool.

## PostgreSQL
For every statement dealing with the document database, an extra one should be 
prefixed to set the current user in the session.

Consider adding it as a feature to the library.

### Selecting from the memo table
Enable row based security for the memo table.
```sql
alter table memo enable row level security;
```
To force it even for the owner, you can specify force:
```sql
alter table memo force row level security;
```
Create a policy to allow the owner to see their own documents
and for the ones in the acl to access it.

```sql
create policy user_policy on memo for
select
  using (
    current_setting('organizator.current_user') :: integer = user_id
    or current_setting('organizator.current_user') :: integer in (
      select
        user_group_detail.user_id
      from
        memo_acl,
        user_group_detail
      where
        memo_acl.memo_group_id = group_id
        and memo_acl.access > 0
        and user_group_detail.user_group_id = memo_acl.user_group_id
    )
  )
```

```sql
set session "organizator.current_user" = 1;
```
This should filter the rows that can be selected in the memo table.

Create a function to set the current user in the session.
```sql 
CREATE OR REPLACE FUNCTION set_current_user(p_username VARCHAR(255)) RETURNS VOID AS $$
DECLARE
    user_id INT;
BEGIN
    -- Look up the user's ID in the users table
    SELECT id INTO user_id FROM users WHERE username = p_username;
    
    -- Check if the user exists
    IF user_id IS NULL THEN
        RAISE EXCEPTION 'User % not found', username;
    END IF;
    
    -- Set the session variable
    PERFORM set_config('organizator.current_user', user_id::TEXT, false);
END;
$$ LANGUAGE plpgsql;
```
Example usage:
```sql
SELECT set_current_user('admin'); SELECT * FROM memo;
```

Policy allowing owner to modify their own memos:
```sql
CREATE POLICY update_policy_owner ON memo
FOR UPDATE
USING (user_id = current_setting('organizator.current_user')::int);
```

We can not use row level security to restrict the columns that can be updated.\
For that is necessary to use a trigger.

- [x] A function should be created so that the id is set based on the user name.
- [x] Add security policy so that a user can modify its own memos.
- [ ] Add security policy so that a user can modify memos in the groups it is in but only the body.
- [ ] Add a trigger that will update the savetime, saveuser_id when the memo is saved
- [ ] Enhance the trigger to save a copy of the memo into the memo_history table.

## Passwords
Start using argon2 for password hashing.\

Policy allowing user to update their own password. Root (id=1) can update any password.
```sql
-- we use the table owner as the user so security is enforced
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- everybody can select
DROP POLICY IF EXISTS select_policy ON users;
CREATE POLICY select_policy on users
FOR SELECT USING(true)

DROP POLICY IF EXISTS update_policy ON users;
CREATE POLICY update_policy ON users
FOR UPDATE
USING (current_setting('organizator.current_user')::int in (id, 1));

DROP POLICY IF EXISTS insert_policy ON users;
CREATE POLICY insert_policy ON users
FOR INSERT
USING (current_setting('organizator.current_user')::int = 1);
```

Can check with:
```sql
select set_current_user('admin'); update users set password_hash = 'bha' where username = 'regular';
```

