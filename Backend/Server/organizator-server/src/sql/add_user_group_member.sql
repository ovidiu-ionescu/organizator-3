-- Add a user to one of the caller's own user groups.
--
-- $1 user_group.id
-- $2 users.username of the person being added
--
-- Reports which of four things happened and nothing else. The group is read afterwards by
-- get_user_group.sql rather than returned from here, and that split is not tidiness: a
-- data-modifying CTE and the query around it run against the *same snapshot*, so a SELECT in
-- this statement cannot see the row the INSERT has just added. Returning the group from here
-- gives back the member list from before the insert — the app then replaces its copy with one
-- that looks identical and the screen never changes, while the row is in the table all along.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owned_group AS (
  -- Empty when the group does not exist *or* belongs to someone else. Those two are one answer
  -- on purpose, the same way docs/api.md specifies the writes: a caller who cannot touch a
  -- group also cannot learn that it is there.
  SELECT user_group.id
  FROM user_group
  JOIN current_user_row ON user_group.user_id = current_user_row.user_id
  WHERE user_group.id = $1
),
new_member AS (
  SELECT users.id
  FROM users
  WHERE users.username = $2
),
added AS (
  -- No id: user_group_detail.id is serial, so the column default draws the next value.
  INSERT INTO user_group_detail (user_group_id, user_id)
  SELECT
    owned_group.id,
    new_member.id
  FROM owned_group
  CROSS JOIN new_member
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_group_detail AS existing
    WHERE existing.user_group_id = owned_group.id
      AND existing.user_id = new_member.id
  )
  RETURNING user_id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM owned_group) THEN 'no_group'
      WHEN NOT EXISTS (SELECT 1 FROM new_member) THEN 'no_user'
      WHEN EXISTS (SELECT 1 FROM added) THEN 'added'
      -- The group is the caller's and that user exists, so the insert can only have declined
      -- because they were already in it.
      ELSE 'already_member'
    END
  )::TEXT AS json;
