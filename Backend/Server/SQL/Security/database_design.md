# Database Design

As modern databases allow row based security, it should be used to protect 
access to documents. This way the rest of the application can be kept simple.

As the number of SQL statements is very limited, they should be prepared and 
cached for all database connections in the pool.

## PostgreSQL
For every statement dealing with the document database, an extra one should be 
prefixed to set the current user in the session.

Consider adding it as a feature to the library.

### Selecting from the memo table
Enable row based security for the memo table.
```sql
alter table memo enable row level security;
```
To force it even for the owner, you can specify force:
```sql
alter table memo force row level security;
```
Create a policy to allow the owner to see their own documents
and for the ones in the acl to access it.

```sql
create policy user_policy on memo for
select
  using (
    current_setting('organizator.current_user') :: integer = user_id
    or current_setting('organizator.current_user') :: integer in (
      select
        user_group_detail.user_id
      from
        memo_acl,
        user_group_detail
      where
        memo_acl.memo_group_id = group_id
        and memo_acl.access > 0
        and user_group_detail.user_group_id = memo_acl.user_group_id
    )
  )
```

```sql
set session "organizator.current_user" = 1;
```
This should filter the rows that can be selected in the memo table.

- [ ] A function should be created so that the id is set based on the user name.
- [ ] Add security policy so that a user can modify its own memos.
- [ ] Add security policy so that a user can modify memos in the groups it is in.




