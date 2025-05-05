-- lists all user groups defined and groups them by user
SELECT json_agg(ow):: text AS json FROM
(SELECT json_build_object('owner', json_build_object('id', users.id, 'name', users.username), 'groups', x) ow FROM
users JOIN (
  SELECT user_id, json_agg(u_group) x FROM (
    SELECT user_id, json_build_object(
      'id', user_group.id, 
      'name', user_group_name, 
      'users', users) u_group 
    FROM user_group
    JOIN 
      (SELECT user_group_id, json_agg(json_build_object('id', users.id, 'name', username) ORDER BY users.id) AS users
         FROM user_group_detail JOIN users ON user_id = users.id
         GROUP BY user_group_id
      ) AS ugroups
      ON user_group.id = ugroups.user_group_id
  ) GROUP BY user_id
) ON users.id = user_id
  ORDER BY user_id
)
;
