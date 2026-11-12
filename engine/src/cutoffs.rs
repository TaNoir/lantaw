//! Splits the forecast into pay periods ("cutoffs"): each runs from one
//! payday up to the day before the next, with income, outflow and what is left.

use chrono::{Duration, NaiveDate};

use crate::model::{Cutoff, Event};

/// Builds the cutoffs for the forecast window `[start, horizon_end)`.
///
/// * `paydays` are `(nominal, shifted)` pairs in ascending order. The shifted
///   date is the day the money really arrives and starts a cutoff.
/// * `events` are all expanded events (excluded ones too); `event_indices`
///   point into this slice so the UI can show excluded events dimmed.
/// * `days[i]` is the end-of-day balance on `start + i`.
///
/// Cutoff *i* covers `[payday_i, payday_{i+1} - 1]`; the last one ends at
/// `horizon_end - 1`. If `start` is before the first payday, a leading cutoff
/// `[start, first payday - 1]` is added with `payday = nominal = start`.
/// Only *included* events count toward `income` and `outflow` (outflow is
/// reported as a positive number).
pub fn build_cutoffs(
    paydays: &[(NaiveDate, NaiveDate)],
    events: &[Event],
    days: &[i64],
    start: NaiveDate,
    horizon_end: NaiveDate,
) -> Vec<Cutoff> {
    // Cutoff starts as (nominal, shifted). Keep only paydays inside the window
    // and strictly increasing, so no cutoff is ever empty or inverted.
    let mut starts: Vec<(NaiveDate, NaiveDate)> = Vec::new();
    for &(nominal, shifted) in paydays {
        let after_prev = starts.last().map_or(true, |&(_, prev)| shifted > prev);
        if shifted >= start && shifted < horizon_end && after_prev {
            starts.push((nominal, shifted));
        }
    }
    // Leading partial cutoff when the window opens before the first payday.
    if starts.first().map_or(true, |&(_, first)| first > start) {
        starts.insert(0, (start, start));
    }

    let last_day = horizon_end - Duration::days(1);
    let mut out = Vec::with_capacity(starts.len());
    for (i, &(nominal, payday)) in starts.iter().enumerate() {
        let end = match starts.get(i + 1) {
            Some(&(_, next)) => next - Duration::days(1),
            None => last_day,
        };

        let mut income = 0i64;
        let mut outflow = 0i64;
        let mut event_indices = Vec::new();
        for (idx, e) in events.iter().enumerate() {
            if e.date >= payday && e.date <= end {
                event_indices.push(idx);
                if e.included {
                    if e.centavos >= 0 {
                        income += e.centavos;
                    } else {
                        outflow += -e.centavos;
                    }
                }
            }
        }

        // Balance at the end of the cutoff; clamp so a short `days` can't panic.
        let left = usize::try_from((end - start).num_days())
            .ok()
            .and_then(|i| days.get(i).or_else(|| days.last()))
            .copied()
            .unwrap_or(0);

        out.push(Cutoff {
            payday,
            nominal,
            end,
            income_centavos: income,
            outflow_centavos: outflow,
            left_centavos: left,
            event_indices,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn ev(date: NaiveDate, centavos: i64, included: bool) -> Event {
        Event {
            date,
            nominal_date: date,
            item_id: "x".into(),
            name: "x".into(),
            centavos,
            note: None,
            included,
        }
    }

    #[test]
    fn cutoffs_follow_shifted_paydays() {
        let paydays = [
            (d(2026, 11, 15), d(2026, 11, 13)),
            (d(2026, 11, 30), d(2026, 11, 27)),
            (d(2026, 12, 15), d(2026, 12, 15)),
        ];
        let start = d(2026, 11, 13);
        let days = vec![0i64; 60];
        let c = build_cutoffs(&paydays, &[], &days, start, d(2027, 1, 12));
        assert_eq!(c.len(), 3);
        assert_eq!((c[0].payday, c[0].nominal, c[0].end), (d(2026, 11, 13), d(2026, 11, 15), d(2026, 11, 26)));
        assert_eq!((c[1].payday, c[1].end), (d(2026, 11, 27), d(2026, 12, 14)));
        assert_eq!(c[2].end, d(2027, 1, 11));
    }

    #[test]
    fn leading_partial_cutoff() {
        let paydays = [(d(2026, 11, 15), d(2026, 11, 13))];
        let days = vec![0i64; 30];
        let c = build_cutoffs(&paydays, &[], &days, d(2026, 11, 10), d(2026, 12, 10));
        assert_eq!(c.len(), 2);
        assert_eq!((c[0].payday, c[0].nominal, c[0].end), (d(2026, 11, 10), d(2026, 11, 10), d(2026, 11, 12)));
        assert_eq!(c[1].payday, d(2026, 11, 13));
    }

    #[test]
    fn sums_only_included_events() {
        let paydays = [(d(2026, 11, 13), d(2026, 11, 13))];
        let events = [
            ev(d(2026, 11, 14), 1_800_000, true),
            ev(d(2026, 11, 15), -208_300, true),
            ev(d(2026, 11, 16), -500_000, false),
        ];
        let days = vec![7i64; 30];
        let c = build_cutoffs(&paydays, &events, &days, d(2026, 11, 13), d(2026, 12, 13));
        assert_eq!(c[0].income_centavos, 1_800_000);
        assert_eq!(c[0].outflow_centavos, 208_300);
        assert_eq!(c[0].event_indices, vec![0, 1, 2]);
        assert_eq!(c[0].left_centavos, 7);
    }
}
