-- Purpose: Get all memo groups of a user
SELECT memo_group.id as o_id, memo_group.name as o_name
FROM memo_group
JOIN users ON user_id = users.id
WHERE users.username = $1;
