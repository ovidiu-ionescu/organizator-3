-- get all memo groups with full details for the current user
-- and the public ones

--SELECT set_current_user ('username');

WITH current_user_details AS (
  -- Get current user ID and name once
  SELECT
    (current_setting('organizator.current_user'))::INTEGER AS id,
    (SELECT username FROM users WHERE id = (current_setting('organizator.current_user'))::INTEGER) AS name
),
user_group_users AS (
  -- Aggregate users for each user_group_id.
  -- Driven by user_group rather than by user_group_detail: a group with no members needs a
  -- row here too, or the join below finds nothing for it and the ACL entry naming it is
  -- dropped — so a grant on a group that is still empty could never be seen, raised or
  -- revoked, which is exactly the group a grant is most likely to be made on.
  SELECT
    ug.id AS user_group_id,
    COALESCE(
      json_agg(
        json_build_object(
          'id', u.id,
          'name', u.username
        )
        ORDER BY u.id
      ) FILTER (WHERE u.id IS NOT NULL),
      '[]'::JSON
    ) AS users_json
  FROM
    user_group ug
    LEFT JOIN user_group_detail ugd ON ugd.user_group_id = ug.id
    LEFT JOIN users u ON ugd.user_id = u.id
  GROUP BY
    ug.id
),
filtered_user_groups AS (
  -- Get user groups relevant to the current user, along with their users
  SELECT
    ug.id AS user_group_id,
    ug.user_group_name,
    ugu.users_json
  FROM
    user_group ug
    JOIN user_group_users ugu ON ug.id = ugu.user_group_id
--  WHERE
--    ug.user_id = (SELECT id FROM current_user_details) -- Filter by current user
),
memo_groups_with_access AS (
  -- Build the 'usergroups' array for each memo_group
  SELECT
    mg.id AS memo_group_id,
    mg.name AS memo_group_name,
    -- Whether every user can see this group, not just its owner. It is why a group the
    -- caller does not own is in this result at all, so the screen has to be able to say so.
    mg.public AS memo_group_public,
    COALESCE(
      json_agg(
        json_build_object(
          'id', fug.user_group_id,
          'name', fug.user_group_name,
          'access', ma.access,
          'users', fug.users_json
        )
        ORDER BY fug.user_group_id
      ) FILTER (WHERE fug.user_group_id IS NOT NULL), -- Only aggregate if there's a joined user group
      '[]'::JSON -- Default to empty array if no user groups
    ) AS usergroups_array
  FROM
    memo_group mg
    LEFT JOIN memo_acl ma ON mg.id = ma.memo_group_id
    LEFT JOIN filtered_user_groups fug ON ma.user_group_id = fug.user_group_id
  WHERE mg.user_id = (SELECT id FROM current_user_details) OR mg.public
  GROUP BY
    mg.id, mg.name, mg.public -- both are functionally dependent on mg.id
  ORDER BY
    mg.id
)
SELECT
  json_build_object(
    'memogroups', (
      -- COALESCE, because json_agg over no rows is SQL NULL, which would reach the client as
      -- `null` rather than `[]` — an empty list is what "no memo groups" means.
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'id', mgwa.memo_group_id,
            'name', mgwa.memo_group_name,
            'public', mgwa.memo_group_public,
            'usergroups', mgwa.usergroups_array
          )
        ),
        '[]'::JSON
      )
      FROM memo_groups_with_access mgwa
    ),
    'requester', json_build_object(
      'id', cud.id,
      'name', cud.name
    )
  )::TEXT AS json
FROM
  current_user_details cud;
