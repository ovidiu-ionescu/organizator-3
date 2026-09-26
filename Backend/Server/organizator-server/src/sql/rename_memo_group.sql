-- Rename one of the caller's own memo groups.
--
-- $1 memo_group.id
-- $2 the new name
--
-- Only the outcome; the handler reads the group afterwards with get_memo_group.sql, for the
-- snapshot reason given in add_user_group_member.sql.

WITH current_user_row AS (
  SELECT
    (current_setting('organizator.current_user'))::INTEGER AS user_id,
    ((current_setting('organizator.current_user'))::INTEGER = 0) AS is_admin
),
owned_group AS (
  -- The caller's own group, or any group at all when the caller is the admin — the admin
  -- owns the seeded public groups and is the one account meant to look after them. A group
  -- that does not exist and one that is not the caller's are one answer on purpose.
  SELECT memo_group.id
  FROM memo_group
  CROSS JOIN current_user_row
  WHERE memo_group.id = $1
    AND (current_user_row.is_admin OR memo_group.user_id = current_user_row.user_id)
),
taken AS (
  -- Another of the caller's own memo groups already answers to the new name. Renaming a
  -- group to the name it already has is not a conflict, hence the id test.
  SELECT 1
  FROM memo_group
  CROSS JOIN current_user_row
  WHERE memo_group.name = $2
    AND memo_group.id <> $1
    AND memo_group.user_id = CASE WHEN current_user_row.is_admin THEN 1 ELSE current_user_row.user_id END
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
