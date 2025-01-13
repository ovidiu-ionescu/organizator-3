use serde::Serialize;
use tokio_postgres::row::Row;
use utoipa::ToSchema;

pub trait DBPersistence {
    fn query() -> &'static str;
}

pub trait Named {
    fn name() -> &'static str {
        std::any::type_name::<Self>()
    }
}

pub trait HasRequester {
    fn add_requester(&mut self, requester: Requester) -> Self;
}

#[derive(Serialize, ToSchema)]
pub struct User {
    pub id:       i32,
    pub username: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct Requester<'a> {
    pub id:       i32,
    pub username: &'a str,
}

#[derive(Serialize, ToSchema)]
pub struct MemoTitle {
    pub id:       i32,
    pub title:    Option<String>,
    pub user_id:  i32,
    pub savetime: Option<i64>,
}

#[derive(Serialize, ToSchema)]
pub struct MemoTitleList {
    pub memos: Vec<MemoTitle>,
    pub user:  User,
}

#[derive(Serialize, ToSchema)]
pub struct MemoGroup {
    pub id:   i32,
    pub name: String,
}

impl DBPersistence for MemoGroup {
    fn query() -> &'static str {
        include_str!("sql/get_memo_groups_for_user.sql")
    }
}

impl From<Row> for MemoGroup {
    fn from(row: Row) -> Self {
        Self {
            id:   row.get("o_id"),
            name: row.get("o_name"),
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct MemoGroupList {
    pub memogroups: Vec<MemoGroup>,
}

#[derive(Serialize, ToSchema)]
pub struct Memo {
    pub id:        i32,
    pub title:     Option<String>,
    pub memotext:  Option<String>,
    pub savetime:  Option<i64>,
    pub memogroup: Option<MemoGroup>,
    pub user:      MemoUser,
}

#[derive(Serialize, ToSchema)]
pub struct MemoUser {
    pub id:   i32,
    pub name: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct GetMemo<'a> {
    memo: Memo,
    requester: Option<Requester<'a>>,
}

impl From<Row> for Memo {
    fn from(row: Row) -> Self {
      // display all field names to make sure they are correct
      println!("{:?}", row.columns());
        let group_id: Option<i32> = row.get("group_id");
        let memo_group = group_id.map(|id| MemoGroup {
            id,
            name: row.get("group_name"),
        });

        Self {
                id:        row.get("id"),
                title:     row.get("title"),
                memotext:  row.get("memotext"),
                savetime:  row.get("savetime"),
                memogroup: memo_group,
                user:      MemoUser {
                    id:   row.get("user_id"),
                    name: row.get("username"),
                },
        }
    }
}

impl DBPersistence for Memo {
    fn query() -> &'static str {
        include_str!("sql/get_memo.sql")
    }
}

impl Named for Memo {
}

#[derive(Serialize, ToSchema)]
pub struct GetWriteMemo {
    memo: Option<Memo>,
    user: MemoUser,
}

impl From<&Row> for GetWriteMemo {
    fn from(row: &Row) -> Self {
        // not all memos are assigned to groups
        let group_id: Option<i32> = row.get("io_memo_group_id");
        let memo_group = group_id.map(|id| MemoGroup {
            id,
            name: row.get("o_memo_group_name"),
        });

        // when a memo gets deleted we don't get the id back
        let memo_id: Option<i32> = row.get("io_memo_id");
        let memo = memo_id.map(|id| Memo {
            id,
            title: row.get("io_memo_title"),
            memotext: row.get("io_memo_memotext"),
            savetime: row.get("io_savetime"),
            memogroup: memo_group,
            user: MemoUser {
                id:   row.get("o_user_id"),
                name: row.get("o_username"),
            },
        });

        Self {
            memo,
            user: MemoUser {
                id:   row.get("o_requester_id"),
                name: row.get("io_requester_name"),
            },
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct ExplicitPermission {
    pub memo_group_id:   i32,
    pub memo_group_name: Option<String>,
    pub user_group_id:   i32,
    pub user_group_name: Option<String>,
    pub user_id:         i32,
    pub username:        Option<String>,
    pub access:          i32,
}

impl From<Row> for ExplicitPermission {
    fn from(row: Row) -> Self {
        Self {
            memo_group_id:   row.get("memo_group_id"),
            memo_group_name: row.get("memo_group_name"),
            user_group_id:   row.get("user_group_id"),
            user_group_name: row.get("user_group_name"),
            user_id:         row.get("user_id"),
            username:        row.get("username"),
            access:          row.get("access"),
        }
    }
}

impl DBPersistence for ExplicitPermission {
    fn query() -> &'static str {
        include_str!("sql/get_explicit_memo_permissions.sql")
    }
}

impl Named for Vec<MemoGroup> {
  fn name() -> &'static str {
    "MemoGroupList"
  }
}

impl Named for Vec<ExplicitPermission> {
  fn name() -> &'static str {
    "ExplicitPermissionList"
  }
}
