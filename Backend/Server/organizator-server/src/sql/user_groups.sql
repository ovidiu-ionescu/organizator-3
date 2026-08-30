-- get all the user groups defined by the current user
SELECT
  json_build_object(
    'usergroups',
    json_agg(user_groups.usergroup),
    'requester',
    json_build_object(
      'id',
      current_setting('organizator.current_user'),
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
          usg.usrs
        ) AS usergroup
      FROM
        user_group
        JOIN (
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

