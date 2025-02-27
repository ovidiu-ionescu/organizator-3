-- $1 uuid (no extension)
-- $2 user_id
-- $3 filename
-- $4 memo_group_id
-- $5 uploaded_on
INSERT INTO
  filestore(id, user_id, filename, memo_group_id, uploaded_on)
SELECT $1, $2, $3, memo_group.id, $5
FROM users LEFT JOIN memo_group ON users.id = memo_group.user_id AND memo_group.id = $4
WHERE users.id = $2
