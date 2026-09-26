-- get all the user groups defined by the current user
SELECT
  json_build_object(
    'usergroups',
    -- COALESCE, because json_agg over no rows is SQL NULL, which would reach the client as
    -- `null` rather than `[]` — an empty list is what "this user owns no groups" means.
    COALESCE(json_agg(user_groups.usergroup), '[]'::JSON),
    'requester',
    json_build_object(
      -- ::INTEGER, because the setting is TEXT: without the cast the id goes out as the JSON
      -- string "7" while /memogroups sends the number 7 for the same person.
      'id',
      (current_setting('organizator.current_user'))::INTEGER,
      'name',
      (
        SELECT
          username
        FROM
          users
        WHERE
          id = (current_setting('organizator.current_user'::TEXT))::INTEGER
      )
    )
  )::TEXT AS json
FROM
  (
    (
      SELECT
        json_build_object(
          'id',
          user_group.id,
          'name',
          user_group.user_group_name,
          'users',
          COALESCE(usg.usrs, '[]'::JSON)
        ) AS usergroup
      FROM
        user_group
        -- LEFT JOIN, so a group with no members is still listed: it is the group a new
        -- member is about to be added to, and it would otherwise vanish from the response.
        LEFT JOIN (
          SELECT
            user_group_detail.user_group_id,
            json_agg(
              json_build_object(
                'id',
                user_group_detail.user_id,
                'name',
                users.username
              )
              ORDER BY
                users.id
            ) AS usrs
          FROM
            user_group_detail
            JOIN users ON user_group_detail.user_id = users.id
          GROUP BY
            user_group_detail.user_group_id
        ) usg ON user_group.id = usg.user_group_id
      WHERE
        user_group.user_id = (current_setting('organizator.current_user'::TEXT))::INTEGER
    )
  ) user_groups;

