use axum::response::Response;
use std::{error::Error as StdError, ops::Deref};

use crate::app_error::AppError;

pub type GenericError = Box<dyn StdError + Send + Sync>;

pub struct SQLstr<'a>(pub &'a str);
impl<'a> Deref for SQLstr<'a> {
    type Target = str;

    fn deref(&self) -> &Self::Target {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use crate::typedef::SQLstr;

    fn accept_destructure(SQLstr(sql): &SQLstr) {
        println!("{}", sql);
    }

    fn accept_dereference(sql: SQLstr) {
        println!("{}", &sql as &str);
    }
    #[test]
    fn check_types() {
        let sql = SQLstr("select * FROM dual;");
        accept_destructure(&sql);
        accept_dereference(sql);
    }
}

pub type HandlerResponse = Result<Response, AppError>;
