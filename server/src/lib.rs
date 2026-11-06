pub mod config;
pub mod shutdown;

pub fn app() -> axum::Router {
    axum::Router::new()
        .route("/healthz", axum::routing::get(|| async { "ok" }))
        .layer(tower_http::trace::TraceLayer::new_for_http())
}
