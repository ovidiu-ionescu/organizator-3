-- Create a memo group owned by the caller.
--
-- $1 the new group's name
-- $2 whether every user may see it — honoured only for an admin, ignored for anyone else
--
-- Refuses a name the caller already has a memo group under, so the list cannot fill up with
-- two rows nobody can tell apart. Like the user-group name rule this is the endpoint's, not
-- the schema's: memo_group.name carries no unique constraint (DDL/memo_group.sql).
--
-- A caller who is not an admin asking for a public group gets a private one rather than an
-- error. The screen never offers them the choice, so a refusal would only ever surface as an
-- unexplained failure, and a group of their own is the useful outcome.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
owner AS (
  SELECT
    -- db.rs answers 0 as the requester for the admin account, which is the sentinel the rest
    -- of the schema tests for (the memo RLS policy, set_admin_user.sql). A group owned by
    -- nobody would be visible to nobody, so what an admin creates belongs to the admin
    -- account itself — user 1, the id the schema uses for it in create_default_memo_groups.sql.
    CASE WHEN user_id = 0 THEN 1 ELSE user_id END AS user_id,
    (user_id = 0) AS is_admin
  FROM current_user_row
),
created AS (
  -- No id: memo_group.id is serial, so the column default draws the next value.
  INSERT INTO memo_group (name, user_id, public)
  SELECT
    $1,
    owner.user_id,
    ($2::boolean AND owner.is_admin)
  FROM owner
  WHERE NOT EXISTS (
    SELECT 1
    FROM memo_group
    WHERE memo_group.user_id = owner.user_id
      AND memo_group.name = $1
  )
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE WHEN EXISTS (SELECT 1 FROM created) THEN 'created' ELSE 'name_taken' END,
    'id',
    (SELECT id FROM created)
  )::TEXT AS json;
