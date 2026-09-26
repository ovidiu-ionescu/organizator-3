-- One user group with its members, as the caller's own.
--
-- $1 user_group.id
--
-- The single-group form of user_groups.sql, in the same shape as one element of its array, so
-- a caller that has just changed a group can replace its copy of that group exactly.
--
-- Read as its own statement rather than as part of the write: see add_user_group_member.sql
-- for why a SELECT inside a data-modifying statement cannot see what that statement inserted.

SELECT
  json_build_object(
    'id',
    user_group.id,
    'name',
    user_group.user_group_name,
    'users',
    -- COALESCE because json_agg over no rows is NULL, and the app reads a null list as a
    -- failure rather than as a group with nobody in it — which is the state a group is in
    -- between being created and being filled.
    COALESCE(
      (
        SELECT
          json_agg(
            json_build_object('id', member.id, 'name', member.username)
            ORDER BY member.id
          )
        FROM
          user_group_detail
          JOIN users AS member ON user_group_detail.user_id = member.id
        WHERE
          user_group_detail.user_group_id = user_group.id
      ),
      '[]'::JSON
    )
  )::TEXT AS json
FROM
  user_group
WHERE
  user_group.id = $1
  -- The ownership test again, so this file is safe to call on its own and does not depend on
  -- the caller having been checked elsewhere.
  AND user_group.user_id = (current_setting('organizator.current_user'))::INTEGER;
