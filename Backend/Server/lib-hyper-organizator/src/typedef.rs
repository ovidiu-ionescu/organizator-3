use http::Response;
use hyper::Body;
use std::borrow::Cow;

pub type GenericError = Box<dyn std::error::Error + Send + Sync>;
pub trait ServiceResult:
    futures_util::Future<Output = Result<Response<Body>, GenericError>> + Send + 'static
{
}
pub trait ServiceFunction: FnMut(http::Request<hyper::Body>) -> dyn ServiceResult {}

pub type VectorString<'a> = Cow<'a, [Cow<'a, str>]>;
