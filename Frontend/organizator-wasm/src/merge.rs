use diffy_imara::{Algorithm, ConflictStyle, MergeOptions};

pub fn merge_with_options(original: &str, ours: &str, theirs: &str) -> String {
    let mut binding = MergeOptions::new();
    let options = binding
        .set_algorithm(Algorithm::Histogram)
        .set_conflict_style(ConflictStyle::Diff3);

    match options.merge(
        &ensure_terminator(original),
        &ensure_terminator(ours),
        &ensure_terminator(theirs),
    ) {
        Ok(merged) => merged,
        Err(e) => format!("# Merge failed: \n\n{}", e),
    }
}

use std::borrow::Cow;

fn ensure_terminator(s: &str) -> Cow<'_, str> {
    if s.ends_with('\n') {
        Cow::Borrowed(s)
    } else {
        let mut new_s = s.to_string();
        new_s.push('\n');
        Cow::Owned(new_s)
    }
}
