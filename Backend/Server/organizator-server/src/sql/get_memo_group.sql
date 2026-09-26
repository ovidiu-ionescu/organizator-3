-- One memo group with the user groups granted on it.
--
-- $1 memo_group.id
--
-- The single-group form of memo_groups.sql, in the same shape as one element of its array, so
-- a caller that has just changed a memo group can replace its copy of that group exactly. The
-- handler only ever calls it for a group it has already established the caller may change.
--
-- Read as its own statement rather than as part of the write: see add_user_group_member.sql.
--
-- Deliberately without the member lists that memo_groups.sql nests inside each grant. The
-- screen shows a grant as a name and an access level and never renders those members, and
-- memo_groups.sql includes the members of *every* group in the database because its owner
-- filter is commented out — a leak this file does not have to repeat.

SELECT
  json_build_object(
    'id',
    memo_group.id,
    'name',
    memo_group.name,
    'public',
    memo_group.public,
    'usergroups',
    -- COALESCE because json_agg over no rows is NULL, and a null list reads as a failure
    -- rather than as a group nobody has been given access to yet.
    COALESCE(
      (
        SELECT
          json_agg(
            json_build_object(
              'id', user_group.id,
              'name', user_group.user_group_name,
              'access', memo_acl.access,
              'users', '[]'::JSON
            )
            ORDER BY user_group.id
          )
        FROM
          memo_acl
          JOIN user_group ON user_group.id = memo_acl.user_group_id
        WHERE
          memo_acl.memo_group_id = memo_group.id
      ),
      '[]'::JSON
    )
  )::TEXT AS json
FROM
  memo_group
WHERE
  memo_group.id = $1
  -- The same visibility rule the list uses: a group is the caller's, or it is public.
  AND (
    memo_group.user_id = (current_setting('organizator.current_user'))::INTEGER
    OR memo_group.public
  );
