//! Working-day calendar: which days count as business days, and how to move a
//! date that lands on a weekend or holiday.

use std::collections::HashSet;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::model::BusinessDayRule;

/// A set of public-holiday dates. A *working day* is Monday to Friday that is
/// not in this set.
#[derive(Debug, Clone, Default)]
pub struct HolidaySet {
    dates: HashSet<NaiveDate>,
}

impl HolidaySet {
    /// Builds a set from a slice of dates (duplicates are fine).
    pub fn new(dates: &[NaiveDate]) -> HolidaySet {
        HolidaySet { dates: dates.iter().copied().collect() }
    }

    /// True when `d` is Mon-Fri and not a holiday.
    pub fn is_working_day(&self, d: NaiveDate) -> bool {
        !matches!(d.weekday(), Weekday::Sat | Weekday::Sun) && !self.dates.contains(&d)
    }

    /// Moves `d` according to `rule`:
    /// * `None` keeps the date as is,
    /// * `Previous` steps back one day at a time until a working day,
    /// * `Next` steps forward one day at a time until a working day.
    ///
    /// Stepping one day at a time makes it chain naturally across a weekend
    /// followed by a holiday (or any run of non-working days). A date that is
    /// already a working day is returned unchanged.
    pub fn shift(&self, d: NaiveDate, rule: BusinessDayRule) -> NaiveDate {
        let step: i64 = match rule {
            BusinessDayRule::None => return d,
            BusinessDayRule::Previous => -1,
            BusinessDayRule::Next => 1,
        };
        let mut cur = d;
        while !self.is_working_day(cur) {
            cur += chrono::Duration::days(step);
        }
        cur
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn previous_chains_over_weekend_and_holiday() {
        // 2027-05-15 is Sat, Fri 14th is a holiday
        let h = HolidaySet::new(&[d(2027, 5, 14)]);
        assert_eq!(h.shift(d(2027, 5, 15), BusinessDayRule::Previous), d(2027, 5, 13));
    }

    #[test]
    fn next_skips_christmas_weekend() {
        // 2026-12-25 is Fri
        let h = HolidaySet::new(&[d(2026, 12, 25)]);
        assert_eq!(h.shift(d(2026, 12, 25), BusinessDayRule::Next), d(2026, 12, 28));
    }

    #[test]
    fn none_rule_keeps_date() {
        assert_eq!(
            HolidaySet::new(&[]).shift(d(2026, 11, 15), BusinessDayRule::None),
            d(2026, 11, 15)
        );
    }

    #[test]
    fn weekend_is_not_working() {
        let h = HolidaySet::new(&[]);
        assert!(h.is_working_day(d(2026, 11, 13)));
        assert!(!h.is_working_day(d(2026, 11, 14)));
    }
}
