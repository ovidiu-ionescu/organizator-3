use http::Response;
use hyper::Body;
use std::borrow::Cow;
use std::fmt::{Display, Formatter};
use std::ops::Deref;

pub type GenericError = Box<dyn std::error::Error + Send + Sync>;
pub trait ServiceResult:
    futures_util::Future<Output = Result<Response<Body>, GenericError>> + Send + 'static
{
}
pub trait ServiceFunction: FnMut(http::Request<hyper::Body>) -> dyn ServiceResult {}

pub type VectorString<'a> = Cow<'a, [Cow<'a, str>]>;

#[derive(Debug, PartialEq, Eq)]
pub struct UserId(pub String);
impl Display for UserId {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

pub struct UserRoles(pub Vec<String>);

pub struct SQLstr<'a>(pub &'a str);
impl<'a> Deref for SQLstr<'a> {
    type Target = &'a str;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
