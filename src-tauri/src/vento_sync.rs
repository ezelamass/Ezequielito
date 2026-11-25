//! What gets synced with the Vento account and how two copies are
//! reconciled. Pure: no network, no storage.

use crate::settings::Snippet;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// The part of the settings that follows the person across computers.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Profile {
    /// Words the dictation must spell right (names, brands, jargon).
    #[serde(default)]
    pub dictionary: Vec<String>,
    #[serde(default)]
    pub snippets: Vec<SyncedSnippet>,
    /// Lowercased app name → style prompt id.
    #[serde(default)]
    pub app_styles: HashMap<String, String>,
}

/// `Snippet` as stored in the account (same shape, comparable).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncedSnippet {
    pub trigger: String,
    pub expansion: String,
}

impl From<&Snippet> for SyncedSnippet {
    fn from(snippet: &Snippet) -> Self {
        Self {
            trigger: snippet.trigger.clone(),
            expansion: snippet.expansion.clone(),
        }
    }
}

impl From<&SyncedSnippet> for Snippet {
    fn from(snippet: &SyncedSnippet) -> Self {
        Self {
            trigger: snippet.trigger.clone(),
            expansion: snippet.expansion.clone(),
        }
    }
}

/// The copy stored in the account and when it was last written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteProfile {
    pub profile: Profile,
    pub updated_at: String,
}

/// What this computer remembers about its last sync.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SyncState {
    /// `updated_at` of the account copy when this computer last matched it.
    /// `None`: never synced with the current account.
    #[serde(default)]
    pub synced_at: Option<String>,
    /// The local copy changed since then.
    #[serde(default)]
    pub dirty: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncPlan {
    /// Both copies already match.
    Nothing,
    /// Write the local copy to the account.
    Push(Profile),
    /// Replace the local copy with the account's.
    TakeRemote(Profile),
    /// Both changed: store this merge locally and in the account.
    MergeAndPush(Profile),
}

/// Decides what to do with the two copies.
///
/// A deletion only survives when one side changed: then that side simply
/// wins. When both changed since the last sync there is no way to tell a
/// deletion from an addition on the other side, so nothing is dropped.
pub fn plan_sync(local: &Profile, remote: Option<&RemoteProfile>, state: &SyncState) -> SyncPlan {
    let Some(remote) = remote else {
        return SyncPlan::Push(local.clone());
    };

    if *local == remote.profile {
        return SyncPlan::Nothing;
    }

    // First sync on this computer for this account: nothing here is known
    // to be newer than the account. Keep everything from both, and where
    // they disagree believe the account, so a fresh install's factory
    // defaults never overwrite what the person set up elsewhere.
    if state.synced_at.is_none() {
        let merged = merge(&remote.profile, local);
        return if merged == remote.profile {
            SyncPlan::TakeRemote(merged)
        } else {
            SyncPlan::MergeAndPush(merged)
        };
    }

    let remote_changed = state.synced_at.as_deref() != Some(remote.updated_at.as_str());
    match (remote_changed, state.dirty) {
        (false, false) => SyncPlan::Nothing,
        (false, true) => SyncPlan::Push(local.clone()),
        (true, false) => SyncPlan::TakeRemote(remote.profile.clone()),
        (true, true) => SyncPlan::MergeAndPush(merge(local, &remote.profile)),
    }
}

/// Union of both copies. On a conflict `preferred` wins.
pub fn merge(preferred: &Profile, other: &Profile) -> Profile {
    let (local, remote) = (preferred, other);
    let mut seen_words: HashSet<String> = HashSet::new();
    let mut dictionary = Vec::new();
    for word in local.dictionary.iter().chain(remote.dictionary.iter()) {
        let trimmed = word.trim();
        if !trimmed.is_empty() && seen_words.insert(trimmed.to_lowercase()) {
            dictionary.push(trimmed.to_string());
        }
    }

    let mut seen_triggers: HashSet<String> = HashSet::new();
    let mut snippets = Vec::new();
    for snippet in local.snippets.iter().chain(remote.snippets.iter()) {
        let trigger = snippet.trigger.trim();
        if !trigger.is_empty() && seen_triggers.insert(trigger.to_lowercase()) {
            snippets.push(snippet.clone());
        }
    }

    let mut app_styles = remote.app_styles.clone();
    app_styles.extend(local.app_styles.clone());

    Profile {
        dictionary,
        snippets,
        app_styles,
    }
}

/// Maps a local style prompt id to the style name Vento understands.
pub fn style_for_prompt(prompt_id: Option<&str>) -> &'static str {
    match prompt_id {
        Some("ez_casual") => "casual",
        Some("ez_very_casual") => "very_casual",
        Some("ez_formal") => "formal",
        Some("ez_code") => "code",
        _ => "neutral",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(words: &[&str]) -> Profile {
        Profile {
            dictionary: words.iter().map(|w| w.to_string()).collect(),
            ..Profile::default()
        }
    }

    fn remote(words: &[&str], updated_at: &str) -> RemoteProfile {
        RemoteProfile {
            profile: profile(words),
            updated_at: updated_at.to_string(),
        }
    }

    fn synced(at: &str, dirty: bool) -> SyncState {
        SyncState {
            synced_at: Some(at.to_string()),
            dirty,
        }
    }

    #[test]
    fn an_account_without_a_profile_gets_the_local_one() {
        let local = profile(&["Vento"]);
        assert_eq!(
            plan_sync(&local, None, &SyncState::default()),
            SyncPlan::Push(local.clone())
        );
    }

    #[test]
    fn matching_copies_need_nothing_even_if_marked_dirty() {
        let local = profile(&["Vento"]);
        assert_eq!(
            plan_sync(&local, Some(&remote(&["Vento"], "t2")), &synced("t1", true)),
            SyncPlan::Nothing
        );
    }

    #[test]
    fn a_local_change_is_pushed_so_a_deleted_word_stays_deleted() {
        // "Enroque" was removed here; the account still has it from before.
        let local = profile(&["Vento"]);
        assert_eq!(
            plan_sync(
                &local,
                Some(&remote(&["Vento", "Enroque"], "t1")),
                &synced("t1", true)
            ),
            SyncPlan::Push(local.clone())
        );
    }

    #[test]
    fn a_change_from_another_computer_replaces_the_local_copy() {
        // The other computer deleted "Enroque" and added "Aula".
        let local = profile(&["Vento", "Enroque"]);
        assert_eq!(
            plan_sync(
                &local,
                Some(&remote(&["Vento", "Aula"], "t2")),
                &synced("t1", false)
            ),
            SyncPlan::TakeRemote(profile(&["Vento", "Aula"]))
        );
    }

    #[test]
    fn changes_on_both_sides_are_merged_and_nothing_is_dropped() {
        let local = profile(&["Vento", "Enroque"]);
        assert_eq!(
            plan_sync(
                &local,
                Some(&remote(&["Vento", "Aula"], "t2")),
                &synced("t1", true)
            ),
            SyncPlan::MergeAndPush(profile(&["Vento", "Enroque", "Aula"]))
        );
    }

    #[test]
    fn the_first_sync_keeps_both_sides_and_believes_the_account_on_conflicts() {
        let local = Profile {
            dictionary: vec!["Enroque".to_string()],
            // A fresh install's factory default.
            app_styles: HashMap::from([("slack".to_string(), "ez_casual".to_string())]),
            ..Profile::default()
        };
        let account = RemoteProfile {
            profile: Profile {
                dictionary: vec!["Vento".to_string()],
                // What the person chose on their other computer.
                app_styles: HashMap::from([("slack".to_string(), "ez_formal".to_string())]),
                ..Profile::default()
            },
            updated_at: "t1".to_string(),
        };

        let SyncPlan::MergeAndPush(merged) =
            plan_sync(&local, Some(&account), &SyncState::default())
        else {
            panic!("expected a merge");
        };
        assert_eq!(merged.dictionary, vec!["Vento", "Enroque"]);
        assert_eq!(
            merged.app_styles.get("slack").map(String::as_str),
            Some("ez_formal")
        );
    }

    #[test]
    fn a_first_sync_with_nothing_new_locally_just_takes_the_account() {
        let local = Profile {
            app_styles: HashMap::from([("slack".to_string(), "ez_casual".to_string())]),
            ..Profile::default()
        };
        let account = RemoteProfile {
            profile: Profile {
                dictionary: vec!["Vento".to_string()],
                app_styles: HashMap::from([("slack".to_string(), "ez_formal".to_string())]),
                ..Profile::default()
            },
            updated_at: "t1".to_string(),
        };
        assert_eq!(
            plan_sync(&local, Some(&account), &SyncState::default()),
            SyncPlan::TakeRemote(account.profile.clone())
        );
    }

    #[test]
    fn merge_dedupes_words_ignoring_case_and_blank_entries() {
        let merged = merge(
            &profile(&["Vento", " ", "enroque"]),
            &profile(&["vento", "Enroque", "Aula"]),
        );
        assert_eq!(merged.dictionary, vec!["Vento", "enroque", "Aula"]);
    }

    #[test]
    fn merge_keeps_the_preferred_snippet_and_style_on_a_conflict() {
        let snippet = |trigger: &str, expansion: &str| SyncedSnippet {
            trigger: trigger.to_string(),
            expansion: expansion.to_string(),
        };
        let local = Profile {
            snippets: vec![snippet("mi mail", "local@example.com")],
            app_styles: HashMap::from([("slack".to_string(), "ez_formal".to_string())]),
            ..Profile::default()
        };
        let remote = Profile {
            snippets: vec![
                snippet("Mi Mail", "remote@example.com"),
                snippet("mi web", "example.com"),
            ],
            app_styles: HashMap::from([
                ("slack".to_string(), "ez_casual".to_string()),
                ("mail".to_string(), "ez_formal".to_string()),
            ]),
            ..Profile::default()
        };

        let merged = merge(&local, &remote);
        assert_eq!(
            merged.snippets,
            vec![
                snippet("mi mail", "local@example.com"),
                snippet("mi web", "example.com")
            ]
        );
        assert_eq!(
            merged.app_styles.get("slack").map(String::as_str),
            Some("ez_formal")
        );
        assert_eq!(
            merged.app_styles.get("mail").map(String::as_str),
            Some("ez_formal")
        );
    }

    #[test]
    fn style_names_follow_the_prompt_ids_and_default_to_neutral() {
        assert_eq!(style_for_prompt(Some("ez_casual")), "casual");
        assert_eq!(style_for_prompt(Some("ez_very_casual")), "very_casual");
        assert_eq!(style_for_prompt(Some("ez_formal")), "formal");
        assert_eq!(style_for_prompt(Some("ez_code")), "code");
        assert_eq!(
            style_for_prompt(Some("default_improve_transcriptions")),
            "neutral"
        );
        assert_eq!(style_for_prompt(None), "neutral");
    }
}
