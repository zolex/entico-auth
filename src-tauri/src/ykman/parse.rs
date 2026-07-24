use super::types::{KeyDetails, OathAccount, OathCodeEntry, OathStatus, YubiKeyInfo};

pub fn parse_list(stdout: &str) -> Vec<YubiKeyInfo> {
    stdout
        .lines()
        .filter_map(|line| {
            let (name, serial) = line.trim().split_once(" Serial:")?;
            Some(YubiKeyInfo {
                // `ykman list` names look like "YubiKey 5 NFC (5.7.4) [FIDO+CCID]" -
                // the parenthesized firmware version and bracketed capability list
                // are noise for the key picker, so keep only the device type.
                name: name.split('(').next().unwrap_or(name).trim().to_string(),
                serial: serial.trim().to_string(),
            })
        })
        .collect()
}

pub fn parse_oath_status(stdout: &str) -> OathStatus {
    let protected = stdout
        .lines()
        .find(|l| l.trim_start().starts_with("Password protection:"))
        .and_then(|l| l.split(':').nth(1))
        .map(|v| v.trim() == "enabled")
        .unwrap_or(false);
    let remembered = stdout.lines().any(|l| {
        l.trim_start()
            .starts_with("The password for this YubiKey is remembered by ykman")
    });
    OathStatus {
        password_protected: protected,
        remembered,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured verbatim from `ykman list` against a real connected YubiKey 5 NFC.
    const SAMPLE: &str = "YubiKey 5 NFC (5.7.4) [FIDO+CCID] Serial: 36705123\n";

    #[test]
    fn parses_a_single_connected_key() {
        let keys = parse_list(SAMPLE);
        assert_eq!(
            keys,
            vec![YubiKeyInfo {
                serial: "36705123".to_string(),
                name: "YubiKey 5 NFC".to_string(),
            }]
        );
    }

    #[test]
    fn ignores_devices_without_a_serial() {
        // ykman's own --serials flag documents that serial-less devices are omitted;
        // we mirror that by skipping any line without " Serial:".
        let keys = parse_list("Some Reader Without A Key\n");
        assert!(keys.is_empty());
    }

    #[test]
    fn empty_output_yields_no_keys() {
        assert!(parse_list("").is_empty());
    }
}

#[cfg(test)]
mod oath_status_tests {
    use super::*;

    // Captured verbatim from `ykman oath info` against a real key with no password set.
    const SAMPLE_UNPROTECTED: &str = "OATH version:        5.7.4\nPassword protection: disabled\n";
    const SAMPLE_PROTECTED: &str = "OATH version:        5.7.4\nPassword protection: enabled\n";
    // Captured verbatim from a real key where the password is remembered by ykman.
    const SAMPLE_PROTECTED_REMEMBERED: &str =
        "OATH version:        5.7.4\nPassword protection: enabled\nThe password for this YubiKey is remembered by ykman.\n";

    #[test]
    fn detects_unprotected() {
        assert_eq!(
            parse_oath_status(SAMPLE_UNPROTECTED),
            OathStatus {
                password_protected: false,
                remembered: false
            }
        );
    }

    #[test]
    fn detects_protected() {
        assert_eq!(
            parse_oath_status(SAMPLE_PROTECTED),
            OathStatus {
                password_protected: true,
                remembered: false
            }
        );
    }

    #[test]
    fn detects_remembered() {
        assert_eq!(
            parse_oath_status(SAMPLE_PROTECTED_REMEMBERED),
            OathStatus {
                password_protected: true,
                remembered: true
            }
        );
    }
}

pub fn parse_accounts_list(stdout: &str) -> Vec<OathAccount> {
    stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            let mut parts = line.rsplitn(3, ", ");
            let period: u32 = parts.next()?.parse().ok()?;
            let oath_type = parts.next()?;
            let query = parts.next()?.to_string();
            if oath_type != "TOTP" {
                return None;
            }
            let (issuer, name) = match query.split_once(':') {
                Some((i, n)) => (Some(i.to_string()), n.to_string()),
                None => (None, query.clone()),
            };
            Some(OathAccount {
                query,
                issuer,
                name,
                period,
                touch_required: false,
            })
        })
        .collect()
}

pub fn parse_codes(stdout: &str) -> Vec<OathCodeEntry> {
    stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim_end();
            if line.is_empty() {
                return None;
            }
            let idx = line.rfind("  ")?;
            let (query, rest) = line.split_at(idx);
            let rest = rest.trim();
            let code = if rest == "[Requires Touch]" {
                None
            } else {
                Some(rest.to_string())
            };
            Some(OathCodeEntry {
                query: query.trim().to_string(),
                code,
            })
        })
        .collect()
}

#[cfg(test)]
mod codes_tests {
    use super::*;

    // Captured verbatim from `ykman oath accounts code` against a real key where every
    // account happens to require touch.
    const SAMPLE_TOUCH: &str = "\
Service:user@domain.tld             [Requires Touch]
Mail:user2@domain.tld                [Requires Touch]
";

    // Shape of a resolved (non-touch) code line, per ykman's own column-padding convention.
    const SAMPLE_CODE: &str = "Service:user@domain.tld             123456\n";

    #[test]
    fn parses_touch_required_as_none() {
        let codes = parse_codes(SAMPLE_TOUCH);
        assert_eq!(codes.len(), 2);
        assert_eq!(
            codes[0],
            OathCodeEntry {
                query: "Service:user@domain.tld".to_string(),
                code: None,
            }
        );
    }

    #[test]
    fn parses_resolved_code() {
        let codes = parse_codes(SAMPLE_CODE);
        assert_eq!(
            codes[0],
            OathCodeEntry {
                query: "Service:user@domain.tld".to_string(),
                code: Some("123456".to_string()),
            }
        );
    }

    #[test]
    fn empty_output_yields_no_codes() {
        assert!(parse_codes("").is_empty());
    }
}

#[cfg(test)]
mod accounts_list_tests {
    use super::*;

    // Captured verbatim from `ykman oath accounts list -o -P` against a real key.
    const SAMPLE: &str = "\
Service:user@domain.tld, TOTP, 30
Provider:ACCT123456, TOTP, 30
Mail:user2@domain.tld, TOTP, 30
";

    #[test]
    fn parses_issuer_and_name() {
        let accounts = parse_accounts_list(SAMPLE);
        assert_eq!(accounts.len(), 3);
        assert_eq!(
            accounts[0],
            OathAccount {
                query: "Service:user@domain.tld".to_string(),
                issuer: Some("Service".to_string()),
                name: "user@domain.tld".to_string(),
                period: 30,
                touch_required: false,
            }
        );
    }

    #[test]
    fn handles_no_issuer() {
        let accounts = parse_accounts_list("justaname, TOTP, 30\n");
        assert_eq!(accounts[0].issuer, None);
        assert_eq!(accounts[0].name, "justaname");
    }

    #[test]
    fn skips_hotp_accounts() {
        let accounts = parse_accounts_list("Legacy:user, HOTP, 30\n");
        assert!(accounts.is_empty());
    }

    #[test]
    fn empty_output_yields_no_accounts() {
        assert!(parse_accounts_list("").is_empty());
    }
}

pub fn parse_key_info(serial: String, stdout: &str) -> KeyDetails {
    let device_type = stdout
        .lines()
        .find(|l| l.starts_with("Device type:"))
        .and_then(|l| l.split(':').nth(1))
        .map(|v| v.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    let firmware_version = stdout
        .lines()
        .find(|l| l.starts_with("Firmware version:"))
        .and_then(|l| l.split(':').nth(1))
        .map(|v| v.trim().to_string())
        .unwrap_or_else(|| "Unknown".to_string());
    KeyDetails {
        serial,
        device_type,
        firmware_version,
    }
}

#[cfg(test)]
mod key_info_tests {
    use super::*;

    // Captured verbatim from `ykman info` against a real key.
    const SAMPLE: &str = "\
Device type: YubiKey 5 NFC
Serial number: 36705123
Firmware version: 5.7.4
Form factor: Keychain (USB-A)
";

    #[test]
    fn extracts_device_type_and_firmware() {
        let details = parse_key_info("36705123".to_string(), SAMPLE);
        assert_eq!(details.device_type, "YubiKey 5 NFC");
        assert_eq!(details.firmware_version, "5.7.4");
    }
}
