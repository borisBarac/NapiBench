The cleanest way to export Rust functions to Node.js today is to use **napi-rs** and mark Rust items with `#[napi]`; the framework generates the binding layer and the JS loader for you. [napi](https://napi.rs)
For setup, the recommended path is to install `@napi-rs/cli` globally and create a project with `napi new`, which scaffolds the Rust crate, package metadata, and the platform-aware Node loader. [johns](https://johns.codes/blog/exposing-a-rust-library-to-node-with-napirs)

## Setup

Install the CLI with one of these commands: `npm install -g @napi-rs/cli`, `yarn global add @napi-rs/cli`, or `pnpm add -g @napi-rs/cli`, then run `napi new` and answer the prompts for package name, target platforms, and optional GitHub Actions publishing support. [johns](https://johns.codes/blog/exposing-a-rust-library-to-node-with-napirs)
The generated package includes an `index.js` that picks the correct native `.node` binary for the current OS and CPU, and it also supports local development by loading a binary built into the project directory. [johns](https://johns.codes/blog/exposing-a-rust-library-to-node-with-napirs)

## Minimal example

A Rust function becomes a Node export by adding `#[napi]` above a normal `pub fn`; for example, napi-rs documents `pub fn sum(a: u32, b: u32) -> u32 { a + b }` as a direct export. [napi](https://napi.rs)
In Node, you then import from the generated package entrypoint rather than calling into raw FFI yourself, because napi-rs auto-registers exports and handles the module wiring. [napi](https://napi.rs)

```rust
// src/lib.rs
use napi_derive::napi;

#[napi]
pub fn sum(a: u32, b: u32) -> u32 {
  a + b
}

#[napi]
pub fn greet(name: String) -> String {
  format!("Hello, {}!", name)
}
```

```js
// test.js
const { sum, greet } = require('./index.js')

console.log(sum(20, 22))
console.log(greet('Boris'))
```

## More export samples

napi-rs can also export constants, classes, enums, and custom module initialization logic, not just free functions. [napi](https://napi.rs)
The docs show `#[napi] pub const DEFAULT_COST: u32 = 12;`, `#[napi]` on enums, and `#[napi(module_exports)]` for direct access to the `exports` object. [napi](https://napi.rs)

```rust
use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi]
pub const DEFAULT_PORT: u32 = 3000;

#[napi]
pub enum Mode {
  Dev,
  Prod,
}

#[napi]
pub struct Counter {
  value: i32,
}

#[napi]
impl Counter {
  #[napi(constructor)]
  pub fn new(value: i32) -> Self {
    Self { value }
  }

  #[napi]
  pub fn inc(&mut self) {
    self.value += 1;
  }

  #[napi]
  pub fn get(&self) -> i32 {
    self.value
  }
}

#[napi(module_exports)]
pub fn exports(mut exports: Object) -> Result<()> {
  let version = "1.0.0";
  exports.set_named_property("nativeVersion", version)?;
  Ok(())
}
```

```js
const { DEFAULT_PORT, Mode, Counter, nativeVersion } = require('./index.js')

console.log(DEFAULT_PORT)
console.log(Mode.Dev)

const c = new Counter(10)
c.inc()
console.log(c.get())
console.log(nativeVersion)
```

## Typical project files

Your Rust library is exposed through the generated JS entry file, and the docs note that the loader chooses a platform-specific binary package or a locally built `.node` file depending on how the package is being used. [johns](https://johns.codes/blog/exposing-a-rust-library-to-node-with-napirs)
That means your workflow is usually “write Rust in `src/lib.rs`, build the addon, then import from `./index.js` in Node,” not “manually load Rust symbols.” [johns](https://johns.codes/blog/exposing-a-rust-library-to-node-with-napirs)

A typical shape looks like this:

```toml
# Cargo.toml
[package]
name = "my-native-addon"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
napi = "3"
napi-derive = "3"
```

```json
{
  "name": "my-native-addon",
  "version": "0.1.0",
  "main": "index.js",
  "scripts": {
    "build": "napi build",
    "dev": "napi build --debug"
  }
}
```

## How to run it

After scaffolding with `napi new`, use the generated build script so the addon is compiled into a `.node` binary for local debugging, and then run your Node script against the generated `index.js` loader. [johns](https://johns.codes/blog/exposing-a-rust-library-to-node-with-napirs)
If you plan to publish the package broadly, the docs recommend using an npm scope because the CLI generates separate platform-specific packages such as `-darwin-x64`, `-win32-x64`, or `-linux-arm64-gnu`. [johns](https://johns.codes/blog/exposing-a-rust-library-to-node-with-napirs)

Example local flow:

```bash
napi new
npm install
npm run build
node test.js
```

One practical pattern for a Node backend is to keep the JS API very small and stable, for example exposing parsing, hashing, pricing, or CPU-heavy transforms from Rust while the rest of the app stays in TypeScript. [napi](https://napi.rs)

Would you like a complete starter repo layout for Node + TypeScript + napi-rs next?