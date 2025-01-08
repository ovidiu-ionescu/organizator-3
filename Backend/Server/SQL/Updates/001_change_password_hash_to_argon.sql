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
