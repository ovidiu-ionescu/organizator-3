-- The caller's own locations, by name.
--
-- No parameters: the caller is the id set_current_user placed in the session, which db.rs has
-- already resolved from the token for every statement of the request.
--
-- Ordered by name rather than by last_used: nothing maintains that column yet — no statement
-- writes it — so ordering by it would order by a column of NULLs, in whatever order the planner
-- felt like. Name at least gives a list that does not move between calls.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
)
SELECT
  json_build_object(
    'locations',
    -- COALESCE because json_agg over no rows is NULL, and a client reading a null list sees a
    -- failure rather than "no locations yet".
    COALESCE(
      (
        SELECT
          json_agg(
            json_build_object(
              'id', location.id,
              'name', location.name,
              'latitude', location.latitude,
              'longitude', location.longitude,
              'timezone', location.timezone,
              'last_used', location.last_used
            )
            ORDER BY location.name
          )
        FROM location
        WHERE location.user_id = (SELECT user_id FROM current_user_row)
      ),
      '[]'::JSON
    ),
    'requester',
    json_build_object(
      'id', (SELECT user_id FROM current_user_row),
      -- Read back from the id so the response keeps the shape it had, without a parameter
      -- carrying a name the session already decides.
      'name', (
        SELECT users.username FROM users
        WHERE users.id = (SELECT user_id FROM current_user_row)
      )
    )
  )::TEXT AS json;
