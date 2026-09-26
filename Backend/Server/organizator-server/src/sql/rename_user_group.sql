-- Rename one of the caller's own user groups.
--
-- $1 user_group.id
-- $2 the new name
--
-- Only the name is reported back; the handler reads the group itself afterwards with
-- get_user_group.sql, for the snapshot reason given in add_user_group_member.sql.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_group AS (
  -- Empty when the group does not exist *or* belongs to someone else — one answer on purpose,
  -- so a caller who cannot touch a group also cannot learn that it is there.
  SELECT user_group.id
  FROM user_group
  JOIN current_user_row ON user_group.user_id = current_user_row.user_id
  WHERE user_group.id = $1
),
taken AS (
  -- Another of the caller's own groups already answers to the new name. Renaming a group to
  -- the name it already has is not a conflict, hence the id test.
  SELECT 1
  FROM user_group
  JOIN current_user_row ON user_group.user_id = current_user_row.user_id
  WHERE user_group.user_group_name = $2
    AND user_group.id <> $1
  LIMIT 1
),
renamed AS (
  UPDATE user_group
  SET user_group_name = $2
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
