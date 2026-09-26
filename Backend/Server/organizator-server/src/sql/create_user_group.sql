-- Create a user group owned by the caller.
--
-- $1 the new group's name
--
-- Refuses a name the caller already has a group under, so the list cannot fill up with two
-- rows the admin cannot tell apart. Anything else about the row comes from RETURNING rather
-- than from a read: a data-modifying statement and everything around it share one snapshot,
-- so a SELECT here could not see the row the INSERT just added (see add_user_group_member.sql).
-- A group that has just been created has nobody in it, which is what the response says.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
created AS (
  -- No id: user_group.id is serial, so the column default draws the next value (DDL/user_group.sql).
  INSERT INTO user_group (user_group_name, user_id)
  SELECT
    $1,
    current_user_row.user_id
  FROM current_user_row
  WHERE NOT EXISTS (
    SELECT 1
    FROM user_group
    WHERE user_group.user_id = current_user_row.user_id
      AND user_group.user_group_name = $1
  )
  RETURNING id, user_group_name
)
SELECT
  json_build_object(
    'outcome',
    CASE WHEN EXISTS (SELECT 1 FROM created) THEN 'created' ELSE 'name_taken' END,
    'group',
    (
      SELECT
        json_build_object(
          'id', created.id,
          'name', created.user_group_name,
          'users', '[]'::JSON
        )
      FROM created
    )
  )::TEXT AS json;
