select memo.id id, memo.title title, memo.user_id, savetime
  from memo, users
 where user_id = users.id
   and users.username = $1

union all

select memo.id id, memo.title title, memo.user_id, savetime
from memo
  where memo.group_id in
    (
      select memo_acl.memo_group_id
       from user_group,
            user_group_detail,
            memo_acl,
            users
      where user_group.id = user_group_detail.user_group_id
        and user_group.id = memo_acl.user_group_id
        and user_group_detail.user_id = users.id
        and user_group.user_id <> users.id
        and users.username = $1
    )

union all

select 0, $1, users.id, 0
  from users
 where users.username = $1
;

