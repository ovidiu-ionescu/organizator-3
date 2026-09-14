SELECT json_agg(row_to_json(roles))::text AS roles_json
FROM roles;
