pub mod config;
pub mod connection;
pub mod protocol;
pub mod shutdown;

pub fn app(allowed_origins: Vec<String>) -> axum::Router {
    axum::Router::new()
        .route("/healthz", axum::routing::get(|| async { "ok" }))
        .route("/ws", axum::routing::get(connection::upgrade))
        .with_state(std::sync::Arc::new(allowed_origins))
        .layer(tower_http::trace::TraceLayer::new_for_http())
}
