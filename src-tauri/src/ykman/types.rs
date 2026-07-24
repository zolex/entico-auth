use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct YubiKeyInfo {
    pub serial: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OathAccount {
    pub query: String,
    pub issuer: Option<String>,
    pub name: String,
    pub period: u32,
    pub touch_required: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct OathCodeEntry {
    pub query: String,
    pub code: Option<String>, // None => touch required
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OathStatus {
    pub password_protected: bool,
    pub remembered: bool,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyDetails {
    pub serial: String,
    pub device_type: String,
    pub firmware_version: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind")]
pub enum YkmanError {
    NotFound,
    NoKeyConnected,
    WrongPassword,
    OathDisabled,
    Other { message: String },
}
