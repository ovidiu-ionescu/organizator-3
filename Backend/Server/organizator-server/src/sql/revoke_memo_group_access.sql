-- Take a user group's access to a memo group away.
--
-- $1 memo_group.id
-- $2 user_group.id
--
-- "No access" is this and not an access level: the grant is the row, so removing the row is
-- removing the access. Everyone the group was shared with loses it, which is what revoking
-- means.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_group AS (
  -- The caller's own memo group, and only that: the admin role is for defining the public
  -- groups everyone uses, not for withdrawing access on somebody else's. A group that does not
  -- exist and one that is not the caller's are one answer.
  SELECT memo_group.id
  FROM memo_group
  CROSS JOIN current_user_row
  WHERE memo_group.id = $1
    AND memo_group.user_id = current_user_row.user_id
),
revoked AS (
  DELETE FROM memo_acl
  WHERE memo_group_id IN (SELECT id FROM owned_group)
    AND user_group_id = $2
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM owned_group) THEN 'no_group'
      WHEN EXISTS (SELECT 1 FROM revoked) THEN 'revoked'
      -- The group is the caller's, so this can only mean that user group had no access to
      -- take away — whether because it never did or because it has since been deleted.
      ELSE 'not_granted'
    END
  )::TEXT AS json;
