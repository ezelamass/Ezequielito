//! Dictionary suggestions learned from the person's own dictations.
//!
//! Every cleaned dictation is a small correction record: the raw
//! transcription says what the speech model heard, the cleaned text says
//! what it should have been. A word that keeps being fixed the same way
//! ("bento" → "Vento") belongs in the dictionary, so the speech model gets
//! it right from the start. Pure: no storage, no network.

use serde::Serialize;
use specta::Type;
use std::collections::{HashMap, HashSet};
use strsim::normalized_levenshtein;

/// How many dictations must show the same correction before it is
/// suggested. One occurrence is too easily a one-off rewrite.
const MIN_OCCURRENCES: usize = 2;
/// At least this similar to something that was heard, or it is not a
/// correction of a misheard word but new text the cleanup added.
const MIN_SIMILARITY: f64 = 0.5;
const MIN_WORD_CHARS: usize = 3;
const MAX_SUGGESTIONS: usize = 12;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
pub struct WordSuggestion {
    /// The word as the cleanup wrote it.
    pub word: String,
    /// In how many dictations it replaced something that was misheard.
    pub count: u32,
    /// What the speech model heard instead, most frequent first.
    pub heard_as: Vec<String>,
}

/// One dictation: what was transcribed and what the cleanup returned.
pub struct Dictation<'a> {
    pub raw: &'a str,
    pub cleaned: &'a str,
}

/// Lowercased, without accents or diacritics, letters and digits only.
fn fold(word: &str) -> String {
    word.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .collect()
}

/// Splits text into words, dropping surrounding punctuation but keeping
/// what joins a term together ("GPT-5", "notepad++", "O'Brien").
fn words(text: &str) -> Vec<&str> {
    text.split(|c: char| c.is_whitespace())
        .map(|token| token.trim_matches(|c: char| !c.is_alphanumeric() && c != '+' && c != '#'))
        .filter(|token| !token.is_empty())
        .collect()
}

/// A word worth a dictionary entry: a name, a brand, an acronym, a term
/// with digits. Ordinary lowercase words are spelling, not vocabulary.
fn looks_like_a_term(word: &str, starts_sentence: bool) -> bool {
    let mut chars = word.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let rest: String = chars.collect();
    let has_digit = word.chars().any(|c| c.is_ascii_digit());
    let inner_upper = rest.chars().any(char::is_uppercase);
    let capitalised = first.is_uppercase();
    // A capital at the start of a sentence is grammar, unless the word has
    // more going on ("iPhone", "GPT-5", "YouTube").
    has_digit || inner_upper || (capitalised && !starts_sentence)
}

/// Words the cleanup wrote that correct something misheard, with what was
/// heard instead.
fn corrections<'a>(dictation: &Dictation<'a>) -> Vec<(&'a str, String)> {
    let raw_words = words(dictation.raw);
    let raw_folded: Vec<String> = raw_words.iter().map(|w| fold(w)).collect();
    let raw_set: HashSet<&str> = raw_folded.iter().map(String::as_str).collect();

    let mut found = Vec::new();
    let mut starts_sentence = true;
    for token in dictation.cleaned.split_whitespace() {
        let word = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '+' && c != '#');
        let ends_sentence = token.ends_with(['.', '!', '?', ':']) || token.ends_with('\n');
        let was_sentence_start = starts_sentence;
        starts_sentence = ends_sentence;

        if word.chars().count() < MIN_WORD_CHARS || !looks_like_a_term(word, was_sentence_start) {
            continue;
        }
        let folded = fold(word);
        // Heard correctly (ignoring case and accents): nothing to learn.
        if folded.is_empty() || raw_set.contains(folded.as_str()) {
            continue;
        }
        // What was heard may be one word ("bento") or two that should have
        // been one ("en roque", "you tube"): compare against both.
        let singles = raw_folded.iter().enumerate().map(|(i, heard)| {
            (
                raw_words[i].to_string(),
                normalized_levenshtein(&folded, heard),
            )
        });
        let pairs = raw_folded.windows(2).enumerate().map(|(i, pair)| {
            (
                format!("{} {}", raw_words[i], raw_words[i + 1]),
                normalized_levenshtein(&folded, &format!("{}{}", pair[0], pair[1])),
            )
        });
        let closest = singles.chain(pairs).max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((heard, similarity)) = closest {
            if similarity >= MIN_SIMILARITY {
                found.push((word, heard));
            }
        }
    }
    found
}

/// Suggests dictionary words from past dictations.
///
/// `dictionary` and `dismissed` are left out (compared ignoring case and
/// accents). Most frequent first.
pub fn suggest_words(
    dictations: &[Dictation<'_>],
    dictionary: &[String],
    dismissed: &[String],
) -> Vec<WordSuggestion> {
    let known: HashSet<String> = dictionary
        .iter()
        .chain(dismissed.iter())
        .map(|word| fold(word))
        .collect();

    struct Tally {
        word: String,
        count: u32,
        heard: HashMap<String, u32>,
    }
    let mut tallies: HashMap<String, Tally> = HashMap::new();

    for dictation in dictations {
        // One dictation counts once per word, however often it repeats it.
        let mut seen_here: HashSet<String> = HashSet::new();
        for (word, heard) in corrections(dictation) {
            let key = fold(word);
            if known.contains(&key) || !seen_here.insert(key.clone()) {
                continue;
            }
            let tally = tallies.entry(key).or_insert_with(|| Tally {
                word: word.to_string(),
                count: 0,
                heard: HashMap::new(),
            });
            tally.count += 1;
            *tally.heard.entry(heard.to_lowercase()).or_insert(0) += 1;
        }
    }

    let mut suggestions: Vec<WordSuggestion> = tallies
        .into_values()
        .filter(|tally| tally.count as usize >= MIN_OCCURRENCES)
        .map(|tally| {
            let mut heard: Vec<(String, u32)> = tally.heard.into_iter().collect();
            heard.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            WordSuggestion {
                word: tally.word,
                count: tally.count,
                heard_as: heard.into_iter().map(|(word, _)| word).take(3).collect(),
            }
        })
        .collect();
    suggestions.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.word.cmp(&b.word)));
    suggestions.truncate(MAX_SUGGESTIONS);
    suggestions
}

/// Cleans up a selection the person wants in the dictionary. Returns the
/// word (or short phrase), or `None` when the selection is not one.
pub fn word_from_selection(selection: &str) -> Option<String> {
    let cleaned = selection.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = cleaned.trim_matches(|c: char| !c.is_alphanumeric() && c != '+' && c != '#');
    let word_count = trimmed.split(' ').count();
    if trimmed.is_empty() || trimmed.chars().count() > 60 || word_count > 4 {
        None
    } else {
        Some(trimmed.to_string())
    }
}

/// Adds `word` to `dictionary` unless it is already there (ignoring case
/// and accents). Returns whether it was added.
pub fn add_word(dictionary: &mut Vec<String>, word: &str) -> bool {
    let key = fold(word);
    if key.is_empty() || dictionary.iter().any(|existing| fold(existing) == key) {
        return false;
    }
    dictionary.push(word.to_string());
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn suggest(
        pairs: &[(&str, &str)],
        dictionary: &[&str],
        dismissed: &[&str],
    ) -> Vec<WordSuggestion> {
        let dictations: Vec<Dictation> = pairs
            .iter()
            .map(|(raw, cleaned)| Dictation { raw, cleaned })
            .collect();
        let dictionary: Vec<String> = dictionary.iter().map(|w| w.to_string()).collect();
        let dismissed: Vec<String> = dismissed.iter().map(|w| w.to_string()).collect();
        suggest_words(&dictations, &dictionary, &dismissed)
    }

    const BENTO: (&str, &str) = (
        "le conté que bento ya está andando",
        "Le conté que Vento ya está andando.",
    );
    const VENTO_AGAIN: (&str, &str) = (
        "mañana abro vento y te muestro",
        "Mañana abro Vento y te muestro.",
    );
    const BENTO_AGAIN: (&str, &str) = ("subí el video a bento", "Subí el video a Vento.");

    #[test]
    fn a_name_fixed_the_same_way_twice_is_suggested_with_what_was_heard() {
        let suggestions = suggest(&[BENTO, BENTO_AGAIN], &[], &[]);
        assert_eq!(
            suggestions,
            vec![WordSuggestion {
                word: "Vento".to_string(),
                count: 2,
                heard_as: vec!["bento".to_string()],
            }]
        );
    }

    #[test]
    fn a_single_correction_is_not_enough() {
        assert_eq!(suggest(&[BENTO], &[], &[]), Vec::new());
    }

    #[test]
    fn a_name_that_was_heard_right_teaches_nothing() {
        // "vento" → "Vento" is capitalisation, not a misheard word.
        assert_eq!(suggest(&[VENTO_AGAIN, VENTO_AGAIN], &[], &[]), Vec::new());
    }

    #[test]
    fn words_already_in_the_dictionary_or_dismissed_are_left_out() {
        assert_eq!(suggest(&[BENTO, BENTO_AGAIN], &["vento"], &[]), Vec::new());
        assert_eq!(suggest(&[BENTO, BENTO_AGAIN], &[], &["Vento"]), Vec::new());
    }

    #[test]
    fn ordinary_words_and_sentence_capitals_are_not_vocabulary() {
        let pairs = [
            ("eh mañana boi a la oficina", "Mañana voy a la oficina."),
            ("eh mañana boi al banco", "Mañana voy al banco."),
        ];
        assert_eq!(suggest(&pairs, &[], &[]), Vec::new());
    }

    #[test]
    fn text_the_cleanup_added_from_nowhere_is_not_a_correction() {
        let pairs = [
            ("te mando el archivo", "Te mando el archivo, Federico."),
            ("te llamo después", "Te llamo después, Federico."),
        ];
        assert_eq!(suggest(&pairs, &[], &[]), Vec::new());
    }

    #[test]
    fn terms_with_inner_capitals_count_even_at_the_start_of_a_sentence() {
        let pairs = [
            ("tic toc me bloqueó el video", "TikTok me bloqueó el video."),
            ("abrí tic tok ahora", "Abrí TikTok ahora."),
        ];
        let suggestions = suggest(&pairs, &[], &[]);
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].word, "TikTok");
        assert_eq!(suggestions[0].count, 2);
        assert_eq!(suggestions[0].heard_as, vec!["tic toc", "tic tok"]);
    }

    #[test]
    fn a_word_too_far_from_anything_heard_is_not_suggested() {
        // Sounds alike, but is spelled too differently to tell apart from
        // text the cleanup made up.
        let pairs = [
            ("el aifon se rompió", "El iPhone se rompió."),
            ("mi aifon no prende", "Mi iPhone no prende."),
        ];
        assert_eq!(suggest(&pairs, &[], &[]), Vec::new());
    }

    #[test]
    fn two_words_that_should_have_been_one_are_a_correction_too() {
        let pairs = [
            ("lo subí a you tube ayer", "Lo subí a YouTube ayer."),
            ("mirá el video en you tube", "Mirá el video en YouTube."),
        ];
        let suggestions = suggest(&pairs, &[], &[]);
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].word, "YouTube");
        assert_eq!(suggestions[0].heard_as, vec!["you tube"]);
    }

    #[test]
    fn repeating_the_word_inside_one_dictation_counts_once() {
        let pairs = [("bento y bento", "Vento y Vento.")];
        assert_eq!(suggest(&pairs, &[], &[]), Vec::new());
    }

    #[test]
    fn the_most_corrected_word_comes_first() {
        let pairs = [
            BENTO,
            BENTO_AGAIN,
            ("abrí bento otra vez", "Abrí Vento otra vez."),
            ("hablé con en roque ayer", "Hablé con Enroque ayer."),
            ("mandale a en roque el link", "Mandale a Enroque el link."),
        ];
        let words: Vec<String> = suggest(&pairs, &[], &[])
            .into_iter()
            .map(|s| s.word)
            .collect();
        assert_eq!(words.first().map(String::as_str), Some("Vento"));
    }

    #[test]
    fn a_selected_word_or_short_phrase_can_go_in_the_dictionary() {
        assert_eq!(word_from_selection("  Vento, "), Some("Vento".to_string()));
        assert_eq!(
            word_from_selection("Juan\nPérez"),
            Some("Juan Pérez".to_string())
        );
        assert_eq!(word_from_selection("C++"), Some("C++".to_string()));
    }

    #[test]
    fn a_sentence_or_nothing_is_not_a_dictionary_word() {
        assert_eq!(word_from_selection("   "), None);
        assert_eq!(word_from_selection("esto es una oración entera"), None);
        assert_eq!(word_from_selection(&"x".repeat(80)), None);
    }

    #[test]
    fn a_word_is_added_once_ignoring_case_and_accents() {
        let mut dictionary = vec!["Vento".to_string()];
        assert!(!add_word(&mut dictionary, "vento"));
        assert!(add_word(&mut dictionary, "Pérez"));
        assert!(!add_word(&mut dictionary, "perez"));
        assert_eq!(dictionary, vec!["Vento", "Pérez"]);
    }
}
