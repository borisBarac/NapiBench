#[cfg(feature = "napi-build")]
fn main() {
    napi_build::setup();
}

#[cfg(not(feature = "napi-build"))]
fn main() {}
