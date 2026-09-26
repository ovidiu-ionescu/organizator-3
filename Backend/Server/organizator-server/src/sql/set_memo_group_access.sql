-- Grant a user group access to a memo group, or change the access it already has.
--
-- $1 memo_group.id
-- $2 user_group.id
-- $3 the access level: 1 for read, 2 for read and write
--
-- One statement for both cases, because the request carries the level the caller wants rather
-- than a change to apply: INSERT … ON CONFLICT DO UPDATE means the same thing whether or not a
-- row is already there, so granting and re-granting do not need two endpoints or a client that
-- knows which case it is in. The conflict target is
-- memo_acl_memo_group_id_user_group_id_key, the unique constraint the schema carries
-- (DDL/memo_acl.sql).
--
-- There is no level meaning "no access": none is the absence of the row, which revoking
-- expresses (revoke_memo_group_access.sql). Any other value is refused rather than stored.

WITH current_user_row AS (
  SELECT
    (current_setting('organizator.current_user'))::INTEGER AS user_id,
    ((current_setting('organizator.current_user'))::INTEGER = 0) AS is_admin
),
owned_group AS (
  -- The caller's own memo group, or any of them for the admin, who owns the seeded public
  -- ones. A group that does not exist and one that is not the caller's are one answer.
  SELECT memo_group.id
  FROM memo_group
  CROSS JOIN current_user_row
  WHERE memo_group.id = $1
    AND (current_user_row.is_admin OR memo_group.user_id = current_user_row.user_id)
),
grantable_group AS (
  -- The user group being granted. An admin may grant any group; anyone else may only grant
  -- one of their own, so they cannot hand out access to a group they do not control.
  SELECT user_group.id
  FROM user_group
  CROSS JOIN current_user_row
  WHERE user_group.id = $2
    AND (current_user_row.is_admin OR user_group.user_id = current_user_row.user_id)
),
written AS (
  -- No id: memo_acl.id is serial, so the column default draws the next value on the insert.
  INSERT INTO memo_acl (memo_group_id, user_group_id, access)
  SELECT owned_group.id, grantable_group.id, $3
  FROM owned_group
  CROSS JOIN grantable_group
  WHERE $3 IN (1, 2)
  ON CONFLICT (memo_group_id, user_group_id) DO UPDATE SET access = EXCLUDED.access
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM owned_group) THEN 'no_group'
      WHEN NOT EXISTS (SELECT 1 FROM grantable_group) THEN 'no_user_group'
      WHEN $3 NOT IN (1, 2) THEN 'bad_access'
      ELSE 'granted'
    END
  )::TEXT AS json;
