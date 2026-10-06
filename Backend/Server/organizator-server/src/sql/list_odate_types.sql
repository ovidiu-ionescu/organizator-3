-- The caller's own date types, by name.
--
-- No parameters: the caller is the id set_current_user placed in the session, which db.rs has
-- already resolved from the token for every statement of the request.

WITH current_user_row AS (
  SELECT (current_setting('organizator.current_user'))::INTEGER AS user_id
)
SELECT
  json_build_object(
    'odate_types',
    -- COALESCE because json_agg over no rows is NULL, and a client reading a null list sees a
    -- failure rather than "no types yet".
    COALESCE(
      (
        SELECT
          json_agg(
            json_build_object('id', odate_type.id, 'name', odate_type.name)
            ORDER BY odate_type.name
          )
        FROM odate_type
        WHERE odate_type.user_id = (SELECT user_id FROM current_user_row)
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
