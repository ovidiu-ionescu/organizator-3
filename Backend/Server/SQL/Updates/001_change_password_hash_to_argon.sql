-- Purpose: Change the password hash from pbkdf2 to argon2.
DROP VIEW user_view;

ALTER TABLE users
ALTER COLUMN password
TYPE text;

CREATE VIEW user_view AS
 SELECT username,
    password
   FROM users;

-- Add a new column for the new password hash.
ALTER TABLE users ADD COLUMN password_hash text;

---------------------------------------------------
-- Set the row level security policy for the users table.

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
`
