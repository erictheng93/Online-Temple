pub mod config;
pub mod connection;
pub mod protocol;
pub mod room;
pub mod shutdown;

#[derive(Clone)]
pub struct AppState {
    pub origins: std::sync::Arc<Vec<String>>,
    pub lobby: room::Lobby,
}

pub fn app(allowed_origins: Vec<String>) -> axum::Router {
    app_with_capacity(allowed_origins, 50)
}
pub fn app_with_capacity(allowed_origins: Vec<String>, capacity: usize) -> axum::Router {
    axum::Router::new()
        .route("/healthz", axum::routing::get(|| async { "ok" }))
        .route("/ws", axum::routing::get(connection::upgrade))
        .with_state(AppState {
            origins: std::sync::Arc::new(allowed_origins),
            lobby: room::Lobby::new(capacity),
        })
        .layer(tower_http::trace::TraceLayer::new_for_http())
}
