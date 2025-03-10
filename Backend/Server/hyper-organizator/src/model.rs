use serde::Serialize;
use tokio_postgres::row::Row;
use utoipa::ToSchema;
use uuid::Uuid;

/// This trait is used to define the SQL query that is used to fetch the data from the database.
pub trait DBPersistence {
    fn query() -> &'static str;
    fn search() -> &'static str {
        Self::query()
    }
}

/// This trait is used to define the name in the JSON response of the type.
/// "my_name": { ... }
pub trait Named {
    fn name() -> &'static str {
        std::any::type_name::<Self>()
    }
}

#[derive(Serialize, ToSchema)]
pub struct User {
    pub id:       i32,
    pub username: Option<String>,
}

#[derive(Serialize, ToSchema, Clone)]
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

impl DBPersistence for MemoTitle {
    fn query() -> &'static str {
        include_str!("sql/get_all_memo_titles.sql")
    }

    fn search() -> &'static str {
        include_str!("sql/search_memo.sql")
    }
}

impl From<Row> for MemoTitle {
    fn from(row: Row) -> Self {
        Self {
            id:       row.get("id"),
            title:    row.get("title"),
            user_id:  row.get("user_id"),
            savetime: row.get("savetime"),
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct MemoTitleList {
    pub memos: Vec<MemoTitle>,
    pub user:  User,
}

impl Named for Vec<MemoTitle> {
    fn name() -> &'static str {
        "memos"
    }
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

impl Named for MemoGroup {
  fn name() -> &'static str {
    "memogroups"
  }
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

impl Named for Memo {
  fn name() -> &'static str {
     "memo" 
  } 
}

#[derive(Serialize, ToSchema)]
pub struct MemoUser {
    pub id:   i32,
    pub name: Option<String>,
}

impl From<Row> for Memo {
    fn from(row: Row) -> Self {
      // display all field names to make sure they are correct
      //log::trace!("{:?}", row.columns());
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

#[derive(Serialize, ToSchema)]
pub struct GetWriteMemo {
    #[serde(flatten)]
    memo: Option<Memo>,
}

impl From<Row> for GetWriteMemo {
    fn from(row: Row) -> Self {
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
        }
    }
}

impl DBPersistence for GetWriteMemo {
    fn query() -> &'static str {
        include_str!("sql/write_memo.sql")
    }
}

impl Named for GetWriteMemo {
  fn name() -> &'static str {
    "memo"
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
    "memogroups"
  }
}

impl Named for Vec<ExplicitPermission> {
  fn name() -> &'static str {
    "permissions"
  }
}

#[derive(Serialize, Debug, ToSchema)]
pub struct FilePermission {
  user_id: i32,
  username: String,
  memo_group_id: Option<i32>,
  access: i32,
}

impl From<Row> for FilePermission {
  fn from(row: Row) -> Self {
    Self {
      user_id: row.get("o_user_id"),
      username: row.get("o_username"),
      memo_group_id: row.get("o_memo_group_id"),
      access: row.get("o_access"),
    }
  }
}

impl DBPersistence for FilePermission {
  fn query() -> &'static str {
    include_str!("sql/get_file_security.sql")
  }
}

impl Named for FilePermission {
  fn name() -> &'static str {
    "FilePermission"
  }
}

#[derive(Serialize, ToSchema)]
pub struct FilestoreFileDB {
  pub id: Uuid,
  pub user_id: i32,
  pub filename: String,
  pub memo_group_id: Option<i32>,
  pub uploaded_on: i64,
}

#[derive(Serialize, ToSchema)]
pub struct FilestoreFile {
  pub filename: String,
}

impl FilestoreFile {
  pub fn filename_no_extension(&self) -> &str {
    if let Some(pos) = self.filename.find('.') {
      &self.filename[..pos]
    } else {
      &self.filename
    }
  }
}

impl Named for Vec<FilestoreFileDB> {
  fn name() -> &'static str {
    "db_file_entries"
  }
}

impl From<Row> for FilestoreFileDB {
  fn from(row: Row) -> Self {
    Self {
      id: row.get("id"),
      user_id: row.get("user_id"),
      filename: row.get("filename"),
      memo_group_id: row.get("memo_group_id"),
      uploaded_on: row.get("uploaded_on"),
    }
  }
}

impl DBPersistence for FilestoreFileDB {
  fn query() -> &'static str {
    include_str!("sql/admin/filestore.sql")
  }
}
