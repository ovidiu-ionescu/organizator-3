use serde::Serialize;
use tokio_postgres::row::Row;

pub trait DBPersistence {
    fn query() -> &'static str;
}

#[derive(Serialize)]
pub struct User {
    pub id:       i32,
    pub username: Option<String>,
}

#[derive(Serialize)]
pub struct MemoTitle {
    pub id:       i32,
    pub title:    Option<String>,
    pub user_id:  i32,
    pub savetime: Option<i64>,
}

#[derive(Serialize)]
pub struct MemoTitleList {
    pub memos: Vec<MemoTitle>,
    pub user:  User,
}

#[derive(Serialize)]
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

#[derive(Serialize)]
pub struct MemoGroupList {
    pub memogroups: Vec<MemoGroup>,
}

#[derive(Serialize)]
pub struct Memo {
    pub id:        i32,
    pub title:     Option<String>,
    pub memotext:  Option<String>,
    pub savetime:  Option<i64>,
    pub memogroup: Option<MemoGroup>,
    pub user:      MemoUser,
}

#[derive(Serialize)]
pub struct MemoUser {
    pub id:   i32,
    pub name: Option<String>,
}

#[derive(Serialize)]
pub struct GetMemo {
    memo: Memo,
    user: MemoUser,
}

impl From<Row> for GetMemo {
    fn from(row: Row) -> Self {
        let group_id: Option<i32> = row.get("o_memo_group_id");
        let memo_group = group_id.map(|id| MemoGroup {
            id,
            name: row.get("o_memo_group_name"),
        });

        Self {
            memo: Memo {
                id:        row.get("o_id"),
                title:     row.get("o_title"),
                memotext:  row.get("o_memotext"),
                savetime:  row.get("o_savetime"),
                memogroup: memo_group,
                user:      MemoUser {
                    id:   row.get("o_user_id"),
                    name: row.get("o_username"),
                },
            },
            user: MemoUser {
                id:   row.get("o_requester_id"),
                name: row.get("o_requester_name"),
            },
        }
    }
}

impl DBPersistence for GetMemo {
    fn query() -> &'static str {
        include_str!("sql/get_memo.sql")
    }
}

#[derive(Serialize)]
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
