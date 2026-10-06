-- Create a calendar entry of the caller's own.
--
-- $1 start_time (epoch milliseconds)
-- $2 end_time   (epoch milliseconds)
-- $3 description
-- $4 memo_text
-- $5 location_id, or NULL — the location is optional
-- $6 odate_type id, or NULL
--
-- The parameters are given their types in `requested`, once, and every use below reads a named
-- column instead. Left to inference, the `$2 > $1` comparison further down resolves both to
-- TEXT — the type Postgres falls back on when a comparison says nothing about its operands —
-- while the target column start_time wants BIGINT, and the two deductions conflict:
--
--     ERROR: inconsistent types deduced for parameter $1
--     DETAIL: text versus bigint
--
-- A literal in their place has a type of its own, so this only shows up with real bound
-- parameters; the statement passes in psql and fails from the application.
--
-- The owner is the id set_current_user placed in the session. db.rs has already resolved the
-- token into it for every statement of the request, so an entry is filed under a real row and
-- there is no second resolution here to disagree with the first.
--
-- Time is in milliseconds as the rest of this schema keeps it, and end must be after start: an
-- entry that ends before it begins cannot be drawn or compared sanely.
--
-- The location and the type, when given, have to be the caller's own. Without that check a
-- caller could attach their entry to somebody else's location by guessing an id, which would
-- both leak that the id exists and put a row in their own list pointing at another user's data.
-- NULL is always allowed: the location is optional and the type may not be set.

WITH requested AS (
  SELECT
    $1::BIGINT AS start_time,
    $2::BIGINT AS end_time,
    -- TEXT rather than VARCHAR(255): casting to the column's own width would truncate a
    -- too-long description silently, and the handler refuses one before it gets here.
    $3::TEXT AS description,
    $4::TEXT AS memo_text,
    $5::INTEGER AS location_id,
    $6::INTEGER AS type_id
),
current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
),
own_location AS (
  SELECT location.id
  FROM location
  CROSS JOIN requested
  WHERE location.id = requested.location_id
    AND location.user_id = (SELECT user_id FROM current_user_row)
),
own_type AS (
  SELECT odate_type.id
  FROM odate_type
  CROSS JOIN requested
  WHERE odate_type.id = requested.type_id
    AND odate_type.user_id = (SELECT user_id FROM current_user_row)
),
created AS (
  INSERT INTO odate (user_id, start_time, end_time, description, memo_text, location_id, type)
  SELECT
    current_user_row.user_id,
    requested.start_time,
    requested.end_time,
    requested.description,
    requested.memo_text,
    (SELECT id FROM own_location),
    (SELECT id FROM own_type)
  FROM current_user_row
  CROSS JOIN requested
  WHERE requested.end_time > requested.start_time
    AND current_user_row.user_id IS NOT NULL
    AND (requested.location_id IS NULL OR EXISTS (SELECT 1 FROM own_location))
    AND (requested.type_id IS NULL OR EXISTS (SELECT 1 FROM own_type))
  RETURNING id
)
SELECT
  json_build_object(
    'outcome',
    CASE
      WHEN (SELECT user_id FROM current_user_row) IS NULL THEN 'no_owner'
      WHEN requested.end_time <= requested.start_time THEN 'bad_interval'
      WHEN requested.location_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM own_location) THEN 'bad_location'
      WHEN requested.type_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM own_type) THEN 'bad_type'
      WHEN EXISTS (SELECT 1 FROM created) THEN 'created'
      ELSE 'refused'
    END,
    'id',
    (SELECT id FROM created)
  )::TEXT AS json
FROM requested;
