-- Make a memo group visible to every user, or stop it being.
--
-- $1 memo_group.id
-- $2 the new value
--
-- The admin's alone, and only on a group of their own: publishing is the one thing the role
-- adds, and it does not make somebody else's group theirs to publish. Anyone else is refused
-- here rather than in the handler, so the rule sits with the row it is about. Note that a
-- public group is returned by /memogroups to *every* caller, whether or not they own it —
-- that is what makes it usable by all of them.

WITH current_user_row AS (
  SELECT
    (current_setting('organizator.current_user'))::INTEGER AS user_id,
    (current_setting('organizator.current_user_is_admin'))::BOOLEAN AS is_admin
),
changed AS (
  UPDATE memo_group
  SET public = $2
  WHERE memo_group.id = $1
    AND memo_group.user_id = (SELECT user_id FROM current_user_row)
    AND (SELECT is_admin FROM current_user_row)
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN NOT (SELECT is_admin FROM current_user_row) THEN 'not_admin'
      WHEN EXISTS (SELECT 1 FROM changed) THEN 'changed'
      ELSE 'no_group'
    END
  )::TEXT AS json;
