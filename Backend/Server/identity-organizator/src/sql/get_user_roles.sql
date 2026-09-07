-- get the roles of a specific user by username
SELECT r.name
FROM roles r
JOIN user_roles ur ON r.id = ur.role_id
JOIN users u ON ur.user_id = u.id
WHERE u.username = $1
