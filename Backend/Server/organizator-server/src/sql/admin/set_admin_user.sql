-- The full-access identity, for a requester whose token carries the admin role.
--
-- Set for the transaction (the true), not for the session: set_config's third argument is
-- "is_local", and a session-level value outlives the COMMIT on a pooled connection, where the
-- next request to draw that connection would find itself still holding it.
SELECT set_config('organizator.current_user', '0', true);
