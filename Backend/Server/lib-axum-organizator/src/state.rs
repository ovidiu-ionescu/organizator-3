use deadpool_postgres::Pool;

use crate::{postgres::HasPool, security::jot::Jot, settings::Settings};

pub struct AppState {
    pub settings: Settings,
    pub pool: deadpool_postgres::Pool,
    pub jot: Jot,
}

impl HasPool for AppState {
    fn pool(&self) -> &Pool {
        &self.pool
    }
}

