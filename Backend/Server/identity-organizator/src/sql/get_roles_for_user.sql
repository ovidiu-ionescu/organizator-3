-- get the roles of a specific user by username, with the description that says which system each one
-- opens. Login takes only the names for the JWT; /me hands the whole role to a user who may not read
-- the admin-only /roles list, so that they can see what they have access to.
SELECT r.id,
       r.name,
       COALESCE(r.description, '') AS description
FROM roles r
JOIN user_roles ur ON r.id = ur.role_id
JOIN users u ON ur.user_id = u.id
WHERE u.username = $1
ORDER BY r.id
