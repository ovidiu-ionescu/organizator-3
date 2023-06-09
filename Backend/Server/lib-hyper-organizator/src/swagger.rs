use tracing::info;

pub use submodule::add_swagger;

use tower::ServiceBuilder;

#[cfg(not(feature = "swagger"))]
mod submodule {
    use super::*;
    pub async fn add_swagger<L>(
        service_builder: ServiceBuilder<L>,
        _: &str,
        _: Option<String>,
    ) -> ServiceBuilder<L> {
        info!("No swagger support");
        service_builder
    }
}

#[cfg(feature = "swagger")]
mod submodule {
    use super::*;
    use crate::response_utils::{
        GenericMessage, IntoResultHyperResponse, PolymorphicGenericMessage,
    };
    use crate::typedef::GenericError;
    use http::{Request, Response};
    use hyper::Body;
    use std::sync::Arc;
    use utoipa_swagger_ui::Config;

    pub async fn add_swagger<L>(
        service_builder: ServiceBuilder<L>,
        swagger_path: &str,
        swagger_json: Option<String>,
    ) -> ServiceBuilder<Stack<SwaggerLayer, L>> {
        info!("Swagger support enabled");
        service_builder.layer(SwaggerLayer::new(swagger_path, swagger_json))
    }

    pub fn get_swagger_urls(path: &str) -> Vec<String> {
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

    /// Service the swagger ui files
    pub fn get_swagger_ui(
        swagger_file_path: &str,
        config: Arc<Config>,
    ) -> Result<Response<Body>, GenericError> {
        match utoipa_swagger_ui::serve(swagger_file_path, config) {
            Ok(swagger_file) => swagger_file
                .map(|file| {
                    Ok(Response::builder()
                        .header("content-type", file.content_type)
                        .body(Body::from(file.bytes.to_vec()))
                        .unwrap())
                })
                .unwrap_or_else(GenericMessage::not_found),
            Err(error) => GenericMessage::text_reply(error.to_string()),
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
        json:         Option<String>,
    }

    impl<'a> SwaggerLayer<'a> {
        pub fn new(target: &'a str, json: Option<String>) -> Self {
            Self {
                swagger_path: target,
                json,
            }
        }
    }

    impl<S> Layer<S> for SwaggerLayer<'_> {
        type Service = SwaggerService<S>;

        fn layer(&self, service: S) -> Self::Service {
            let swagger_path = format!(
                "{}{}",
                &self.swagger_path,
                if self.swagger_path.ends_with('/') {
                    ""
                } else {
                    "/"
                }
            );
            let config_path = format!("{}api-doc.json", &swagger_path);
            SwaggerService {
                swagger_paths: get_swagger_urls(self.swagger_path),
                swagger_path,
                swagger_config: Arc::new(Config::from(config_path)),
                json: self.json.clone().unwrap_or("{}".to_string()),
                service,
            }
        }
    }

    #[derive(Clone)]
    pub struct SwaggerService<S> {
        swagger_paths:  Vec<String>,
        swagger_path:   String,
        swagger_config: Arc<Config<'static>>,
        json:           String,
        service:        S,
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
            let is_swagger = self.swagger_paths.iter().any(|s| s == path);
            let is_redirect = !is_swagger && should_redirect(path, &self.swagger_path);
            info!(
                "is_swagger: {}, is_redirect: {}, swagger_path: {}",
                is_swagger, is_redirect, self.swagger_path
            );
            let computed_answer = if is_redirect {
                Some(GenericMessage::moved_permanently(&format!("{}/", path)))
            } else if is_swagger {
                if path.ends_with("api-doc.json") {
                    Some(self.json.clone().json_reply())
                } else {
                    Some(get_swagger_ui(
                        &path[self.swagger_path.len()..],
                        self.swagger_config.clone(),
                    ))
                }
            } else {
                None
            };

            let (res, fut) = if computed_answer.is_some() {
                (computed_answer, None)
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

    fn should_redirect(path: &str, swagger_path: &str) -> bool {
        if path.ends_with('/') {
            return false;
        }
        if swagger_path.starts_with(path) && swagger_path.len() == path.len() + 1 {
            return true;
        }
        false
    }
}
