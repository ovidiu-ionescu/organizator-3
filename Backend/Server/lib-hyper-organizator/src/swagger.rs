use crate::settings::Settings;
use std::sync::Arc;
use tracing::info;
use utoipa_swagger_ui::Config;

pub use submodule::add_swagger;

#[derive(Clone)]
pub struct SwaggerUiConfig<'a> {
    pub path:   String,
    pub config: Arc<Config<'a>>,
}
use tower::ServiceBuilder;

impl SwaggerUiConfig<'_> {
    pub fn from(settings: &Settings) -> Self {
        let path = &settings.swagger_path;
        let path = format!("{}{}", path, if path.ends_with('/') { "" } else { "/" });
        let config = Arc::new(Config::from(format!("{}api-doc.json", &path)));

        Self { path, config }
    }
}

#[cfg(not(feature = "swagger"))]
mod submodule {
    use super::*;
    pub async fn add_swagger<L>(service_builder: ServiceBuilder<L>, _: &str) -> ServiceBuilder<L> {
        info!("No swagger support");
        service_builder
    }
}

#[cfg(feature = "swagger")]
mod submodule {
    use super::*;
    use crate::response_utils::{GenericMessage, PolymorphicGenericMessage};
    use crate::typedef::GenericError;
    use http::{Request, Response};
    use hyper::Body;

    pub async fn add_swagger<L>(
        service_builder: ServiceBuilder<L>,
        swagger_path: &str,
    ) -> ServiceBuilder<Stack<SwaggerLayer, L>> {
        info!("Swagger support enabled");
        service_builder.layer(SwaggerLayer::new(swagger_path))
    }

    pub fn get_swagger_urls(path: &str) -> Vec<String> {
        let path = format!("{}{}", path, if path.ends_with('/') { "" } else { "/" });
        vec![
            "",
            //"api-doc.json",
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

    pub fn get_swagger_ui(
        request: &Request<Body>,
    ) -> Result<Response<Body>, Box<dyn std::error::Error + Send + Sync>> {
        let swagger_ui_config = request
            .extensions()
            .get::<SwaggerUiConfig>()
            .ok_or_else(|| GenericError::from("No swagger config"))?;
        // minumn from the path
        let cutoff = std::cmp::min(swagger_ui_config.path.len(), request.uri().path().len());
        let path = &request.uri().path()[cutoff..];

        match utoipa_swagger_ui::serve(path, swagger_ui_config.config.clone()) {
            Ok(swagger_file) => swagger_file
                .map(|file| {
                    Ok(Response::builder()
                        .header("content-type", file.content_type)
                        .body(Body::from(file.bytes.to_vec()))
                        .unwrap())
                })
                .unwrap_or_else(GenericMessage::not_found),
            Err(error) => GenericMessage::text_reply(&error.to_string()),
        }
    }

    use futures::Future;
    use std::{
        pin::Pin,
        task::{Context, Poll},
    };
    use tower_layer::{Layer, Stack};
    use tower_service::Service;

    pub struct SwaggerLayer<'a> {
        swagger_path: &'a str,
    }

    impl<'a> SwaggerLayer<'a> {
        pub fn new(target: &'a str) -> Self {
            Self {
                swagger_path: target,
            }
        }
    }

    impl<S> Layer<S> for SwaggerLayer<'_> {
        type Service = SwaggerService<S>;

        fn layer(&self, service: S) -> Self::Service {
            SwaggerService {
                swagger_paths: get_swagger_urls(self.swagger_path),
                service,
            }
        }
    }

    #[derive(Clone)]
    pub struct SwaggerService<S> {
        swagger_paths: Vec<String>,
        service:       S,
    }

    unsafe impl<S> Send for SwaggerService<S> {}

    impl<S> Service<Request<Body>> for SwaggerService<S>
    where
        S: Service<Request<Body>, Response = hyper::Response<Body>, Error = GenericError>
            + std::marker::Send,
        S::Response: Send,
        S::Error: Into<GenericError>,
        S::Future: Send + 'static,
    {
        type Response = S::Response;
        type Error = S::Error;
        type Future =
            Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send + 'static>>;

        fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
            self.service.poll_ready(cx)
        }

        fn call(&mut self, request: Request<Body>) -> Self::Future {
            let path = request.uri().path();

            let (res, fut) = if self.swagger_paths.iter().any(|s| s == path) {
                (Some(get_swagger_ui(&request)), None)
            } else {
                (None, Some(self.service.call(request)))
            };

            Box::pin(async move {
                match res {
                    Some(swag) => swag,
                    None => fut.unwrap().await,
                }
            })
        }
    }
}
