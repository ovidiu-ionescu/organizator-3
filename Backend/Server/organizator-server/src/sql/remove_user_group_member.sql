-- Remove a user from one of the caller's own user groups.
--
-- $1 user_group.id
-- $2 users.username of the person being removed
--
-- Reports which of three things happened; the handler turns that into a status. The group is
-- read afterwards by get_user_group.sql, for the reason spelled out in
-- add_user_group_member.sql: a data-modifying CTE and the query around it share one snapshot,
-- so a SELECT here would return the member list from before the DELETE.

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
membership AS (
  -- Found by username rather than by user id: username is the only identifier every caller
  -- has, /user-roles being admin-only. A name nobody has simply matches nothing here, which
  -- is the same situation as a name that is not in the group — either way they are not a
  -- member, and telling those two apart would let a caller test which usernames are real.
  SELECT user_group_detail.id
  FROM user_group_detail
  JOIN users ON users.id = user_group_detail.user_id
  JOIN owned_group ON owned_group.id = user_group_detail.user_group_id
  WHERE users.username = $2
),
removed AS (
  DELETE FROM user_group_detail
  WHERE user_group_detail.id IN (SELECT id FROM membership)
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM owned_group) THEN 'no_group'
      WHEN EXISTS (SELECT 1 FROM removed) THEN 'removed'
      ELSE 'not_member'
    END
  )::TEXT AS json;
