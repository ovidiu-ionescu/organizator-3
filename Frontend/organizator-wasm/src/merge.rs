use reconcile_text::{reconcile, BuiltinTokenizer, TextWithCursors};

pub fn merge_with_options(original: &str, ours: &str, theirs: &str) -> String {
    let ours: TextWithCursors = ours.into();
    let theirs: TextWithCursors = theirs.into();
    reconcile(original, &ours, &theirs, &*BuiltinTokenizer::Markdown)
        .apply()
        .text()
        .to_string()
}
