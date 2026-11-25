//! Tells the person when a newer version has been published.
//!
//! This is a notice with a download link, not a silent self-update: the
//! installer is not code-signed yet, and an app that replaces itself needs
//! a signing key for its updates. It reads the public releases of the
//! project and compares versions.

use serde::{Deserialize, Serialize};
use specta::Type;
use std::time::Duration;

const RELEASES_URL: &str =
    "https://api.github.com/repos/ezelamass/Ezequielito/releases?per_page=20";
const TIMEOUT: Duration = Duration::from_secs(10);

/// A published version newer than the one running.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct AvailableUpdate {
    pub version: String,
    /// Page with the installers and the notes for that version.
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
}

/// Parses `v1.2.3`, `1.2.3` or `1.2` into comparable numbers. Anything
/// after the numbers (`-beta.1`) is ignored; `None` when it is not a
/// version at all.
fn parse_version(tag: &str) -> Option<(u64, u64, u64)> {
    let core = tag.trim().trim_start_matches(['v', 'V']);
    let core = core
        .split(|c: char| c == '-' || c == '+' || c.is_whitespace())
        .next()?;
    let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
    let major = parts.next()??;
    let minor = parts.next().unwrap_or(Some(0))?;
    let patch = parts.next().unwrap_or(Some(0))?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// The newest published release that is newer than `current`, if any.
fn newest_update(releases: &[Release], current: &str) -> Option<AvailableUpdate> {
    let running = parse_version(current)?;
    releases
        .iter()
        .filter(|release| !release.draft)
        .filter_map(|release| parse_version(&release.tag_name).map(|version| (version, release)))
        .filter(|(version, _)| *version > running)
        .max_by_key(|(version, _)| *version)
        .map(|((major, minor, patch), release)| AvailableUpdate {
            version: format!("{}.{}.{}", major, minor, patch),
            url: release.html_url.clone(),
        })
}

/// Asks whether a newer version exists. `Ok(None)`: up to date.
pub async fn check(current_version: &str) -> Result<Option<AvailableUpdate>, String> {
    let response = reqwest::Client::new()
        .get(RELEASES_URL)
        .header("User-Agent", "vento-voice-desktop")
        .header("Accept", "application/vnd.github+json")
        .timeout(TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("releases request failed: {}", response.status()));
    }
    let releases: Vec<Release> = response.json().await.map_err(|e| e.to_string())?;
    Ok(newest_update(&releases, current_version))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, draft: bool) -> Release {
        Release {
            tag_name: tag.to_string(),
            html_url: format!("https://example.test/releases/{}", tag),
            draft,
        }
    }

    #[test]
    fn versions_parse_with_or_without_the_v_and_a_suffix() {
        assert_eq!(parse_version("v1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("v0.2"), Some((0, 2, 0)));
        assert_eq!(parse_version("v1.2.3-beta.1"), Some((1, 2, 3)));
        assert_eq!(parse_version("nightly"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version(""), None);
    }

    #[test]
    fn a_newer_release_is_offered_with_its_page() {
        let releases = [release("v0.1.0", false), release("v0.2.0", false)];
        assert_eq!(
            newest_update(&releases, "0.1.0"),
            Some(AvailableUpdate {
                version: "0.2.0".to_string(),
                url: "https://example.test/releases/v0.2.0".to_string(),
            })
        );
    }

    #[test]
    fn the_newest_wins_whatever_the_order_and_ten_is_more_than_nine() {
        let releases = [
            release("v0.9.0", false),
            release("v0.10.0", false),
            release("v0.2.0", false),
        ];
        assert_eq!(
            newest_update(&releases, "0.1.0").map(|update| update.version),
            Some("0.10.0".to_string())
        );
    }

    #[test]
    fn the_running_version_and_older_ones_are_not_updates() {
        let releases = [release("v0.1.0", false), release("v0.0.9", false)];
        assert_eq!(newest_update(&releases, "0.1.0"), None);
    }

    #[test]
    fn drafts_and_tags_that_are_not_versions_are_ignored() {
        let releases = [release("v9.0.0", true), release("nightly", false)];
        assert_eq!(newest_update(&releases, "0.1.0"), None);
    }

    #[test]
    fn an_unreadable_running_version_never_offers_an_update() {
        assert_eq!(newest_update(&[release("v9.0.0", false)], "dev"), None);
    }
}
