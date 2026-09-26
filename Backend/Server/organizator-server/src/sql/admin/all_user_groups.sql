-- lists all user groups defined and groups them by user
-- COALESCE, because json_agg over no rows is SQL NULL: it would reach the client as `null`
-- rather than `[]`, and the ::text cast keeps it NULL, which db::get_json reads as a String
-- and panics on — an empty report has to answer an empty list.
SELECT COALESCE(json_agg(ow), '[]'::JSON):: text AS json FROM
(SELECT json_build_object('owner', json_build_object('id', users.id, 'name', users.username), 'groups', x) ow FROM
users JOIN (
  SELECT user_id, json_agg(u_group) x FROM (
    SELECT user_id, json_build_object(
      'id', user_group.id, 
      'name', user_group_name, 
      'users', COALESCE(users, '[]'::JSON)) u_group
    FROM user_group
    -- LEFT JOIN, so a group with no members is still listed rather than dropped from the report
    LEFT JOIN
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
