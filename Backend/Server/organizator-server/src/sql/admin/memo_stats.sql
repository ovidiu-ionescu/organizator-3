-- Counts of memos per user, for the admin screen.
--
-- The counting itself is in the database rather than here: memo is under FORCE ROW LEVEL
-- SECURITY and this runs as the application's own role, so a query written here could only
-- count the caller's own memos. public.memo_stats() is SECURITY DEFINER and sees every row,
-- and returns nothing but the counts. See
-- SQL/Updates/010_memo_stats_counts_without_reading.sql.

SELECT memo_stats() AS json;
