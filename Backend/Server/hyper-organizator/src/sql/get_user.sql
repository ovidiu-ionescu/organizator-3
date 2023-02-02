-- Description: Get a user by id
SELECT
id,
username
FROM users
WHERE id = $1
