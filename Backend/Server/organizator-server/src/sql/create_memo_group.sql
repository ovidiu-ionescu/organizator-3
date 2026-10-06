-- Create a memo group owned by the caller.
--
-- $1 the new group's name
-- $2 whether every user may see it — honoured for an admin and ignored for anyone else
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so an admin creating a public group owns it
-- the same way anyone creating a private one owns theirs, and no name is resolved again here.
--
-- Refuses a name the caller would then see twice, so the list cannot fill up with two rows
-- nobody can tell apart. What a caller sees is their own groups and the public ones, so a name
-- another user has privately is free — neither of them ever has both in front of them — while a
-- public one is in everybody's list and is taken. The same rule rename_memo_group.sql keeps.
-- Like the user-group name rule this is the endpoint's, not the schema's: memo_group.name
-- carries no unique constraint (DDL/memo_group.sql).

-- The parameters are given their types in `requested`, once, and the rest of the statement
-- reads named columns. Left to inference this fails: the name compared against the varchar
-- column is resolved through the `text = text` operator — varchar is binary-coercible to text,
-- so that is the operator Postgres picks — and the parameter becomes TEXT there, while the
-- column it is inserted into says CHARACTER VARYING. The two deductions conflict:
--
--     ERROR: inconsistent types deduced for parameter $1
--     DETAIL: text versus character varying
--
-- A literal has a type of its own, so this only appears with real bound parameters: the
-- statement passes in psql and fails from the application.
--
-- TEXT rather than the column's own VARCHAR(255): casting to that width would cut a too-long
-- name down to fit in silence.
--
WITH requested AS (
  SELECT $1::TEXT AS name
),
current_user_row AS (
  SELECT
    (current_setting('organizator.current_user'))::INTEGER AS user_id,
    (current_setting('organizator.current_user_is_admin'))::BOOLEAN AS is_admin
),
created AS (
  -- No id: memo_group.id is serial, so the column default draws the next value.
  INSERT INTO memo_group (name, user_id, public)
  SELECT
    requested.name,
    current_user_row.user_id,
    -- Only an admin publishes to everyone. Someone else asking gets a group of their own rather
    -- than a refusal: their screen never offers the choice, so an error would only ever surface
    -- as an unexplained failure, and a private group is the useful outcome.
    ($2::boolean AND current_user_row.is_admin)
  FROM current_user_row
  CROSS JOIN requested
  WHERE current_user_row.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM memo_group
      WHERE memo_group.name = requested.name
        AND (memo_group.user_id = current_user_row.user_id OR memo_group.public)
    )
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      -- A guard rather than an expected outcome: the setting is placed before this runs, so
      -- there is no name here left to fail to resolve.
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN EXISTS (SELECT 1 FROM created) THEN 'created'
      ELSE 'name_taken'
    END,
    'id',
    (SELECT id FROM created)
  )::TEXT AS json;
