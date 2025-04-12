SELECT json_build_object(
  'data', json_agg(row_to_json(t)),
  'total', (SELECT count(*) FROM memo)
)::text AS json
FROM (
SELECT
  username, user_id, count(*) total, count(group_id) shared
  FROM memo INNER JOIN users
    ON memo.user_id = users.id
  GROUP BY user_id, username
  ORDER BY user_id
) t;
