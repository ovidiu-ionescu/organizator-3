WITH target_users AS (
    SELECT unnest($1::bigint[]) AS user_id
),
desired_roles AS (
    SELECT unnest($2::bigint[]) AS user_id, unnest($3::bigint[]) AS role_id
),
deleted AS (
    DELETE FROM user_roles
    WHERE user_id IN (SELECT user_id FROM target_users)
      AND (user_id, role_id) NOT IN (SELECT user_id, role_id FROM desired_roles)
)
INSERT INTO user_roles (user_id, role_id)
SELECT user_id, role_id FROM desired_roles
ON CONFLICT (user_id, role_id) DO NOTHING;
