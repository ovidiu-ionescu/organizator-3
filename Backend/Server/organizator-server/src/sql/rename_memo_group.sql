-- Rename one of the caller's own memo groups.
--
-- $1 memo_group.id
-- $2 the new name
--
-- Only the outcome; the handler reads the group afterwards with get_memo_group.sql, for the
-- snapshot reason given in add_user_group_member.sql.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_group AS (
  -- The caller's own group, and only that. The admin role is not an exception here: it is for
  -- defining the public groups everyone uses, not for changing what belongs to somebody else.
  -- A group that does not exist and one that is not the caller's are one answer on purpose.
  SELECT memo_group.id
  FROM memo_group
  CROSS JOIN current_user_row
  WHERE memo_group.id = $1
    AND memo_group.user_id = current_user_row.user_id
),
taken AS (
  -- A name the caller would then see twice, on the rule create_memo_group.sql sets out: their
  -- own groups, plus the public ones. A name another user holds privately is free — neither of
  -- them ever has both in front of them — while a public group is in everybody's list and is
  -- taken. Renaming a group to the name it already has is not a conflict, hence the id test.
  SELECT 1
  FROM memo_group
  CROSS JOIN current_user_row
  WHERE memo_group.name = $2
    AND memo_group.id <> $1
    AND (memo_group.user_id = current_user_row.user_id OR memo_group.public)
  LIMIT 1
),
renamed AS (
  UPDATE memo_group
  SET name = $2
  WHERE id IN (SELECT id FROM owned_group)
    AND NOT EXISTS (SELECT 1 FROM taken)
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM owned_group) THEN 'no_group'
      WHEN EXISTS (SELECT 1 FROM taken) THEN 'name_taken'
      ELSE 'renamed'
    END
  )::TEXT AS json;
