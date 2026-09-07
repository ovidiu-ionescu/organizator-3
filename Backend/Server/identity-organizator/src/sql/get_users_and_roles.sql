SELECT jsonb_agg(user_data)::text AS all_users
FROM (
    SELECT jsonb_build_object(
        'user', jsonb_build_object(
            'id', u.id,
            'name', u.username,
            'roles', COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'id', r.id,
                        'name', r.name,
                        'description', r.description
                    )
                ) FILTER (WHERE r.id IS NOT NULL),
                '[]'::jsonb
            )
        )
    ) AS user_data
    FROM users u
    LEFT JOIN user_roles ur ON u.id = ur.user_id
    LEFT JOIN roles r ON ur.role_id = r.id
    GROUP BY u.id, u.username
    ORDER BY u.id
) subquery;

