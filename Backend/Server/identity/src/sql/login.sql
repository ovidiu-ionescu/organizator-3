-- get the data required to check if the user credentials are correct
SELECT id,
       username,
       password_hash
FROM users
WHERE username = $1;
