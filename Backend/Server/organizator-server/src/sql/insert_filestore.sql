-- $1 uuid (no extension)
-- $2 filename
-- $3 memo_group_id
-- $4 uploaded_on
INSERT INTO
  filestore(id, user_id, filename, memo_group_id, uploaded_on)
SELECT $1, users.id, $2, memo_group.id, $4
FROM users LEFT JOIN memo_group ON users.id = memo_group.user_id AND memo_group.id = $3
WHERE users.id = current_setting('organizator.current_user'::text)::integer
