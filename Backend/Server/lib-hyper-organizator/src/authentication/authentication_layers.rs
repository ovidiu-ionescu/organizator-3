use super::check_security::OrganizatorAuthorization;
use super::jot::Jot;
use http::header::AUTHORIZATION;
use std::sync::Arc;
use tower::ServiceBuilder;
use tower_http::propagate_header::PropagateHeaderLayer;
use tower_http::{add_extension::AddExtensionLayer, auth::RequireAuthorizationLayer};
use tower_layer::Stack;
use tracing::info;

#[cfg(feature = "security")]
pub fn add_authorization<L>(
    service_builder: ServiceBuilder<L>,
) -> ServiceBuilder<
    Stack<
        RequireAuthorizationLayer<OrganizatorAuthorization>,
        Stack<PropagateHeaderLayer, Stack<AddExtensionLayer<Arc<Jot>>, L>>,
    >,
> {
    info!("Security enabled");
    service_builder
        // Share an `Arc<Jot>` with all requests
        .layer(AddExtensionLayer::new(Arc::new(Jot::new().unwrap())))
        // Propagate the JWT token from the request to the response; if it's close
        // to expiring, a new one will be generated and returned in the response
        .layer(PropagateHeaderLayer::new(AUTHORIZATION))
        // If the response has a known size set the `Content-Length` header
        // .layer(SetResponseHeaderLayer::overriding(CONTENT_TYPE, content_length_from_response))
        // Authorize requests using a token
        .layer(RequireAuthorizationLayer::custom(OrganizatorAuthorization))
}

#[cfg(not(feature = "security"))]
pub fn add_authorization<L>(service_builder: ServiceBuilder<L>) -> ServiceBuilder<L> {
    info!("Security disabled");
    service_builder
}
