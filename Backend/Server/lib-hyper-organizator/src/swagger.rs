use crate::response_utils::{GenericMessage, PolymorphicGenericMessage};
use crate::settings::Settings;
use crate::typedef::GenericError;
use http::{Request, Response};
use hyper::Body;
use std::sync::Arc;
use tracing::debug;
use utoipa_swagger_ui::Config;

#[derive(Clone)]
pub struct SwaggerUiConfig<'a> {
    pub path:   String,
    pub config: Arc<Config<'a>>,
}

impl SwaggerUiConfig<'_> {
    pub fn from(settings: &Settings) -> Self {
        let path = settings.swagger_path.clone();

        let config = Arc::new(utoipa_swagger_ui::Config::from("/api-doc.json"));
        Self { path, config }
    }
}

pub async fn get_swagger_ui(
    request: Request<Body>,
) -> Result<Response<Body>, Box<dyn std::error::Error + Send + Sync>> {
    let swagger_ui_config = request
        .extensions()
        .get::<SwaggerUiConfig>()
        .ok_or_else(|| GenericError::from("No swagger config"))?;
    let path = &request.uri().path()[swagger_ui_config.path.len()..];

    match utoipa_swagger_ui::serve(path.as_ref(), swagger_ui_config.config.clone()) {
        Ok(swagger_file) => swagger_file
            .map(|file| {
                Ok(Response::builder()
                    .header("content-type", file.content_type)
                    .body(Body::from(file.bytes.to_vec()))
                    .unwrap())
            })
            .unwrap_or_else(|| GenericMessage::not_found()),
        Err(error) => GenericMessage::text_reply(&error.to_string()),
    }
}
