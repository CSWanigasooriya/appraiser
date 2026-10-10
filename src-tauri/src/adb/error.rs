use serde::{ser::Serializer, Serialize};

#[derive(Debug, thiserror::Error)]
pub enum AdbError {
    #[error("adb executable not found. Install Android platform-tools and make sure `adb` is on your PATH")]
    NotFound,
    #[error("adb failed: {0}")]
    Failed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

// Tauri commands need errors that serialize; send the message to the frontend.
impl Serialize for AdbError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
