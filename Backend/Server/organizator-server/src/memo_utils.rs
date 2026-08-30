use regex::Regex;
use std::sync::LazyLock;
use uuid::Uuid;

// Compiles the Regex only once on first access
static UUID_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?<uuid>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.",
    )
    .unwrap()
});

pub fn extract_uuids(text: &str) -> Vec<Uuid> {
    UUID_RE
        .captures_iter(text)
        .map(|caps| caps.name("uuid").unwrap().as_str())
        .map(|uuid_str| Uuid::parse_str(uuid_str).unwrap())
        .collect()
}

#[cfg(test)]
mod tests {

    use super::*;
    #[test]
    fn test_extract_uuids() -> Result<(), Box<dyn std::error::Error>> {
        let memo_body = "\n\nHoi, ik heb een betaalverzoek gemaakt van €150,00 voor Ban 2zits leer wit. Je kunt met elke bank in Nederland betalen. Dank je wel!\nhttps://www.ing.nl/particulier/betaalverzoek/index.html?trxid=lee6r6afaDa9aQaJa3aPaAaAaau9TbL0\n\n\n![file](/files/678aaa4c-be65-40cf-a53d-0d7aec4b380f.jpg)\n![file](/files/b35546ee-dc21-4f2b-adae-c1e6832f97cd.jpg)\n![file](/files/61f47e58-ae08-495b-9d65-4a3e74a8610c.jpg)\n![file](/files/fdbe83d8-9200-4b53-8416-d9bf121d18e5.jpg)\n![file](/files/84567efc-34e5-4602-ae43-27af85945d98.jpg)\n\n\n![Semn3.png](/files/694f3acd-68f6-420c-a5f9-4738973d0281.png)\n";

        let uuids = extract_uuids(memo_body);
        assert_eq!(uuids.len(), 6);
        // Check that the extracted UUIDs match the expected values
        assert_eq!(
            uuids[0],
            Uuid::parse_str("678aaa4c-be65-40cf-a53d-0d7aec4b380f")?
        );
        assert_eq!(
            uuids[1],
            Uuid::parse_str("b35546ee-dc21-4f2b-adae-c1e6832f97cd")?
        );
        assert_eq!(
            uuids[2],
            Uuid::parse_str("61f47e58-ae08-495b-9d65-4a3e74a8610c")?
        );
        assert_eq!(
            uuids[3],
            Uuid::parse_str("fdbe83d8-9200-4b53-8416-d9bf121d18e5")?
        );
        assert_eq!(
            uuids[4],
            Uuid::parse_str("84567efc-34e5-4602-ae43-27af85945d98")?
        );
        assert_eq!(
            uuids[5],
            Uuid::parse_str("694f3acd-68f6-420c-a5f9-4738973d0281")?
        );
        Ok(())
    }

    #[test]
    fn test_extract_uuids_no_matches() {
        let memo_body = "This is a test string without any UUIDs.";
        let uuids = extract_uuids(memo_body);
        assert_eq!(uuids.len(), 0);
    }
}
