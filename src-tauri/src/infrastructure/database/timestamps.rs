use chrono::{DateTime, TimeZone, Utc};

const MILLIS_THRESHOLD: i64 = 10_000_000_000;

fn utc_epoch() -> DateTime<Utc> {
    Utc.timestamp_opt(0, 0).single().unwrap_or_else(Utc::now)
}

pub fn utc_from_epoch_seconds_lossy(ts: i64) -> DateTime<Utc> {
    if ts.abs() >= MILLIS_THRESHOLD
        && let Some(dt) = Utc.timestamp_opt(ts / 1000, 0).single()
    {
        log::warn!("Coerced milliseconds timestamp to seconds (ts={ts})");
        return dt;
    }

    if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
        return dt;
    }

    log::warn!("Invalid epoch seconds timestamp (ts={ts}); falling back to epoch");
    utc_epoch()
}

pub fn utc_from_epoch_seconds_lossy_opt(ts: Option<i64>) -> Option<DateTime<Utc>> {
    let ts = ts?;

    if ts.abs() >= MILLIS_THRESHOLD
        && let Some(dt) = Utc.timestamp_opt(ts / 1000, 0).single()
    {
        log::warn!("Coerced milliseconds timestamp to seconds (ts={ts})");
        return Some(dt);
    }

    if let Some(dt) = Utc.timestamp_opt(ts, 0).single() {
        return Some(dt);
    }

    log::warn!("Invalid epoch seconds timestamp (ts={ts}); treating as missing");
    None
}

pub fn utc_from_epoch_millis_lossy(ms: i64) -> DateTime<Utc> {
    let candidate = if ms.abs() < MILLIS_THRESHOLD { ms * 1000 } else { ms };

    if let Some(dt) = Utc.timestamp_millis_opt(candidate).single() {
        if candidate != ms {
            log::warn!("Coerced seconds timestamp to millis (ms={ms})");
        }
        return dt;
    }

    if let Some(dt) = Utc.timestamp_opt(ms, 0).single() {
        log::warn!("Coerced seconds timestamp to millis via seconds parse (ms={ms})");
        return dt;
    }

    log::warn!("Invalid epoch millis timestamp (ms={ms}); falling back to epoch");
    utc_epoch()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn seconds_lossy_normal_timestamp() {
        let dt = utc_from_epoch_seconds_lossy(1_700_000_000);
        assert_eq!(dt, Utc.timestamp_opt(1_700_000_000, 0).unwrap());
    }

    #[test]
    fn seconds_lossy_zero() {
        let dt = utc_from_epoch_seconds_lossy(0);
        assert_eq!(dt, Utc.timestamp_opt(0, 0).unwrap());
    }

    #[test]
    fn seconds_lossy_coerces_millis_to_seconds() {
        let millis = 1_700_000_000_000_i64;
        let dt = utc_from_epoch_seconds_lossy(millis);
        assert_eq!(dt, Utc.timestamp_opt(1_700_000_000, 0).unwrap());
    }

    #[test]
    fn seconds_lossy_negative_normal() {
        let dt = utc_from_epoch_seconds_lossy(-1_000);
        assert_eq!(dt, Utc.timestamp_opt(-1_000, 0).unwrap());
    }

    #[test]
    fn seconds_lossy_threshold_boundary() {
        let just_below = MILLIS_THRESHOLD - 1;
        let dt = utc_from_epoch_seconds_lossy(just_below);
        assert_eq!(dt, Utc.timestamp_opt(just_below, 0).unwrap());

        let at_threshold = MILLIS_THRESHOLD;
        let dt2 = utc_from_epoch_seconds_lossy(at_threshold);
        assert_eq!(dt2, Utc.timestamp_opt(at_threshold / 1000, 0).unwrap());
    }

    #[test]
    fn seconds_lossy_opt_none_input() {
        assert!(utc_from_epoch_seconds_lossy_opt(None).is_none());
    }

    #[test]
    fn seconds_lossy_opt_normal_timestamp() {
        let result = utc_from_epoch_seconds_lossy_opt(Some(1_700_000_000));
        assert_eq!(result, Some(Utc.timestamp_opt(1_700_000_000, 0).unwrap()));
    }

    #[test]
    fn seconds_lossy_opt_coerces_millis() {
        let result = utc_from_epoch_seconds_lossy_opt(Some(1_700_000_000_000));
        assert_eq!(result, Some(Utc.timestamp_opt(1_700_000_000, 0).unwrap()));
    }

    #[test]
    fn seconds_lossy_opt_zero() {
        let result = utc_from_epoch_seconds_lossy_opt(Some(0));
        assert_eq!(result, Some(Utc.timestamp_opt(0, 0).unwrap()));
    }

    #[test]
    fn millis_lossy_normal_millis() {
        let ms = 1_700_000_000_000_i64;
        let dt = utc_from_epoch_millis_lossy(ms);
        assert_eq!(dt, Utc.timestamp_millis_opt(ms).unwrap());
    }

    #[test]
    fn millis_lossy_coerces_seconds_to_millis() {
        let seconds_value = 1_000_i64;
        let dt = utc_from_epoch_millis_lossy(seconds_value);
        assert_eq!(dt, Utc.timestamp_millis_opt(seconds_value * 1000).unwrap());
    }

    #[test]
    fn millis_lossy_zero() {
        let dt = utc_from_epoch_millis_lossy(0);
        assert_eq!(dt, Utc.timestamp_opt(0, 0).unwrap());
    }

    #[test]
    fn millis_lossy_threshold_boundary() {
        let below = MILLIS_THRESHOLD - 1;
        let dt = utc_from_epoch_millis_lossy(below);
        assert_eq!(dt, Utc.timestamp_millis_opt(below * 1000).unwrap());

        let at = MILLIS_THRESHOLD;
        let dt2 = utc_from_epoch_millis_lossy(at);
        assert_eq!(dt2, Utc.timestamp_millis_opt(at).unwrap());
    }

    #[test]
    fn utc_epoch_returns_unix_epoch() {
        let epoch = super::utc_epoch();
        assert_eq!(epoch, Utc.timestamp_opt(0, 0).unwrap());
    }
}
