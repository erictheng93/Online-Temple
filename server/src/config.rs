use tracing_subscriber::EnvFilter;

pub struct Config {
    pub port: u16,
    pub allowed_origins: Vec<String>,
    pub room_capacity: usize,
    pub log_filter: EnvFilter,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::parse(|key| match std::env::var(key) {
            Ok(value) => Ok(Some(value)),
            Err(std::env::VarError::NotPresent) => Ok(None),
            Err(_) => Err(format!("{key} must be valid Unicode")),
        })
    }

    fn parse(get: impl Fn(&str) -> Result<Option<String>, String>) -> Result<Self, String> {
        let port = get("PORT")?
            .unwrap_or_else(|| "8080".into())
            .parse::<u16>()
            .map_err(|_| "PORT must be an integer in 1..=65535")?;
        if port == 0 {
            return Err("PORT must be in 1..=65535".into());
        }
        let room_capacity = get("ROOM_CAPACITY")?
            .unwrap_or_else(|| "50".into())
            .parse::<usize>()
            .map_err(|_| "ROOM_CAPACITY must be an integer in 1..=50")?;
        if !(1..=50).contains(&room_capacity) {
            return Err("ROOM_CAPACITY must be in 1..=50".into());
        }
        let origins = get("ALLOWED_ORIGINS")?.unwrap_or_else(|| "http://localhost:5173".into());
        let allowed_origins: Vec<String> =
            origins.split(',').map(|v| v.trim().to_owned()).collect();
        for origin in &allowed_origins {
            let uri = origin
                .parse::<axum::http::Uri>()
                .map_err(|_| "ALLOWED_ORIGINS contains an invalid origin")?;
            if !matches!(uri.scheme_str(), Some("http" | "https"))
                || uri.authority().is_none()
                || uri.authority().is_some_and(|v| v.as_str().contains('@'))
                || uri.path_and_query().is_some_and(|v| v.as_str() != "/")
            {
                return Err("ALLOWED_ORIGINS requires HTTP(S) origins without paths, queries or credentials".into());
            }
        }
        let log_filter = EnvFilter::try_new(get("RUST_LOG")?.unwrap_or_else(|| "info".into()))
            .map_err(|e| format!("RUST_LOG: {e}"))?;
        Ok(Self {
            port,
            allowed_origins,
            room_capacity,
            log_filter,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_and_invalid_settings() {
        let config = Config::parse(|_| Ok(None)).unwrap();
        assert_eq!(config.port, 8080);
        assert_eq!(config.room_capacity, 50);
        for (key, value) in [
            ("PORT", "abc"),
            ("PORT", "0"),
            ("ROOM_CAPACITY", "51"),
            ("ROOM_CAPACITY", "0"),
            ("ALLOWED_ORIGINS", "*"),
            ("ALLOWED_ORIGINS", "https://example.com/path"),
            ("RUST_LOG", "[broken"),
        ] {
            assert!(
                Config::parse(|k| Ok((k == key).then(|| value.into()))).is_err(),
                "{key}={value}"
            );
        }
    }
}
