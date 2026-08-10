fn main() {
    // Without devUrl configured, the frontend (frontendDist = "../src") gets
    // embedded into the binary at build time. Cargo only reruns this build
    // script — and therefore only re-embeds the frontend — when something it
    // was told to watch changes; by default that's just this crate's own
    // .rs files. Declaring the frontend directory here means editing any
    // file under src/ (HTML/JS/CSS/assets) triggers a rebuild too, instead
    // of silently reusing whatever was embedded at the very first build.
    println!("cargo:rerun-if-changed=../src");
    tauri_build::build()
}
