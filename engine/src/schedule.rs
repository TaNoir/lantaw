//! Turns a [`Schedule`] into its nominal (pre-shift) dates.

use chrono::{Datelike, Duration, NaiveDate};

use crate::model::{Cadence, KinsenasSecond, Schedule};

/// Last day of the given month (handles leap years). `None` only if the date
/// is outside chrono's supported range.
fn last_day_of_month(year: i32, month: u32) -> Option<u32> {
    let (ny, nm) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    let first_next = NaiveDate::from_ymd_opt(ny, nm, 1)?;
    Some((first_next - Duration::days(1)).day())
}

/// The date in `(year, month)` with `day` clamped to the month's end.
fn clamped(year: i32, month: u32, day: u32) -> Option<NaiveDate> {
    let last = last_day_of_month(year, month)?;
    NaiveDate::from_ymd_opt(year, month, day.min(last))
}

/// `start`'s year-month plus `n` months, as `(year, month)`.
fn add_months(start: NaiveDate, n: u32) -> (i32, u32) {
    let total = start.year() * 12 + (start.month() as i32 - 1) + n as i32;
    (total.div_euclid(12), total.rem_euclid(12) as u32 + 1)
}

/// Nominal dates of a schedule, ascending, from `s.start` on.
///
/// Ends after `s.end` (inclusive) when set; otherwise the iterator is
/// infinite, so callers should `take(n)` or `take_while(..)`.
///
/// Every date is computed from the *anchor* (the start), never by chaining
/// from the previous date. That is why a "day 31" monthly schedule goes
/// Jan 31, Feb 28, Mar 31 rather than drifting to the 28th forever.
pub fn dates(s: &Schedule) -> impl Iterator<Item = NaiveDate> + '_ {
    let start = s.start;
    let end = s.end;

    // Raw candidates in ascending order (some may precede `start`; filtered below).
    let raw: Box<dyn Iterator<Item = NaiveDate> + '_> = match &s.every {
        Cadence::Once => Box::new(std::iter::once(start)),
        Cadence::Weekly => Box::new(
            (0i64..).map_while(move |k| start.checked_add_signed(Duration::days(7 * k))),
        ),
        Cadence::EveryTwoWeeks => Box::new(
            (0i64..).map_while(move |k| start.checked_add_signed(Duration::days(14 * k))),
        ),
        Cadence::Monthly { day } => {
            let day = *day;
            Box::new((0u32..).map_while(move |n| {
                let (y, m) = add_months(start, n);
                clamped(y, m, day)
            }))
        }
        Cadence::Kinsenas { second } => {
            let second = *second;
            Box::new(
                (0u32..)
                    .map_while(move |n| {
                        let (y, m) = add_months(start, n);
                        let second_day = match second {
                            KinsenasSecond::Thirtieth => 30,
                            KinsenasSecond::LastDay => 31,
                        };
                        Some([clamped(y, m, 15)?, clamped(y, m, second_day)?])
                    })
                    .flatten(),
            )
        }
        Cadence::Yearly { month, day } => {
            let (month, day) = (*month, *day);
            Box::new((0i32..).map_while(move |n| clamped(start.year() + n, month, day)))
        }
    };

    raw.filter(move |d| *d >= start)
        .take_while(move |d| end.map_or(true, |e| *d <= e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn sched(start: NaiveDate, end: Option<NaiveDate>, every: Cadence) -> Schedule {
        Schedule { start, end, every }
    }

    #[test]
    fn monthly_31_clamps_from_anchor() {
        let s = sched(d(2027, 1, 31), None, Cadence::Monthly { day: 31 });
        let got: Vec<_> = dates(&s).take(5).collect();
        assert_eq!(
            got,
            vec![d(2027, 1, 31), d(2027, 2, 28), d(2027, 3, 31), d(2027, 4, 30), d(2027, 5, 31)]
        );
    }

    #[test]
    fn monthly_leap_year() {
        let s = sched(d(2028, 1, 31), None, Cadence::Monthly { day: 31 });
        let got: Vec<_> = dates(&s).take(2).collect();
        assert_eq!(got, vec![d(2028, 1, 31), d(2028, 2, 29)]);
    }

    #[test]
    fn kinsenas_thirtieth_in_february() {
        let s = sched(d(2027, 2, 1), None, Cadence::Kinsenas { second: KinsenasSecond::Thirtieth });
        let got: Vec<_> = dates(&s).take(4).collect();
        assert_eq!(got, vec![d(2027, 2, 15), d(2027, 2, 28), d(2027, 3, 15), d(2027, 3, 30)]);
    }

    #[test]
    fn kinsenas_last_day() {
        let s = sched(d(2027, 3, 1), None, Cadence::Kinsenas { second: KinsenasSecond::LastDay });
        let got: Vec<_> = dates(&s).take(2).collect();
        assert_eq!(got, vec![d(2027, 3, 15), d(2027, 3, 31)]);
    }

    #[test]
    fn kinsenas_starting_mid_month() {
        let s = sched(d(2027, 2, 16), None, Cadence::Kinsenas { second: KinsenasSecond::Thirtieth });
        assert_eq!(dates(&s).next(), Some(d(2027, 2, 28)));
    }

    #[test]
    fn yearly_feb_29_clamps() {
        let s = sched(d(2027, 1, 1), None, Cadence::Yearly { month: 2, day: 29 });
        let got: Vec<_> = dates(&s).take(2).collect();
        assert_eq!(got, vec![d(2027, 2, 28), d(2028, 2, 29)]);
    }

    #[test]
    fn every_two_weeks() {
        let s = sched(d(2026, 11, 13), None, Cadence::EveryTwoWeeks);
        let got: Vec<_> = dates(&s).take(3).collect();
        assert_eq!(got, vec![d(2026, 11, 13), d(2026, 11, 27), d(2026, 12, 11)]);
    }

    #[test]
    fn end_is_inclusive() {
        let s = sched(d(2027, 1, 10), Some(d(2027, 3, 10)), Cadence::Monthly { day: 10 });
        assert_eq!(dates(&s).count(), 3);
    }

    #[test]
    fn once_yields_one() {
        let s = sched(d(2027, 6, 1), None, Cadence::Once);
        assert_eq!(dates(&s).collect::<Vec<_>>(), vec![d(2027, 6, 1)]);
    }
}
