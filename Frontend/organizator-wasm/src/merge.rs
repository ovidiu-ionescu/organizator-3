use reconcile_text::{reconcile, BuiltinTokenizer, TextWithCursors};
use similar::{ChangeTag, TextDiff};

pub fn merge(original: &str, ours: &str, theirs: &str) -> String {
    let ours: TextWithCursors = ours.into();
    let theirs: TextWithCursors = theirs.into();
    reconcile(original, &ours, &theirs, &*BuiltinTokenizer::Markdown)
        .apply()
        .text()
        .to_string()
}


/// Returns a unified-diff-style string showing how `old` differs from `new`.
/// Lines prefixed with `-` were removed, `+` were added, ` ` are unchanged.
pub fn diff(old: &str, new: &str) -> String {
    let diff = TextDiff::from_lines(old, new);
    let mut out = String::new();

    for change in diff.iter_all_changes() {
        let sign = match change.tag() {
            ChangeTag::Delete => "-",
            ChangeTag::Insert => "+",
            ChangeTag::Equal => " ",
        };
        out.push_str(sign);
        out.push_str(change.value());
        // `value()` includes the trailing newline for line diffs,
        // but guard in case the input didn't end with one.
        if !change.value().ends_with('\n') {
            out.push('\n');
        }
    }

    out
}
