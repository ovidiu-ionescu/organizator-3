use crate::response_utils::{GenericMessage, PolymorphicGenericMessage};
use crate::settings::Settings;
use crate::typedef::GenericError;
use http::{Request, Response};
use hyper::Body;
use std::sync::Arc;
use utoipa_swagger_ui::Config;

#[derive(Clone)]
pub struct SwaggerUiConfig<'a> {
    pub path:   String,
    pub config: Arc<Config<'a>>,
}

impl SwaggerUiConfig<'_> {
    pub fn from(settings: &Settings) -> Self {
        let path = &settings.swagger_path;
        let path = format!("{}{}", path, if path.ends_with('/') { "" } else { "/" });
        let config = Arc::new(Config::from(format!("{}api-doc.json", &path)));

        Self { path, config }
    }
}

pub fn get_swagger_urls(settings: &Settings) -> Vec<String> {
    let path = &settings.swagger_path;
    let path = format!("{}{}", path, if path.ends_with('/') { "" } else { "/" });
    vec![
        "",
        "api-doc.json",
        "index.css",
        "swagger-initializer.js",
        "swagger-ui-bundle.js",
        "swagger-ui.css",
        "swagger-ui-standalone-preset.js",
    ]
    .iter()
    .map(|s| format!("{}{}", path, s))
    .collect()
}

pub async fn get_swagger_ui(
    request: Request<Body>,
) -> Result<Response<Body>, Box<dyn std::error::Error + Send + Sync>> {
    let swagger_ui_config = request
        .extensions()
        .get::<SwaggerUiConfig>()
        .ok_or_else(|| GenericError::from("No swagger config"))?;
    // minumn from the path
    let cutoff = std::cmp::min(swagger_ui_config.path.len(), request.uri().path().len());
    let path = &request.uri().path()[cutoff..];

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
