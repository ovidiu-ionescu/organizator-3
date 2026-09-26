-- Delete one of the caller's own memo groups.
--
-- $1 memo_group.id
--
-- Its access grants go with it, because memo_acl_memo_group_id_fkey is ON DELETE CASCADE
-- (DDL/memo_acl.sql) — not because this statement says so. Memos that were shared through
-- the group stay in the database; what they lose is the group's access to them, which is
-- what deleting it means.

WITH current_user_row AS (
  SELECT
    (current_setting('organizator.current_user'))::INTEGER AS user_id,
    ((current_setting('organizator.current_user'))::INTEGER = 0) AS is_admin
),
owned_group AS (
  -- The caller's own group, or any group at all for the admin, who owns the seeded public
  -- ones. A group that does not exist and one that is not the caller's are one answer.
  SELECT memo_group.id
  FROM memo_group
  CROSS JOIN current_user_row
  WHERE memo_group.id = $1
    AND (current_user_row.is_admin OR memo_group.user_id = current_user_row.user_id)
),
removed AS (
  DELETE FROM memo_group
  WHERE id IN (SELECT id FROM owned_group)
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM owned_group) THEN 'no_group'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
      ELSE 'no_group'
    END
  )::TEXT AS json;
