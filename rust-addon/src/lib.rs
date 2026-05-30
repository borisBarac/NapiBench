mod indicators;
mod signals;
mod summary;
mod utils;

#[cfg(not(feature = "wasm"))]
mod napi_impl;

#[cfg(feature = "wasm")]
mod wasm;
