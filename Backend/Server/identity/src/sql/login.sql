SELECT id,
       username,
       pbkdf2,
       salt
FROM users
WHERE username = $1;

