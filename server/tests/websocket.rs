use futures_util::{SinkExt, StreamExt};
use temple_server::app;
use tokio::time::{Duration, timeout};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
struct Server {
    url: String,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn server() -> Server {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}/ws", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app(vec!["http://localhost:5173".into()]))
            .await
            .unwrap();
    });
    Server { url, task }
}
async fn connect(server: &Server) -> Ws {
    let mut request = server.url.clone().into_client_request().unwrap();
    request
        .headers_mut()
        .insert("origin", "http://localhost:5173".parse().unwrap());
    connect_async(request).await.unwrap().0
}
async fn text(ws: &mut Ws, raw: &str) {
    ws.send(Message::Text(raw.to_owned().into())).await.unwrap();
}
async fn next(ws: &mut Ws) -> Message {
    timeout(Duration::from_secs(7), ws.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}
async fn closed(ws: &mut Ws, code: u16) {
    match next(ws).await {
        Message::Close(Some(frame)) => assert_eq!(u16::from(frame.code), code),
        other => panic!("expected close, got {other:?}"),
    }
}
const HELLO: &str = r#"{"t":"hello","v":1,"name":"測試"}"#;
#[tokio::test]
async fn origin_rejected_missing_and_foreign() {
    let server = server().await;
    for origin in [None, Some("https://evil.example")] {
        let mut request = server.url.clone().into_client_request().unwrap();
        if let Some(value) = origin {
            request
                .headers_mut()
                .insert("origin", value.parse().unwrap());
        }
        match connect_async(request).await.unwrap_err() {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), 403)
            }
            error => panic!("{error}"),
        }
    }
}
#[tokio::test]
async fn hello_timeout() {
    let server = server().await;
    let mut ws = connect(&server).await;
    let start = tokio::time::Instant::now();
    closed(&mut ws, 1008).await;
    assert!(start.elapsed() >= Duration::from_secs(5));
}
#[tokio::test]
async fn unsupported_version_then_close() {
    let server = server().await;
    let mut ws = connect(&server).await;
    text(&mut ws, r#"{"t":"hello","v":2,"name":"a"}"#).await;
    let message = next(&mut ws).await;
    let value: serde_json::Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
    assert_eq!(value["code"], "unsupported_version");
    closed(&mut ws, 1008).await;
}
#[tokio::test]
async fn oversized_and_binary_close_codes() {
    let server = server().await;
    for (message, code) in [
        (Message::Text("x".repeat(17 * 1024).into()), 1009),
        (Message::Binary(vec![1].into()), 1003),
    ] {
        let mut ws = connect(&server).await;
        ws.send(message).await.unwrap();
        closed(&mut ws, code).await;
    }
}
#[tokio::test]
async fn invalid_messages_ignored_until_twenty_one_and_ping_echoed() {
    let server = server().await;
    let mut ws = connect(&server).await;
    text(&mut ws, HELLO).await;
    for _ in 0..20 {
        text(&mut ws, "invalid").await;
    }
    text(&mut ws, r#"{"t":"ping","ts":123.25}"#).await;
    let message = next(&mut ws).await;
    let value: serde_json::Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
    assert_eq!(value["ts"], 123.25);
    assert!(value["serverTime"].as_f64().unwrap() > 1_700_000_000_000.0);
    text(&mut ws, "invalid").await;
    closed(&mut ws, 1008).await;
}
#[tokio::test]
async fn fragmented_message_limit() {
    use tokio_tungstenite::tungstenite::protocol::frame::{
        Frame,
        coding::{Data, OpCode},
    };
    let server = server().await;
    let mut ws = connect(&server).await;
    ws.send(Message::Frame(Frame::message(
        vec![b'x'; 9000],
        OpCode::Data(Data::Text),
        false,
    )))
    .await
    .unwrap();
    ws.send(Message::Frame(Frame::message(
        vec![b'x'; 9000],
        OpCode::Data(Data::Continue),
        true,
    )))
    .await
    .unwrap();
    closed(&mut ws, 1009).await;
}

#[tokio::test]
async fn exact_byte_limit_and_invalid_schema_do_not_break_session() {
    let server = server().await;
    let mut ws = connect(&server).await;
    text(&mut ws, HELLO).await;
    text(&mut ws, r#"{"t":"ping","ts":"wrong"}"#).await;
    let base = r#"{"t":"ping","ts":42,"padding":""}"#;
    let raw = base.replace(
        "\"padding\":\"\"",
        &format!("\"padding\":\"{}\"", "x".repeat(16384 - base.len())),
    );
    assert_eq!(raw.len(), 16384);
    text(&mut ws, &raw).await;
    assert!(next(&mut ws).await.to_text().unwrap().contains("pong"));
    text(&mut ws, &"\u{1f600}".repeat(5000)).await;
    closed(&mut ws, 1009).await;
}
