-- memo_id
SELECT
     memo.id,
     memo.title,
     memo.memotext,
     memo.savetime,
     memo.group_id,
     memo_group.name as group_name,
     users.id as user_id,
     users.username

     FROM memo 
     JOIN users ON memo.user_id = users.id
     LEFT JOIN memo_group ON memo.group_id = memo_group.id
     WHERE memo.id = $1
    ;
