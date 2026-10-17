-- memo_id
--
-- The whole history of one memo, and only for its owner.
--
-- memo_history has no row-level security — it is the one memo table without it — so a query that
-- left the scoping to the memo's own policy would hand the history of a memo to anyone who may
-- read the memo, shared readers included. The owner is the session's user, put there for this
-- transaction by db.rs, and the join to memo is what makes that predicate impossible to drop by
-- accident: there is no way to reach the history rows except through the memo they belong to.
--
-- Oldest first, by id: that is the order the rows were written in. savetime is deliberately not
-- the order — it is copied from the version it archives, repeats when two versions were saved in
-- the same moment, and has been rewritten by hand before.
--
-- The owner is joined rather than read as a number so that the response can name them, the way a
-- memo's own owner is named. The saver is left-joined because the column allows null.
SELECT
     h.id,
     h.memo_id,
     h.title,
     h.memotext,
     h.savetime,
     owner.id AS user_id,
     owner.username,
     saver.id AS saveuser_id,
     saver.username AS saveusername
     FROM memo_history h
     JOIN memo ON memo.id = h.memo_id
     JOIN users owner ON owner.id = h.user_id
     LEFT JOIN users saver ON saver.id = h.saveuser_id
     WHERE h.memo_id = $1
       AND memo.user_id = (current_setting('organizator.current_user'))::INTEGER
     ORDER BY h.id
    ;
