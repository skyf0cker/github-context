# Readme



File: README.md
```
   1: # async-lsp
   2: 
   3: [![crates.io](https://img.shields.io/crates/v/async-lsp)](https://crates.io/crates/async-lsp)
   4: [![docs.rs](https://img.shields.io/docsrs/async-lsp)][docs]
   5: [![CI Status](https://github.com/oxalica/async-lsp/actions/workflows/ci.yaml/badge.svg)](https://github.com/oxalica/async-lsp/actions/workflows/ci.yaml)
   6: 
   7: Asynchronous [Language Server Protocol (LSP)][lsp] framework based on [tower].
   8: 
   9: [docs]: https://docs.rs/async-lsp
  10: [lsp]: https://microsoft.github.io/language-server-protocol/overviews/lsp/overview/
  11: [tower]: https://github.com/tower-rs/tower
  12: 
  13: ## Overview
  14: 
  15: This crate is centered at `trait LspService` which mainly consists of a tower
  16: `Service` of LSP requests and a handler of LSP notifications.
  17: 
  18: As protocol defines, requests can be processed concurrently (asynchronously),
  19: while notifications must be processed in order (synchronously), changing states
  20: and affecting semantics of later requests and/or notifications.
  21: 
  22: Request handling is designed in a decoupled manner with
  23: [tower-layer](https://crates.io/crates/tower-layer), so you can chain multiple
  24: request processing layer (aka. middleware) to build complex a service.
  25: 
  26: Despite the name of `LspService`, it can be used to build both Language Server
  27: and Language Client. They are logically symmetric and both using duplex
  28: channels. The only difference is the kind of requests and notifications they
  29: support.
  30: 
  31: ## Usage
  32: 
  33: See [examples](./examples).
  34: 
  35: ## Similar projects
  36: 
  37: ### [tower-lsp](https://crates.io/crates/tower-lsp)
  38: 
  39: async-lsp is heavily inspired by tower-lsp, we are both built on tower but have
  40: major design differences.
  41: 
  42: 1.  tower-lsp is less flexible and hard to use with tower ecosystem. It doesn't
  43:     support custom tower `Layer` since the `Service` interface is builtin. Both
  44:     server lifecycle handling and concurrency logic is built-in and is hard to
  45:     opt-opt or customize.
  46: 
  47:     async-lsp uses tower `Layer` to implement server lifecycle, concurrency,
  48:     tracing and more. Users can select and compose layers, or creating custom
  49:     ones.
  50: 
  51: 1.  tower-lsp handles notifications asynchronously, which is semantically
  52:     incorrect and introduces
  53:     [out-of-order issues](https://github.com/ebkalderon/tower-lsp/issues/284).
  54: 
  55:     async-lsp executes notification handlers synchronously, and allows it to
  56:     control main loop when, it needs to exit or something goes wrong.
  57: 
  58: 1.  tower-lsp's `trait LanguageServer` accepts immutable state `&self` for
  59:     concurrency. Thus state changing notifications like
  60:     `textDocument/didChange` always requires asynchronous locks, regarding that
  61:     the underlying communication channel is synchronous anyway.
  62: 
  63:     async-lsp accepts `&mut self` for requests and notifications, and the
  64:     former returns a `Future` without borrowing `self`. Requests borrows only
  65:     immutable states and can be run concurrently, while still being able to
  66:     mutate state (like snapshotting) during preparation.
  67: 
  68: 1.  tower-lsp provides some higher level abstractions over LSP specification to
  69:     make it more ergonomic, like generic `Client::show_message`, simplified
  70:     `LanguageServer::shutdown`, or planned
  71:     [`Progress`-API](https://github.com/ebkalderon/tower-lsp/issues/380).
  72: 
  73:     While this is not a goal of async-lsp. By default we doesn't do more than
  74:     serialization, deserialization and request/response `id` handling.
  75:     Parameters and interface follows the
  76:     [`lsp-types`](https://crates.io/crates/lsp-types)' `Request` and
  77:     `Notification` traits. But you are still free to implement your custom
  78:     `Request`s for extension, or custom middlewares for higher level API.
  79: 
  80: 1.  tower-lsp is specialized for building Language Servers.
  81: 
  82:     async-lsp can be used for both Language Servers and Clients.
  83: 
  84: ### [lsp-server](https://crates.io/crates/lsp-server)
  85: 
  86: lsp-server is a simple and synchronous framework for only Language Server. You
  87: need spawning tasks and managing ongoing requests/responses manually.
  88: 
  89: ## License
  90: 
  91: async-lsp is distributed under the terms of either the MIT or the Apache 2.0
  92: license, at your option. See [LICENSE-MIT](./LICENSE-MIT) and
  93: [LICENSE-APACHE](./LICENSE-APACHE) for details.
  94: 
  95: Unless you explicitly state otherwise, any contribution intentionally submitted
  96: for inclusion in the work by you, shall be dual licensed as above, without any
  97: additional terms or conditions.
  98: 
```


# Examples



File: examples/client_builder.rs
```
   1: use std::ops::ControlFlow;
   2: use std::path::Path;
   3: use std::process::Stdio;
   4: 
   5: use async_lsp::concurrency::ConcurrencyLayer;
   6: use async_lsp::panic::CatchUnwindLayer;
   7: use async_lsp::router::Router;
   8: use async_lsp::tracing::TracingLayer;
   9: use async_lsp::LanguageServer;
  10: use futures::channel::oneshot;
  11: use lsp_types::notification::{Progress, PublishDiagnostics, ShowMessage};
  12: use lsp_types::{
  13:     ClientCapabilities, DidOpenTextDocumentParams, HoverContents, HoverParams, InitializeParams,
  14:     InitializedParams, MarkupContent, NumberOrString, Position, ProgressParamsValue,
  15:     TextDocumentIdentifier, TextDocumentItem, TextDocumentPositionParams, Url,
  16:     WindowClientCapabilities, WorkDoneProgress, WorkDoneProgressParams, WorkspaceFolder,
  17: };
  18: use tower::ServiceBuilder;
  19: use tracing::{info, Level};
  20: 
  21: const TEST_ROOT: &str = "tests/client_test_data";
  22: 
  23: struct ClientState {
  24:     indexed_tx: Option<oneshot::Sender<()>>,
  25: }
  26: 
  27: struct Stop;
  28: 
  29: #[tokio::main(flavor = "current_thread")]
  30: async fn main() {
  31:     let root_dir = Path::new(TEST_ROOT)
  32:         .canonicalize()
  33:         .expect("test root should be valid");
  34: 
  35:     let (indexed_tx, indexed_rx) = oneshot::channel();
  36: 
  37:     let (mainloop, mut server) = async_lsp::MainLoop::new_client(|_server| {
  38:         let mut router = Router::new(ClientState {
  39:             indexed_tx: Some(indexed_tx),
  40:         });
  41:         router
  42:             .notification::<Progress>(|this, prog| {
  43:                 tracing::info!("{:?} {:?}", prog.token, prog.value);
  44:                 if matches!(prog.token, NumberOrString::String(s) if s == "rustAnalyzer/Indexing")
  45:                     && matches!(
  46:                         prog.value,
  47:                         ProgressParamsValue::WorkDone(WorkDoneProgress::End(_))
  48:                     )
  49:                 {
  50:                     // Sometimes rust-analyzer auto-index multiple times?
  51:                     if let Some(tx) = this.indexed_tx.take() {
  52:                         let _: Result<_, _> = tx.send(());
  53:                     }
  54:                 }
  55:                 ControlFlow::Continue(())
  56:             })
  57:             .notification::<PublishDiagnostics>(|_, _| ControlFlow::Continue(()))
  58:             .notification::<ShowMessage>(|_, params| {
  59:                 tracing::info!("Message {:?}: {}", params.typ, params.message);
  60:                 ControlFlow::Continue(())
  61:             })
  62:             .event(|_, _: Stop| ControlFlow::Break(Ok(())));
  63: 
  64:         ServiceBuilder::new()
  65:             .layer(TracingLayer::default())
  66:             .layer(CatchUnwindLayer::default())
  67:             .layer(ConcurrencyLayer::default())
  68:             .service(router)
  69:     });
  70: 
  71:     tracing_subscriber::fmt()
  72:         .with_max_level(Level::INFO)
  73:         .with_ansi(false)
  74:         .with_writer(std::io::stderr)
  75:         .init();
  76: 
  77:     let child = async_process::Command::new("rust-analyzer")
  78:         .current_dir(&root_dir)
  79:         .stdin(Stdio::piped())
  80:         .stdout(Stdio::piped())
  81:         .stderr(Stdio::inherit())
  82:         .kill_on_drop(true)
  83:         .spawn()
  84:         .expect("Failed run rust-analyzer");
  85:     let stdout = child.stdout.unwrap();
  86:     let stdin = child.stdin.unwrap();
  87: 
  88:     let mainloop_fut = tokio::spawn(async move {
  89:         mainloop.run_buffered(stdout, stdin).await.unwrap();
  90:     });
  91: 
  92:     // Initialize.
  93:     let init_ret = server
  94:         .initialize(InitializeParams {
  95:             workspace_folders: Some(vec![WorkspaceFolder {
  96:                 uri: Url::from_file_path(&root_dir).unwrap(),
  97:                 name: "root".into(),
  98:             }]),
  99:             capabilities: ClientCapabilities {
 100:                 window: Some(WindowClientCapabilities {
 101:                     work_done_progress: Some(true),
 102:                     ..WindowClientCapabilities::default()
 103:                 }),
 104:                 ..ClientCapabilities::default()
 105:             },
 106:             ..InitializeParams::default()
 107:         })
 108:         .await
 109:         .unwrap();
 110:     info!("Initialized: {init_ret:?}");
 111:     server.initialized(InitializedParams {}).unwrap();
 112: 
 113:     // Synchronize documents.
 114:     let file_uri = Url::from_file_path(root_dir.join("src/lib.rs")).unwrap();
 115:     let text = "fn func() { let var = 1; }";
 116:     server
 117:         .did_open(DidOpenTextDocumentParams {
 118:             text_document: TextDocumentItem {
 119:                 uri: file_uri.clone(),
 120:                 language_id: "rust".into(),
 121:                 version: 0,
 122:                 text: text.into(),
 123:             },
 124:         })
 125:         .unwrap();
 126: 
 127:     // Wait until indexed.
 128:     indexed_rx.await.unwrap();
 129: 
 130:     // Query.
 131:     let var_pos = text.find("var").unwrap();
 132:     let hover = server
 133:         .hover(HoverParams {
 134:             text_document_position_params: TextDocumentPositionParams {
 135:                 text_document: TextDocumentIdentifier { uri: file_uri },
 136:                 position: Position::new(0, var_pos as _),
 137:             },
 138:             work_done_progress_params: WorkDoneProgressParams::default(),
 139:         })
 140:         .await
 141:         .unwrap()
 142:         .unwrap();
 143:     info!("Hover result: {hover:?}");
 144:     assert!(
 145:         matches!(
 146:             hover.contents,
 147:             HoverContents::Markup(MarkupContent { value, .. })
 148:             if value.contains("let var: i32")
 149:         ),
 150:         "should show the type of `var`",
 151:     );
 152: 
 153:     // Shutdown.
 154:     server.shutdown(()).await.unwrap();
 155:     server.exit(()).unwrap();
 156: 
 157:     server.emit(Stop).unwrap();
 158:     mainloop_fut.await.unwrap();
 159: }
 160: 
 161: #[test]
 162: #[ignore = "invokes rust-analyzer"]
 163: fn rust_analyzer() {
 164:     main()
 165: }
 166: 
```



File: examples/client_trait.rs
```
   1: use std::ops::ControlFlow;
   2: use std::path::Path;
   3: use std::process::Stdio;
   4: 
   5: use async_lsp::concurrency::ConcurrencyLayer;
   6: use async_lsp::panic::CatchUnwindLayer;
   7: use async_lsp::router::Router;
   8: use async_lsp::tracing::TracingLayer;
   9: use async_lsp::{LanguageClient, LanguageServer, ResponseError};
  10: use futures::channel::oneshot;
  11: use lsp_types::{
  12:     ClientCapabilities, DidOpenTextDocumentParams, HoverContents, HoverParams, InitializeParams,
  13:     InitializedParams, MarkupContent, NumberOrString, Position, ProgressParams,
  14:     ProgressParamsValue, PublishDiagnosticsParams, ShowMessageParams, TextDocumentIdentifier,
  15:     TextDocumentItem, TextDocumentPositionParams, Url, WindowClientCapabilities, WorkDoneProgress,
  16:     WorkDoneProgressParams, WorkspaceFolder,
  17: };
  18: use tower::ServiceBuilder;
  19: use tracing::{info, Level};
  20: 
  21: const TEST_ROOT: &str = "tests/client_test_data";
  22: 
  23: struct ClientState {
  24:     indexed_tx: Option<oneshot::Sender<()>>,
  25: }
  26: 
  27: impl LanguageClient for ClientState {
  28:     type Error = ResponseError;
  29:     type NotifyResult = ControlFlow<async_lsp::Result<()>>;
  30: 
  31:     fn progress(&mut self, params: ProgressParams) -> Self::NotifyResult {
  32:         tracing::info!("{:?} {:?}", params.token, params.value);
  33:         if matches!(params.token, NumberOrString::String(s) if s == "rustAnalyzer/Indexing")
  34:             && matches!(
  35:                 params.value,
  36:                 ProgressParamsValue::WorkDone(WorkDoneProgress::End(_))
  37:             )
  38:         {
  39:             // Sometimes rust-analyzer auto-index multiple times?
  40:             if let Some(tx) = self.indexed_tx.take() {
  41:                 let _: Result<_, _> = tx.send(());
  42:             }
  43:         }
  44:         ControlFlow::Continue(())
  45:     }
  46: 
  47:     fn publish_diagnostics(&mut self, _: PublishDiagnosticsParams) -> Self::NotifyResult {
  48:         ControlFlow::Continue(())
  49:     }
  50: 
  51:     fn show_message(&mut self, params: ShowMessageParams) -> Self::NotifyResult {
  52:         tracing::info!("Message {:?}: {}", params.typ, params.message);
  53:         ControlFlow::Continue(())
  54:     }
  55: }
  56: 
  57: impl ClientState {
  58:     fn new_router(indexed_tx: oneshot::Sender<()>) -> Router<Self> {
  59:         let mut router = Router::from_language_client(ClientState {
  60:             indexed_tx: Some(indexed_tx),
  61:         });
  62:         router.event(Self::on_stop);
  63:         router
  64:     }
  65: 
  66:     fn on_stop(&mut self, _: Stop) -> ControlFlow<async_lsp::Result<()>> {
  67:         ControlFlow::Break(Ok(()))
  68:     }
  69: }
  70: 
  71: struct Stop;
  72: 
  73: #[tokio::main(flavor = "current_thread")]
  74: async fn main() {
  75:     let root_dir = Path::new(TEST_ROOT)
  76:         .canonicalize()
  77:         .expect("test root should be valid");
  78: 
  79:     let (indexed_tx, indexed_rx) = oneshot::channel();
  80:     let (mainloop, mut server) = async_lsp::MainLoop::new_client(|_server| {
  81:         ServiceBuilder::new()
  82:             .layer(TracingLayer::default())
  83:             .layer(CatchUnwindLayer::default())
  84:             .layer(ConcurrencyLayer::default())
  85:             .service(ClientState::new_router(indexed_tx))
  86:     });
  87: 
  88:     tracing_subscriber::fmt()
  89:         .with_max_level(Level::INFO)
  90:         .with_ansi(false)
  91:         .with_writer(std::io::stderr)
  92:         .init();
  93: 
  94:     let child = async_process::Command::new("rust-analyzer")
  95:         .current_dir(&root_dir)
  96:         .stdin(Stdio::piped())
  97:         .stdout(Stdio::piped())
  98:         .stderr(Stdio::inherit())
  99:         .kill_on_drop(true)
 100:         .spawn()
 101:         .expect("Failed run rust-analyzer");
 102:     let stdout = child.stdout.unwrap();
 103:     let stdin = child.stdin.unwrap();
 104: 
 105:     let mainloop_fut = tokio::spawn(async move {
 106:         mainloop.run_buffered(stdout, stdin).await.unwrap();
 107:     });
 108: 
 109:     // Initialize.
 110:     let init_ret = server
 111:         .initialize(InitializeParams {
 112:             workspace_folders: Some(vec![WorkspaceFolder {
 113:                 uri: Url::from_file_path(&root_dir).unwrap(),
 114:                 name: "root".into(),
 115:             }]),
 116:             capabilities: ClientCapabilities {
 117:                 window: Some(WindowClientCapabilities {
 118:                     work_done_progress: Some(true),
 119:                     ..WindowClientCapabilities::default()
 120:                 }),
 121:                 ..ClientCapabilities::default()
 122:             },
 123:             ..InitializeParams::default()
 124:         })
 125:         .await
 126:         .unwrap();
 127:     info!("Initialized: {init_ret:?}");
 128:     server.initialized(InitializedParams {}).unwrap();
 129: 
 130:     // Synchronize documents.
 131:     let file_uri = Url::from_file_path(root_dir.join("src/lib.rs")).unwrap();
 132:     let text = "#![no_std] fn func() { let var = 1; }";
 133:     server
 134:         .did_open(DidOpenTextDocumentParams {
 135:             text_document: TextDocumentItem {
 136:                 uri: file_uri.clone(),
 137:                 language_id: "rust".into(),
 138:                 version: 0,
 139:                 text: text.into(),
 140:             },
 141:         })
 142:         .unwrap();
 143: 
 144:     // Wait until indexed.
 145:     indexed_rx.await.unwrap();
 146: 
 147:     // Query.
 148:     let var_pos = text.find("var").unwrap();
 149:     let hover = server
 150:         .hover(HoverParams {
 151:             text_document_position_params: TextDocumentPositionParams {
 152:                 text_document: TextDocumentIdentifier { uri: file_uri },
 153:                 position: Position::new(0, var_pos as _),
 154:             },
 155:             work_done_progress_params: WorkDoneProgressParams::default(),
 156:         })
 157:         .await
 158:         .unwrap()
 159:         .unwrap();
 160:     info!("Hover result: {hover:?}");
 161:     assert!(
 162:         matches!(
 163:             hover.contents,
 164:             HoverContents::Markup(MarkupContent { value, .. })
 165:             if value.contains("let var: i32")
 166:         ),
 167:         "should show the type of `var`",
 168:     );
 169: 
 170:     // Shutdown.
 171:     server.shutdown(()).await.unwrap();
 172:     server.exit(()).unwrap();
 173: 
 174:     server.emit(Stop).unwrap();
 175:     mainloop_fut.await.unwrap();
 176: }
 177: 
 178: #[test]
 179: #[ignore = "invokes rust-analyzer"]
 180: fn rust_analyzer() {
 181:     main()
 182: }
 183: 
```



File: examples/inspector.rs
```
   1: use std::ops::ControlFlow;
   2: use std::pin::Pin;
   3: use std::process::Stdio;
   4: use std::task::{Context, Poll};
   5: 
   6: use async_lsp::{AnyEvent, AnyNotification, AnyRequest, LspService, MainLoop};
   7: use async_process::Command;
   8: use futures::Future;
   9: use tokio_util::compat::{TokioAsyncReadCompatExt, TokioAsyncWriteCompatExt};
  10: use tower_service::Service;
  11: use tracing::Level;
  12: 
  13: struct Forward<S>(Option<S>);
  14: 
  15: impl<S: LspService> Service<AnyRequest> for Forward<S> {
  16:     type Response = S::Response;
  17:     type Error = S::Error;
  18:     type Future = S::Future;
  19: 
  20:     fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
  21:         self.0.as_mut().unwrap().poll_ready(cx)
  22:     }
  23: 
  24:     fn call(&mut self, req: AnyRequest) -> Self::Future {
  25:         self.0.as_mut().unwrap().call(req)
  26:     }
  27: }
  28: 
  29: impl<S: LspService> LspService for Forward<S> {
  30:     fn notify(&mut self, notif: AnyNotification) -> ControlFlow<async_lsp::Result<()>> {
  31:         self.0.as_mut().unwrap().notify(notif)
  32:     }
  33: 
  34:     fn emit(&mut self, event: AnyEvent) -> ControlFlow<async_lsp::Result<()>> {
  35:         self.0.as_mut().unwrap().emit(event)
  36:     }
  37: }
  38: 
  39: struct Inspect<S> {
  40:     service: S,
  41:     incoming: &'static str,
  42:     outgoing: &'static str,
  43: }
  44: 
  45: impl<S: LspService> Service<AnyRequest> for Inspect<S>
  46: where
  47:     S::Future: Send + 'static,
  48: {
  49:     type Response = S::Response;
  50:     type Error = S::Error;
  51:     type Future = Pin<Box<dyn Future<Output = Result<S::Response, S::Error>> + Send>>;
  52: 
  53:     fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
  54:         self.service.poll_ready(cx)
  55:     }
  56: 
  57:     fn call(&mut self, req: AnyRequest) -> Self::Future {
  58:         tracing::info!("{} request {}", self.incoming, req.method);
  59:         let method = req.method.clone();
  60:         let fut = self.service.call(req);
  61:         let outgoing = self.outgoing;
  62:         Box::pin(async move {
  63:             let resp_ret = fut.await;
  64:             tracing::info!(
  65:                 "{} response {}: {}",
  66:                 outgoing,
  67:                 method,
  68:                 if resp_ret.is_ok() { "ok" } else { "err" },
  69:             );
  70:             resp_ret
  71:         })
  72:     }
  73: }
  74: 
  75: impl<S: LspService> LspService for Inspect<S>
  76: where
  77:     S::Future: Send + 'static,
  78: {
  79:     fn notify(&mut self, notif: AnyNotification) -> ControlFlow<async_lsp::Result<()>> {
  80:         tracing::info!("{} notification {}", self.incoming, notif.method);
  81:         self.service.notify(notif)
  82:     }
  83: 
  84:     fn emit(&mut self, _event: AnyEvent) -> ControlFlow<async_lsp::Result<()>> {
  85:         unreachable!()
  86:     }
  87: }
  88: 
  89: #[tokio::main(flavor = "current_thread")]
  90: async fn main() {
  91:     tracing_subscriber::fmt()
  92:         .with_max_level(Level::INFO)
  93:         .with_ansi(false)
  94:         .with_writer(std::io::stderr)
  95:         .init();
  96: 
  97:     let server_path = std::env::args()
  98:         .nth(1)
  99:         .expect("expect argument to the forwarded LSP server");
 100:     let mut child = Command::new(server_path)
 101:         .stdin(Stdio::piped())
 102:         .stdout(Stdio::piped())
 103:         .stderr(Stdio::inherit())
 104:         .spawn()
 105:         .expect("failed to spawn");
 106: 
 107:     // Mock client to communicate with the server. Incoming messages are forwarded to stdin/out.
 108:     let (mut mock_client, server_socket) = MainLoop::new_client(|_| Inspect {
 109:         service: Forward(None),
 110:         incoming: "<",
 111:         outgoing: ">",
 112:     });
 113: 
 114:     // Mock server to communicate with the client. Incoming messages are forwarded to child LSP.
 115:     let (mock_server, client_socket) = MainLoop::new_server(|_| Inspect {
 116:         service: server_socket,
 117:         incoming: ">",
 118:         outgoing: "<",
 119:     });
 120: 
 121:     // Link to form a bidirectional connection.
 122:     mock_client.get_mut().service.0 = Some(client_socket);
 123: 
 124:     let child_stdin = child.stdin.take().unwrap();
 125:     let child_stdout = child.stdout.take().unwrap();
 126:     let main1 = tokio::spawn(mock_client.run_buffered(child_stdout, child_stdin));
 127: 
 128:     let stdin = tokio::io::stdin().compat();
 129:     let stdout = tokio::io::stdout().compat_write();
 130:     let main2 = tokio::spawn(mock_server.run_buffered(stdin, stdout));
 131: 
 132:     let ret = tokio::select! {
 133:         ret = main1 => ret,
 134:         ret = main2 => ret,
 135:     };
 136:     ret.expect("join error").unwrap();
 137: }
 138: 
```



File: examples/server_builder.rs
```
   1: use std::ops::ControlFlow;
   2: use std::time::Duration;
   3: 
   4: use async_lsp::client_monitor::ClientProcessMonitorLayer;
   5: use async_lsp::concurrency::ConcurrencyLayer;
   6: use async_lsp::panic::CatchUnwindLayer;
   7: use async_lsp::router::Router;
   8: use async_lsp::server::LifecycleLayer;
   9: use async_lsp::tracing::TracingLayer;
  10: use async_lsp::ClientSocket;
  11: use lsp_types::{
  12:     notification, request, Hover, HoverContents, HoverProviderCapability, InitializeResult,
  13:     MarkedString, MessageType, OneOf, ServerCapabilities, ShowMessageParams,
  14: };
  15: use tower::ServiceBuilder;
  16: use tracing::{info, Level};
  17: 
  18: struct ServerState {
  19:     client: ClientSocket,
  20:     counter: i32,
  21: }
  22: 
  23: struct TickEvent;
  24: 
  25: #[tokio::main(flavor = "current_thread")]
  26: async fn main() {
  27:     let (server, _) = async_lsp::MainLoop::new_server(|client| {
  28:         tokio::spawn({
  29:             let client = client.clone();
  30:             async move {
  31:                 let mut interval = tokio::time::interval(Duration::from_secs(1));
  32:                 loop {
  33:                     interval.tick().await;
  34:                     if client.emit(TickEvent).is_err() {
  35:                         break;
  36:                     }
  37:                 }
  38:             }
  39:         });
  40: 
  41:         let mut router = Router::new(ServerState {
  42:             client: client.clone(),
  43:             counter: 0,
  44:         });
  45:         router
  46:             .request::<request::Initialize, _>(|_, params| async move {
  47:                 eprintln!("Initialize with {params:?}");
  48:                 Ok(InitializeResult {
  49:                     capabilities: ServerCapabilities {
  50:                         hover_provider: Some(HoverProviderCapability::Simple(true)),
  51:                         definition_provider: Some(OneOf::Left(true)),
  52:                         ..ServerCapabilities::default()
  53:                     },
  54:                     server_info: None,
  55:                 })
  56:             })
  57:             .request::<request::HoverRequest, _>(|st, _| {
  58:                 let client = st.client.clone();
  59:                 let counter = st.counter;
  60:                 async move {
  61:                     tokio::time::sleep(Duration::from_secs(1)).await;
  62:                     client
  63:                         .notify::<notification::ShowMessage>(ShowMessageParams {
  64:                             typ: MessageType::INFO,
  65:                             message: "Hello LSP".into(),
  66:                         })
  67:                         .unwrap();
  68:                     Ok(Some(Hover {
  69:                         contents: HoverContents::Scalar(MarkedString::String(format!(
  70:                             "I am a hover text {counter}!"
  71:                         ))),
  72:                         range: None,
  73:                     }))
  74:                 }
  75:             })
  76:             .request::<request::GotoDefinition, _>(|_, _| async move {
  77:                 unimplemented!("Not yet implemented!")
  78:             })
  79:             .notification::<notification::Initialized>(|_, _| ControlFlow::Continue(()))
  80:             .notification::<notification::DidChangeConfiguration>(|_, _| ControlFlow::Continue(()))
  81:             .notification::<notification::DidOpenTextDocument>(|_, _| ControlFlow::Continue(()))
  82:             .notification::<notification::DidChangeTextDocument>(|_, _| ControlFlow::Continue(()))
  83:             .notification::<notification::DidCloseTextDocument>(|_, _| ControlFlow::Continue(()))
  84:             .event::<TickEvent>(|st, _| {
  85:                 info!("tick");
  86:                 st.counter += 1;
  87:                 ControlFlow::Continue(())
  88:             });
  89: 
  90:         ServiceBuilder::new()
  91:             .layer(TracingLayer::default())
  92:             .layer(LifecycleLayer::default())
  93:             .layer(CatchUnwindLayer::default())
  94:             .layer(ConcurrencyLayer::default())
  95:             .layer(ClientProcessMonitorLayer::new(client))
  96:             .service(router)
  97:     });
  98: 
  99:     tracing_subscriber::fmt()
 100:         .with_max_level(Level::INFO)
 101:         .with_ansi(false)
 102:         .with_writer(std::io::stderr)
 103:         .init();
 104: 
 105:     // Prefer truly asynchronous piped stdin/stdout without blocking tasks.
 106:     #[cfg(unix)]
 107:     let (stdin, stdout) = (
 108:         async_lsp::stdio::PipeStdin::lock_tokio().unwrap(),
 109:         async_lsp::stdio::PipeStdout::lock_tokio().unwrap(),
 110:     );
 111:     // Fallback to spawn blocking read/write otherwise.
 112:     #[cfg(not(unix))]
 113:     let (stdin, stdout) = (
 114:         tokio_util::compat::TokioAsyncReadCompatExt::compat(tokio::io::stdin()),
 115:         tokio_util::compat::TokioAsyncWriteCompatExt::compat_write(tokio::io::stdout()),
 116:     );
 117: 
 118:     server.run_buffered(stdin, stdout).await.unwrap();
 119: }
 120: 
```



File: examples/server_trait.rs
```
   1: use std::ops::ControlFlow;
   2: use std::time::Duration;
   3: 
   4: use async_lsp::client_monitor::ClientProcessMonitorLayer;
   5: use async_lsp::concurrency::ConcurrencyLayer;
   6: use async_lsp::panic::CatchUnwindLayer;
   7: use async_lsp::router::Router;
   8: use async_lsp::server::LifecycleLayer;
   9: use async_lsp::tracing::TracingLayer;
  10: use async_lsp::{ClientSocket, LanguageClient, LanguageServer, ResponseError};
  11: use futures::future::BoxFuture;
  12: use lsp_types::{
  13:     DidChangeConfigurationParams, GotoDefinitionParams, GotoDefinitionResponse, Hover,
  14:     HoverContents, HoverParams, HoverProviderCapability, InitializeParams, InitializeResult,
  15:     MarkedString, MessageType, OneOf, ServerCapabilities, ShowMessageParams,
  16: };
  17: use tower::ServiceBuilder;
  18: use tracing::{info, Level};
  19: 
  20: struct ServerState {
  21:     client: ClientSocket,
  22:     counter: i32,
  23: }
  24: 
  25: impl LanguageServer for ServerState {
  26:     type Error = ResponseError;
  27:     type NotifyResult = ControlFlow<async_lsp::Result<()>>;
  28: 
  29:     fn initialize(
  30:         &mut self,
  31:         params: InitializeParams,
  32:     ) -> BoxFuture<'static, Result<InitializeResult, Self::Error>> {
  33:         eprintln!("Initialize with {params:?}");
  34:         Box::pin(async move {
  35:             Ok(InitializeResult {
  36:                 capabilities: ServerCapabilities {
  37:                     hover_provider: Some(HoverProviderCapability::Simple(true)),
  38:                     definition_provider: Some(OneOf::Left(true)),
  39:                     ..ServerCapabilities::default()
  40:                 },
  41:                 server_info: None,
  42:             })
  43:         })
  44:     }
  45: 
  46:     fn hover(&mut self, _: HoverParams) -> BoxFuture<'static, Result<Option<Hover>, Self::Error>> {
  47:         let mut client = self.client.clone();
  48:         let counter = self.counter;
  49:         Box::pin(async move {
  50:             tokio::time::sleep(Duration::from_secs(1)).await;
  51:             client
  52:                 .show_message(ShowMessageParams {
  53:                     typ: MessageType::INFO,
  54:                     message: "Hello LSP".into(),
  55:                 })
  56:                 .unwrap();
  57:             Ok(Some(Hover {
  58:                 contents: HoverContents::Scalar(MarkedString::String(format!(
  59:                     "I am a hover text {counter}!"
  60:                 ))),
  61:                 range: None,
  62:             }))
  63:         })
  64:     }
  65: 
  66:     fn definition(
  67:         &mut self,
  68:         _: GotoDefinitionParams,
  69:     ) -> BoxFuture<'static, Result<Option<GotoDefinitionResponse>, ResponseError>> {
  70:         unimplemented!("Not yet implemented!");
  71:     }
  72: 
  73:     fn did_change_configuration(
  74:         &mut self,
  75:         _: DidChangeConfigurationParams,
  76:     ) -> ControlFlow<async_lsp::Result<()>> {
  77:         ControlFlow::Continue(())
  78:     }
  79: }
  80: 
  81: struct TickEvent;
  82: 
  83: impl ServerState {
  84:     fn new_router(client: ClientSocket) -> Router<Self> {
  85:         let mut router = Router::from_language_server(Self { client, counter: 0 });
  86:         router.event(Self::on_tick);
  87:         router
  88:     }
  89: 
  90:     fn on_tick(&mut self, _: TickEvent) -> ControlFlow<async_lsp::Result<()>> {
  91:         info!("tick");
  92:         self.counter += 1;
  93:         ControlFlow::Continue(())
  94:     }
  95: }
  96: 
  97: #[tokio::main(flavor = "current_thread")]
  98: async fn main() {
  99:     let (server, _) = async_lsp::MainLoop::new_server(|client| {
 100:         tokio::spawn({
 101:             let client = client.clone();
 102:             async move {
 103:                 let mut interval = tokio::time::interval(Duration::from_secs(1));
 104:                 loop {
 105:                     interval.tick().await;
 106:                     if client.emit(TickEvent).is_err() {
 107:                         break;
 108:                     }
 109:                 }
 110:             }
 111:         });
 112: 
 113:         ServiceBuilder::new()
 114:             .layer(TracingLayer::default())
 115:             .layer(LifecycleLayer::default())
 116:             .layer(CatchUnwindLayer::default())
 117:             .layer(ConcurrencyLayer::default())
 118:             .layer(ClientProcessMonitorLayer::new(client.clone()))
 119:             .service(ServerState::new_router(client))
 120:     });
 121: 
 122:     tracing_subscriber::fmt()
 123:         .with_max_level(Level::INFO)
 124:         .with_ansi(false)
 125:         .with_writer(std::io::stderr)
 126:         .init();
 127: 
 128:     // Prefer truly asynchronous piped stdin/stdout without blocking tasks.
 129:     #[cfg(unix)]
 130:     let (stdin, stdout) = (
 131:         async_lsp::stdio::PipeStdin::lock_tokio().unwrap(),
 132:         async_lsp::stdio::PipeStdout::lock_tokio().unwrap(),
 133:     );
 134:     // Fallback to spawn blocking read/write otherwise.
 135:     #[cfg(not(unix))]
 136:     let (stdin, stdout) = (
 137:         tokio_util::compat::TokioAsyncReadCompatExt::compat(tokio::io::stdin()),
 138:         tokio_util::compat::TokioAsyncWriteCompatExt::compat_write(tokio::io::stdout()),
 139:     );
 140: 
 141:     server.run_buffered(stdin, stdout).await.unwrap();
 142: }
 143: 
```


# Tests



File: tests/stdio.rs
```
   1: #![cfg_attr(not(unix), allow(unused))]
   2: use std::io::{Read, Write};
   3: use std::process::Stdio;
   4: use std::time::Duration;
   5: 
   6: use tokio::io::{AsyncReadExt, AsyncWriteExt};
   7: use tokio::time::timeout;
   8: 
   9: const CHILD_ENV: &str = "IS_STDIO_TEST_CHILD";
  10: 
  11: const READ_TIMEOUT: Duration = Duration::from_millis(500);
  12: const SCHED_TIMEOUT: Duration = Duration::from_millis(100);
  13: 
  14: // Do nothing for non-UNIX targets: `stdio` module is not available.
  15: #[cfg(not(unix))]
  16: fn main() {}
  17: 
  18: #[cfg(unix)]
  19: fn main() {
  20:     if std::env::var(CHILD_ENV).is_err() {
  21:         parent();
  22:     } else {
  23:         tokio::runtime::Builder::new_current_thread()
  24:             .enable_all()
  25:             .build()
  26:             .unwrap()
  27:             .block_on(child());
  28:     }
  29: }
  30: 
  31: #[cfg(unix)]
  32: fn parent() {
  33:     let this_exe = std::env::current_exe().unwrap();
  34:     let mut child = std::process::Command::new(this_exe)
  35:         .env(CHILD_ENV, "1")
  36:         .stdin(Stdio::piped())
  37:         .stdout(Stdio::piped())
  38:         .stderr(Stdio::inherit())
  39:         .spawn()
  40:         .expect("failed to spawn");
  41:     let childin = child.stdin.as_mut().unwrap();
  42:     let childout = child.stdout.as_mut().unwrap();
  43: 
  44:     let mut buf = [0u8; 64];
  45:     // Wait for the signal.
  46:     assert_eq!(childout.read(&mut buf).unwrap(), 4);
  47:     assert_eq!(&buf[..4], b"ping");
  48:     // Reply back.
  49:     childin.write_all(b"pong").unwrap();
  50: 
  51:     // NB. Wait for its exit first, without draining `childout`. Because the child keeps writing
  52:     // until the kernel buffer is full.
  53:     let output = child.wait_with_output().unwrap();
  54:     assert!(output.status.success());
  55:     // The last one is written by the std blocking call `print!`.
  56:     assert_eq!(output.stdout, b"2");
  57: }
  58: 
  59: #[cfg(unix)]
  60: async fn child() {
  61:     use async_lsp::stdio::{PipeStdin, PipeStdout};
  62: 
  63:     let mut stdin = PipeStdin::lock_tokio().unwrap();
  64:     let mut stdout = PipeStdout::lock_tokio().unwrap();
  65:     let mut buf = [0u8; 64];
  66: 
  67:     // Should be blocked since we are holding lock guards in `PipeStd{in,out}`.
  68:     let std_stdin = tokio::task::spawn_blocking(|| drop(std::io::stdin().lock()));
  69:     let std_stdout = tokio::task::spawn_blocking(|| print!("2"));
  70: 
  71:     timeout(READ_TIMEOUT, stdin.read(&mut buf))
  72:         .await
  73:         .expect_err("should timeout");
  74: 
  75:     // Signal the parent to send us something. This should not block due to pipe buffer.
  76:     timeout(Duration::ZERO, stdout.write_all(b"ping"))
  77:         .await
  78:         .expect("should not block")
  79:         .unwrap();
  80: 
  81:     assert_eq!(
  82:         timeout(SCHED_TIMEOUT, stdin.read(&mut buf))
  83:             .await
  84:             .expect("should not timeout")
  85:             .expect("should read something"),
  86:         4
  87:     );
  88:     assert_eq!(&buf[..4], b"pong");
  89: 
  90:     // Still blocked yet.
  91:     assert!(!std_stdin.is_finished());
  92:     assert!(!std_stdout.is_finished());
  93: 
  94:     // Drop lock guards, then std operations unblock.
  95:     drop(stdin);
  96:     drop(stdout);
  97:     timeout(SCHED_TIMEOUT, std_stdin)
  98:         .await
  99:         .expect("no timeout")
 100:         .expect("no panic");
 101:     timeout(SCHED_TIMEOUT, std_stdout)
 102:         .await
 103:         .expect("no timeout")
 104:         .expect("no panic");
 105: }
 106: 
```



File: tests/unit_test.rs
```
   1: //! An example for unit-testing via mocking servers and/or clients.
   2: // TODO: Make this more egornomic. Maybe provide some test APIs?
   3: use std::ops::ControlFlow;
   4: 
   5: use async_lsp::router::Router;
   6: use async_lsp::server::LifecycleLayer;
   7: use async_lsp::{ClientSocket, LanguageClient, LanguageServer};
   8: use futures::channel::mpsc;
   9: use futures::{AsyncReadExt, StreamExt};
  10: use lsp_types::{
  11:     notification, request, ConfigurationItem, ConfigurationParams, Hover, HoverContents,
  12:     HoverParams, HoverProviderCapability, InitializeParams, InitializeResult, InitializedParams,
  13:     MarkedString, MessageType, Position, ServerCapabilities, ShowMessageParams,
  14:     TextDocumentIdentifier, TextDocumentPositionParams, WorkDoneProgressParams,
  15: };
  16: use tokio_util::compat::TokioAsyncReadCompatExt;
  17: use tower::ServiceBuilder;
  18: 
  19: const MEMORY_CHANNEL_SIZE: usize = 64 << 10; // 64KiB
  20: 
  21: struct ServerState {
  22:     client: ClientSocket,
  23: }
  24: 
  25: struct ClientState {
  26:     msg_tx: mpsc::UnboundedSender<String>,
  27: }
  28: 
  29: #[tokio::test(flavor = "current_thread")]
  30: async fn mock_server_and_client() {
  31:     // The server with handlers.
  32:     let (server_main, mut client) = async_lsp::MainLoop::new_server(|client| {
  33:         let mut router = Router::new(ServerState { client });
  34:         router
  35:             .request::<request::Initialize, _>(|_st, _params| async move {
  36:                 Ok(InitializeResult {
  37:                     capabilities: ServerCapabilities {
  38:                         hover_provider: Some(HoverProviderCapability::Simple(true)),
  39:                         ..ServerCapabilities::default()
  40:                     },
  41:                     server_info: None,
  42:                 })
  43:             })
  44:             .notification::<notification::Initialized>(|_, _| ControlFlow::Continue(()))
  45:             .request::<request::Shutdown, _>(|_, _| async move { Ok(()) })
  46:             .notification::<notification::Exit>(|_, _| ControlFlow::Break(Ok(())))
  47:             .request::<request::HoverRequest, _>(|st, _params| {
  48:                 let mut client = st.client.clone();
  49:                 async move {
  50:                     // Optionally interact with client.
  51:                     let text = client
  52:                         .configuration(ConfigurationParams {
  53:                             items: vec![ConfigurationItem {
  54:                                 scope_uri: None,
  55:                                 section: Some("mylsp.hoverText".into()),
  56:                             }],
  57:                         })
  58:                         .await
  59:                         .ok()
  60:                         .and_then(|ret| Some(ret[0].as_str()?.to_owned()))
  61:                         .unwrap_or_default();
  62: 
  63:                     // Respond.
  64:                     Ok(Some(Hover {
  65:                         contents: HoverContents::Scalar(MarkedString::String(text)),
  66:                         range: None,
  67:                     }))
  68:                 }
  69:             });
  70: 
  71:         ServiceBuilder::new()
  72:             .layer(LifecycleLayer::default())
  73:             .service(router)
  74:     });
  75: 
  76:     // The client with handlers.
  77:     let (msg_tx, mut msg_rx) = mpsc::unbounded();
  78:     let (client_main, mut server) = async_lsp::MainLoop::new_client(|_server| {
  79:         let mut router = Router::new(ClientState { msg_tx });
  80:         router
  81:             .notification::<notification::ShowMessage>(|st, params| {
  82:                 st.msg_tx.unbounded_send(params.message).unwrap();
  83:                 ControlFlow::Continue(())
  84:             })
  85:             .request::<request::WorkspaceConfiguration, _>(|_st, _params| async move {
  86:                 Ok(vec!["Some hover text".into()])
  87:             });
  88:         ServiceBuilder::new().service(router)
  89:     });
  90: 
  91:     // Wire up a loopback channel between the server and the client.
  92:     let (server_stream, client_stream) = tokio::io::duplex(MEMORY_CHANNEL_SIZE);
  93:     let (server_rx, server_tx) = server_stream.compat().split();
  94:     let server_main = tokio::spawn(async move {
  95:         server_main
  96:             .run_buffered(server_rx, server_tx)
  97:             .await
  98:             .unwrap();
  99:     });
 100:     let (client_rx, client_tx) = client_stream.compat().split();
 101:     let client_main = tokio::spawn(async move {
 102:         let err = client_main
 103:             .run_buffered(client_rx, client_tx)
 104:             .await
 105:             .unwrap_err();
 106:         assert!(
 107:             matches!(err, async_lsp::Error::Eof),
 108:             "should fail due to EOF: {err}"
 109:         );
 110:     });
 111: 
 112:     // Send requests to the server on behalf of the client, via `ServerSocket`. It interacts with
 113:     // the client main loop to finalize and send the request through the channel.
 114:     server
 115:         .initialize(InitializeParams::default())
 116:         .await
 117:         .unwrap();
 118:     // Send notifications. Note that notifications are delivered asynchronously, but in order.
 119:     server.initialized(InitializedParams {}).unwrap();
 120: 
 121:     // After the initialization sequence, do some real requests.
 122:     let ret = server
 123:         .hover(HoverParams {
 124:             text_document_position_params: TextDocumentPositionParams {
 125:                 text_document: TextDocumentIdentifier::new("file:///foo".parse().unwrap()),
 126:                 position: Position::new(0, 0),
 127:             },
 128:             work_done_progress_params: WorkDoneProgressParams::default(),
 129:         })
 130:         .await
 131:         .unwrap();
 132:     assert_eq!(
 133:         ret,
 134:         Some(Hover {
 135:             contents: HoverContents::Scalar(MarkedString::String("Some hover text".into())),
 136:             range: None
 137:         })
 138:     );
 139: 
 140:     // In contrast, send notifications to the client on behalf of the server, via `ClientSocket`.
 141:     client
 142:         .show_message(ShowMessageParams {
 143:             typ: MessageType::INFO,
 144:             message: "Some message".into(),
 145:         })
 146:         .unwrap();
 147:     // Here the client may not get notification delivered yet. Wait for it.
 148:     assert_eq!(msg_rx.next().await.unwrap(), "Some message");
 149: 
 150:     // Shutdown the server.
 151:     server.shutdown(()).await.unwrap();
 152:     server.exit(()).unwrap();
 153: 
 154:     // Both main loop should be shutdown.
 155:     server_main.await.expect("no panic");
 156:     client_main.await.expect("no panic");
 157: }
 158: 
```



File: tests/client_test_data/Cargo.lock
```
   1: # This file is automatically @generated by Cargo.
   2: # It is not intended for manual editing.
   3: version = 3
   4: 
   5: [[package]]
   6: name = "rust-analyzer-client-test"
   7: version = "0.0.0"
   8: 
```



File: tests/client_test_data/Cargo.toml
```
   1: [package]
   2: name = "rust-analyzer-client-test"
   3: version = "0.0.0"
   4: 
   5: [workspace]
   6: 
```



File: tests/client_test_data/src/lib.rs
```
   1: // Unused here. In-memory `textDocument/didOpen` is preferred over on-disk contents.
   2: 
```


