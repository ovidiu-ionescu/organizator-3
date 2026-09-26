-- Delete one of the caller's own user groups.
--
-- $1 user_group.id
--
-- The members and the access grants go with it, because the schema says so and not because
-- this statement says so: user_group_detail_user_group_id_fkey and
-- memo_acl_user_group_id_fkey are both ON DELETE CASCADE (DDL/user_group_detail.sql,
-- DDL/memo_acl.sql). Deleting the rows here as well would only be a second way of doing what
-- the database already does.
--
-- That cascade means a memo group which granted this user group access loses the grant, and
-- everyone in the group loses the access it carried. Nothing here refuses that, because the
-- schema is built for it to happen; a caller who wants to be asked first has to check what
-- the group is granted on before deleting it.

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
removed AS (
  DELETE FROM user_group
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
