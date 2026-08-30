use serde::Serialize;
use utoipa::{
    IntoResponses, Modify, ToSchema,
    openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme},
};

pub struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth", // Security scheme name referenced in handlers
                SecurityScheme::Http(
                    HttpBuilder::new()
                        .scheme(HttpAuthScheme::Bearer)
                        .bearer_format("JWT") // Optional format label
                        .build(),
                ),
            );
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct ErrorMessage {
    pub message: String,
}

#[derive(IntoResponses)]
pub enum CommonError {
    #[response(status = 400, description = "Bad Request")]
    BadRequest(#[to_schema] ErrorMessage),

    #[response(status = 401, description = "Unauthorized - Missing or invalid token")]
    Unauthorized,

    #[response(status = 403, description = "Forbidden - Insufficient permissions")]
    Forbidden,

    #[response(status = 404, description = "Resource Not Found")]
    NotFound(#[to_schema] ErrorMessage),

    #[response(status = 500, description = "Internal Server Error")]
    InternalError,
}

#[macro_export]
macro_rules! declare_api_doc {
    () => {
        use lib_axum_organizator::utoipa_common::{CommonError, SecurityAddon};
        #[derive(OpenApi)]
        #[openapi(
                modifiers(&SecurityAddon)
              )]
        pub struct ApiDoc;
    };
}
