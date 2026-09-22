//! Slows down guessing at the login form.
//!
//! Argon2 makes every guess cost the server a few tens of milliseconds, but nothing else stops a
//! caller from making them forever: a list of the most common passwords would be exhausted in
//! minutes. Once a few wrong passwords have been tried against a name, that name has to wait, and
//! each further failure doubles the wait up to a cap.
//!
//! A delay rather than a lockout, deliberately: a hard lockout lets anyone lock a real user out of
//! their own account by failing on purpose.
//!
//! The throttle is process-wide rather than stored, which is the scope that matters while one
//! binary serves the login route. It does mean a restart clears everyone's penalty, and that two
//! instances behind a load balancer would each keep their own.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Wrong passwords accepted back to back before the first wait.
const FREE_ATTEMPTS: u32 = 5;
/// The wait owed after the last free failure, doubling with every failure after it.
const FIRST_DELAY: Duration = Duration::from_secs(30);
/// Ceiling for that doubling.
const MAX_DELAY: Duration = Duration::from_secs(15 * 60);
/// How many names are tracked before stale ones start being dropped.
const PRUNE_ABOVE: usize = 5_000;
/// How long a name with nothing outstanding is remembered once the map is over budget.
const REMEMBER: Duration = Duration::from_secs(60 * 60);

#[derive(Default)]
pub struct LoginThrottle {
    names: Mutex<HashMap<String, Attempt>>,
}

struct Attempt {
    failures: u32,
    /// No attempt at this name is answered until this moment.
    retry_at: Instant,
    last_seen: Instant,
}

impl LoginThrottle {
    pub fn new() -> Self {
        Self::default()
    }

    /// How long this name still has to wait. Zero means the attempt may go ahead.
    pub fn wait_left(&self, username: &str) -> Duration {
        self.wait_left_at(username, Instant::now())
    }

    /// Records a wrong password and returns how long the next attempt must wait.
    pub fn record_failure(&self, username: &str) -> Duration {
        self.record_failure_at(username, Instant::now())
    }

    /// Forgets a name, so a successful login clears whatever it had run up.
    pub fn record_success(&self, username: &str) {
        self.names.lock().unwrap().remove(username);
    }

    /// The `now` variants exist so the tests can move time forward without sleeping.
    fn wait_left_at(&self, username: &str, now: Instant) -> Duration {
        let names = self.names.lock().unwrap();
        names
            .get(username)
            .map_or(Duration::ZERO, |attempt| {
                attempt.retry_at.saturating_duration_since(now)
            })
    }

    fn record_failure_at(&self, username: &str, now: Instant) -> Duration {
        let mut names = self.names.lock().unwrap();
        prune(&mut names, now);

        let attempt = names.entry(username.to_string()).or_insert(Attempt {
            failures: 0,
            retry_at: now,
            last_seen: now,
        });
        attempt.failures += 1;
        attempt.last_seen = now;

        let delay = delay_after(attempt.failures);
        attempt.retry_at = now + delay;
        delay
    }
}

/// The wait owed after this many wrong passwords: nothing at first, then doubling to the cap.
fn delay_after(failures: u32) -> Duration {
    let penalised_from = FREE_ATTEMPTS + 1;
    if failures < penalised_from {
        return Duration::ZERO;
    }

    let doublings = (failures - penalised_from).min(20);
    let millis = (FIRST_DELAY.as_millis() as u64).saturating_mul(1u64 << doublings);
    Duration::from_millis(millis).min(MAX_DELAY)
}

/// Names are keyed by whatever the caller sent, including ones that do not exist, so guessed-at
/// usernames are slowed down the same way and the throttle says nothing about which names are
/// real. That does leave the map open to being padded, hence this: once it is over budget, names
/// with nothing outstanding are forgotten. A name still serving a penalty is always kept, so
/// padding the map cannot clear somebody's penalty.
fn prune(names: &mut HashMap<String, Attempt>, now: Instant) {
    if names.len() <= PRUNE_ABOVE {
        return;
    }
    names.retain(|_, attempt| {
        now.duration_since(attempt.last_seen) < REMEMBER || attempt.retry_at > now
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::LazyLock;

    fn at(seconds: u64) -> Instant {
        // One fixed origin for every call. With Instant::now() per call the few hundred
        // microseconds the test itself takes would leak into the arithmetic and the exact
        // assertions below would drift.
        static ORIGIN: LazyLock<Instant> = LazyLock::new(Instant::now);
        *ORIGIN + Duration::from_secs(seconds)
    }

    #[test]
    fn the_first_few_wrong_passwords_cost_nothing() {
        let throttle = LoginThrottle::new();

        for failure in 1..=FREE_ATTEMPTS {
            assert_eq!(
                throttle.record_failure_at("admin", at(0)),
                Duration::ZERO,
                "failure {failure} should not be penalised"
            );
        }
        assert_eq!(throttle.wait_left_at("admin", at(0)), Duration::ZERO);
    }

    #[test]
    fn the_wait_doubles_after_that_and_stops_at_the_cap() {
        let throttle = LoginThrottle::new();
        let mut waits = Vec::new();

        for _ in 0..14 {
            waits.push(throttle.record_failure_at("admin", at(0)).as_secs());
        }

        assert_eq!(
            &waits[..8],
            &[0, 0, 0, 0, 0, 30, 60, 120],
            "five free tries, then 30s onwards"
        );
        assert_eq!(waits[13], 900, "and it stops at 15 minutes");
    }

    #[test]
    fn a_wait_expires_on_its_own() {
        let throttle = LoginThrottle::new();
        for _ in 0..6 {
            throttle.record_failure_at("admin", at(0));
        }

        assert_eq!(throttle.wait_left_at("admin", at(29)), Duration::from_secs(1));
        assert_eq!(throttle.wait_left_at("admin", at(30)), Duration::ZERO);
        assert_eq!(throttle.wait_left_at("admin", at(99)), Duration::ZERO);
    }

    #[test]
    fn a_successful_login_clears_the_count() {
        let throttle = LoginThrottle::new();
        for _ in 0..6 {
            throttle.record_failure_at("admin", at(0));
        }
        assert!(throttle.wait_left_at("admin", at(0)) > Duration::ZERO);

        throttle.record_success("admin");

        assert_eq!(throttle.wait_left_at("admin", at(0)), Duration::ZERO);
        assert_eq!(
            throttle.record_failure_at("admin", at(0)),
            Duration::ZERO,
            "counting starts over rather than resuming at six failures"
        );
    }

    #[test]
    fn a_name_that_does_not_exist_is_slowed_down_too() {
        let throttle = LoginThrottle::new();
        for _ in 0..6 {
            throttle.record_failure_at("nobody", at(0));
        }

        assert!(throttle.wait_left_at("nobody", at(0)) > Duration::ZERO);
        assert_eq!(
            throttle.wait_left_at("admin", at(0)),
            Duration::ZERO,
            "but it does not touch anyone else"
        );
    }

    #[test]
    fn padding_the_map_cannot_clear_a_penalty() {
        let throttle = LoginThrottle::new();
        for _ in 0..6 {
            throttle.record_failure_at("admin", at(0));
        }

        // enough made-up names to push the map over its budget, all long forgotten
        for i in 0..(PRUNE_ABOVE + 10) {
            throttle.record_failure_at(&format!("made-up-{i}"), at(0) - REMEMBER * 2);
        }
        throttle.record_failure_at("admin", at(0));

        assert!(
            throttle.wait_left_at("admin", at(0)) > Duration::ZERO,
            "the penalised name must survive the prune"
        );
    }
}
