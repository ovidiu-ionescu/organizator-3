SELECT
  memo_group.id AS memo_group_id, memo_group.name AS memo_group_name, 
  memo_acl.user_group_id, user_group.user_group_name, 
  user_group_detail.user_id, users.username,
  memo_acl.access 
FROM memo_acl
JOIN memo_group on memo_acl.memo_group_id = memo_group.id
JOIN user_group_detail ON memo_acl.user_group_id = user_group_detail.user_group_id
JOIN user_group ON user_group.id = user_group_detail.user_group_id
JOIN users ON user_group_detail.user_id = users.id
JOIN users AS owner ON memo_group.user_id = owner.id
WHERE memo_acl.memo_group_id = $1
  AND owner.username = $2
ORDER BY user_group.id, users.id;

