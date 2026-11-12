//! The engine's main entry point: [`project`] turns an [`Input`] into a
//! day-by-day [`Projection`] (balances, gipit, cutoffs, finish lines).

use std::collections::{HashMap, HashSet};

use chrono::{Datelike, Duration, Months, NaiveDate};
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;
use rust_decimal::RoundingStrategy;

use crate::calendar::HolidaySet;
use crate::cutoffs::build_cutoffs;
use crate::expand::{expand, Ctx};
use crate::model::{
    Cadence, Cutoff, EngineError, Event, FinishLine, Input, Item, ItemKind, KinsenasSecond,
    LowPoint, MonthEnd, Projection, Schedule,
};
use crate::money::to_centavos;
use crate::schedule;

/// How far past the horizon we look at nominal payday dates, because a
/// `Previous` shift can pull a later nominal date back inside the window.
const LOOKAHEAD_DAYS: i64 = 31;

/// Builds the full forecast for `input`.
///
/// The window is `[balance_as_of, balance_as_of + horizon_months)`. Never
/// panics on an empty item list or a `today` outside the window; those give a
/// flat line and `expected_today: None` respectively.
pub fn project(input: &Input) -> Result<Projection, EngineError> {
    let s = &input.settings;
    let start = s.balance_as_of;
    let horizon_end = start
        .checked_add_months(Months::new(s.horizon_months))
        .ok_or_else(|| EngineError::InvalidItem {
            id: "settings".into(),
            reason: "horizon is out of range".into(),
        })?;
    let n_days = (horizon_end - start).num_days().max(0) as usize;

    let holidays = HolidaySet::new(&input.holidays);
    let paid: HashSet<String> = s.paid_on_as_of.iter().cloned().collect();
    let ctx = Ctx {
        as_of: start,
        horizon_end,
        holidays: &holidays,
        fx: &input.fx,
        fee_pct: s.card_fx_fee_pct,
        paid_on_as_of: &paid,
    };

    // Expand every item. Items are visited in order and the sort is stable,
    // so ties on date keep the item order.
    let mut events: Vec<Event> = Vec::new();
    for item in &input.items {
        events.extend(expand(item, &ctx)?);
    }
    events.sort_by_key(|e| e.date);

    let opening = to_centavos(s.balance);
    let days = balance_series(opening, start, n_days, &events, true);
    let what_if_days = if input.items.iter().any(|i| !i.included) {
        Some(balance_series(opening, start, n_days, &events, false))
    } else {
        None
    };

    // Lowest balance; `min_by_key` keeps the first of equal minimums.
    let gipit_idx = days
        .iter()
        .enumerate()
        .min_by_key(|&(_, &c)| c)
        .map(|(i, _)| i);

    let paydays = payday_pairs(input, start, horizon_end, &holidays);
    let cutoffs = build_cutoffs(&paydays, &events, &days, start, horizon_end);

    let gipit = gipit_idx.map(|i| {
        let date = start + Duration::days(i as i64);
        LowPoint { date, centavos: days[i], causes: gipit_causes(date, &cutoffs, &events) }
    });

    let buffer = to_centavos(s.safety_buffer);
    let first_below = |limit: i64| {
        days.iter()
            .position(|&c| c < limit)
            .map(|i| start + Duration::days(i as i64))
    };

    let expected_today = usize::try_from((input.today - start).num_days())
        .ok()
        .and_then(|i| days.get(i))
        .copied();

    Ok(Projection {
        start,
        first_below_buffer: first_below(buffer),
        first_below_zero: first_below(0),
        month_ends: month_ends(start, &days),
        finish_lines: finish_lines(&input.items, &events, start, horizon_end, &holidays),
        days,
        events,
        what_if_days,
        gipit,
        cutoffs,
        expected_today,
    })
}

/// End-of-day balances: `opening` plus every event on or before each day.
/// With `only_included`, events of what-if items are skipped.
fn balance_series(
    opening: i64,
    start: NaiveDate,
    n_days: usize,
    events: &[Event],
    only_included: bool,
) -> Vec<i64> {
    let mut delta = vec![0i64; n_days];
    for e in events {
        if only_included && !e.included {
            continue;
        }
        // Events are always inside the window; the checks are just defensive.
        if let Ok(i) = usize::try_from((e.date - start).num_days()) {
            if i < n_days {
                delta[i] += e.centavos;
            }
        }
    }
    let mut running = opening;
    delta
        .into_iter()
        .map(|d| {
            running += d;
            running
        })
        .collect()
}

/// `(nominal, shifted)` paydays inside `[start, horizon_end)`.
///
/// Uses the main-sweldo item's schedule. Without one, falls back to the 15th
/// and last day of every month, unshifted.
fn payday_pairs(
    input: &Input,
    start: NaiveDate,
    horizon_end: NaiveDate,
    holidays: &HolidaySet,
) -> Vec<(NaiveDate, NaiveDate)> {
    let is_main = |i: &&Item| matches!(i.kind, ItemKind::Income { main_sweldo: true });
    let main = input
        .items
        .iter()
        .filter(is_main)
        .find(|i| i.included)
        .or_else(|| input.items.iter().find(is_main));

    let limit = horizon_end + Duration::days(LOOKAHEAD_DAYS);
    let pairs: Vec<(NaiveDate, NaiveDate)> = match main {
        Some(item) => schedule::dates(&item.schedule)
            .take_while(|n| *n <= limit)
            .map(|n| (n, holidays.shift(n, item.business_day)))
            .collect(),
        None => {
            // Anchor on the 1st of the start month so the 15th is not missed.
            let anchor = start.with_day(1).unwrap_or(start);
            let sched = Schedule {
                start: anchor,
                end: None,
                every: Cadence::Kinsenas { second: KinsenasSecond::LastDay },
            };
            schedule::dates(&sched)
                .take_while(|n| *n <= limit)
                .map(|n| (n, n))
                .collect()
        }
    };
    pairs
        .into_iter()
        .filter(|&(_, shifted)| shifted >= start && shifted < horizon_end)
        .collect()
}

/// Item ids of the outflows in the cutoff containing `date`: one entry per
/// item (its outflows summed), biggest first, at most 3.
fn gipit_causes(date: NaiveDate, cutoffs: &[Cutoff], events: &[Event]) -> Vec<String> {
    let Some(cutoff) = cutoffs.iter().find(|c| c.payday <= date && date <= c.end) else {
        return Vec::new();
    };
    let mut totals: Vec<(String, i64)> = Vec::new();
    for &idx in &cutoff.event_indices {
        let e = &events[idx];
        if !e.included || e.centavos >= 0 {
            continue;
        }
        match totals.iter_mut().find(|(id, _)| *id == e.item_id) {
            Some((_, sum)) => *sum += -e.centavos,
            None => totals.push((e.item_id.clone(), -e.centavos)),
        }
    }
    // Stable sort: equal amounts keep their date order.
    totals.sort_by(|a, b| b.1.cmp(&a.1));
    totals.into_iter().take(3).map(|(id, _)| id).collect()
}

/// The balance on the last day of each month in the window (a partial last
/// month reports its final day).
fn month_ends(start: NaiveDate, days: &[i64]) -> Vec<MonthEnd> {
    let mut out = Vec::new();
    for (i, &c) in days.iter().enumerate() {
        let d = start + Duration::days(i as i64);
        let next = d + Duration::days(1);
        let last_of_window = i + 1 == days.len();
        if last_of_window || next.month() != d.month() {
            out.push(MonthEnd { month: format!("{:04}-{:02}", d.year(), d.month()), centavos: c });
        }
    }
    out
}

/// One finish line per included Installment or Paluwagan whose final payment
/// lands inside the window, ordered by date.
fn finish_lines(
    items: &[Item],
    events: &[Event],
    start: NaiveDate,
    horizon_end: NaiveDate,
    holidays: &HolidaySet,
) -> Vec<FinishLine> {
    let mut by_item: HashMap<&str, Vec<&Event>> = HashMap::new();
    for e in events {
        by_item.entry(e.item_id.as_str()).or_default().push(e);
    }

    let mut out = Vec::new();
    for item in items.iter().filter(|i| i.included) {
        let mine = by_item.get(item.id.as_str()).map(Vec::as_slice).unwrap_or(&[]);
        let Some(last_event) = mine.last() else { continue };

        // `final_date` is the shifted date of the item's very last payment.
        let (final_date, unit) = match &item.kind {
            ItemKind::Installment { total_payments, paid_override } => {
                let final_date = match paid_override {
                    // Remaining payments are counted from the forecast start,
                    // so all of them must have landed in the window.
                    Some(k) => {
                        let remaining = total_payments.saturating_sub(*k) as usize;
                        (remaining > 0 && mine.len() == remaining).then_some(last_event.date)
                    }
                    None => nth_shifted(item, *total_payments, holidays),
                };
                (final_date, last_event.centavos.abs())
            }
            ItemKind::Paluwagan { members, .. } => {
                // The payout event is (members - 1) shares, so take the share
                // from a normal payment, or divide the payout if that is all
                // there is in the window.
                let others = i64::from(members.saturating_sub(1)).max(1);
                let unit = mine
                    .iter()
                    .find(|e| e.centavos < 0)
                    .map(|e| -e.centavos)
                    .or_else(|| mine.first().map(|e| e.centavos / others))
                    .unwrap_or(0);
                (nth_shifted(item, *members, holidays), unit)
            }
            _ => continue,
        };

        let Some(last_payment) = final_date else { continue };
        let in_window = last_payment >= start && last_payment < horizon_end;
        if in_window && mine.iter().any(|e| e.date == last_payment) {
            out.push(FinishLine {
                item_id: item.id.clone(),
                name: item.name.clone(),
                last_payment,
                frees_per_month_centavos: monthly_equivalent(unit, &item.schedule.every),
            });
        }
    }
    out.sort_by_key(|f| f.last_payment);
    out
}

/// The shifted date of the schedule's `n`-th occurrence (1-based), if any.
fn nth_shifted(item: &Item, n: u32, holidays: &HolidaySet) -> Option<NaiveDate> {
    let nth = (n as usize).checked_sub(1)?;
    schedule::dates(&item.schedule)
        .nth(nth)
        .map(|d| holidays.shift(d, item.business_day))
}

/// A payment's monthly equivalent in centavos: Monthly x1, Kinsenas x2,
/// Weekly x52/12, EveryTwoWeeks x26/12, Yearly x1/12 (rounded half away from
/// zero). A one-time payment counts as one month's worth.
fn monthly_equivalent(unit: i64, every: &Cadence) -> i64 {
    let unit = Decimal::from(unit);
    let twelve = Decimal::from(12);
    let monthly = match every {
        Cadence::Once | Cadence::Monthly { .. } => unit,
        Cadence::Kinsenas { .. } => unit * Decimal::from(2),
        Cadence::Weekly => unit * Decimal::from(52) / twelve,
        Cadence::EveryTwoWeeks => unit * Decimal::from(26) / twelve,
        Cadence::Yearly { .. } => unit / twelve,
    };
    monthly
        .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
        .to_i64()
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BusinessDayRule, Direction, Settings};
    use rust_decimal_macros::dec;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn bill(id: &str, amount: Decimal, kind: ItemKind, start: NaiveDate, every: Cadence) -> Item {
        Item {
            id: id.into(),
            name: id.into(),
            kind,
            amount,
            currency: "PHP".into(),
            schedule: Schedule { start, end: None, every },
            business_day: BusinessDayRule::None,
            included: true,
            paid_from: None,
        }
    }

    /// Balance 1000 as of 2027-01-01, 12 months, buffer 500, one 300 bill on
    /// the 10th of each month starting 2027-01-10, no holidays.
    fn base() -> Input {
        Input {
            today: d(2027, 1, 1),
            settings: Settings {
                balance: dec!(1000),
                balance_as_of: d(2027, 1, 1),
                safety_buffer: dec!(500),
                horizon_months: 12,
                card_fx_fee_pct: dec!(0),
                paid_on_as_of: vec![],
            },
            items: vec![bill("b", dec!(300), ItemKind::Bill, d(2027, 1, 10), Cadence::Monthly { day: 10 })],
            holidays: vec![],
            fx: vec![],
        }
    }

    #[test]
    fn daily_series_length_and_values() {
        let p = project(&base()).unwrap();
        assert_eq!(p.days.len(), 365);
        assert_eq!(p.days[8], 100000);
        assert_eq!(p.days[9], 70000);
    }

    #[test]
    fn low_points() {
        let p = project(&base()).unwrap();
        assert_eq!(p.first_below_buffer, Some(d(2027, 2, 10)));
        assert_eq!(p.first_below_zero, Some(d(2027, 4, 10)));
        let g = p.gipit.unwrap();
        assert_eq!(g.date, d(2027, 12, 10));
        assert_eq!(g.centavos, -260000);
        assert_eq!(g.causes, vec!["b".to_string()]);
    }

    #[test]
    fn month_ends_are_last_day_balances() {
        let p = project(&base()).unwrap();
        assert_eq!(p.month_ends.len(), 12);
        assert_eq!(p.month_ends[0], MonthEnd { month: "2027-01".into(), centavos: 70000 });
    }

    #[test]
    fn excluded_item_feeds_only_what_if() {
        let mut input = base();
        let mut once = bill(
            "gift",
            dec!(5000),
            ItemKind::OneOff { direction: Direction::Out },
            d(2027, 3, 1),
            Cadence::Once,
        );
        once.included = false;
        input.items.push(once);
        let p = project(&base()).unwrap();
        let q = project(&input).unwrap();
        assert_eq!(q.days, p.days);
        assert_eq!(q.what_if_days.as_ref().unwrap()[59], q.days[59] - 500000);
        assert!(q.events.iter().any(|e| e.item_id == "gift" && !e.included));
        assert!(p.what_if_days.is_none());
    }

    #[test]
    fn expected_today_inside_and_outside() {
        let mut input = base();
        input.today = d(2027, 1, 15);
        assert_eq!(project(&input).unwrap().expected_today, Some(70000));
        input.today = d(2028, 2, 1);
        assert_eq!(project(&input).unwrap().expected_today, None);
        input.today = d(2026, 12, 1);
        assert_eq!(project(&input).unwrap().expected_today, None);
    }

    #[test]
    fn empty_items_is_flat() {
        let mut input = base();
        input.items.clear();
        let p = project(&input).unwrap();
        assert!(p.days.iter().all(|&c| c == 100000));
        let g = p.gipit.unwrap();
        assert_eq!((g.date, g.centavos), (d(2027, 1, 1), 100000));
        assert!(g.causes.is_empty());
        assert!(p.finish_lines.is_empty());
    }

    #[test]
    fn fallback_cutoffs_without_main_sweldo() {
        let p = project(&base()).unwrap();
        assert_eq!(p.cutoffs[0].payday, d(2027, 1, 1));
        assert_eq!(p.cutoffs[1].payday, d(2027, 1, 15));
        assert_eq!(p.cutoffs[2].payday, d(2027, 1, 31));
    }

    #[test]
    fn finish_line_frees_monthly_amount() {
        let mut input = base();
        input.items = vec![bill(
            "phone",
            dec!(2083),
            ItemKind::Installment { total_payments: 3, paid_override: None },
            d(2027, 1, 15),
            Cadence::Monthly { day: 15 },
        )];
        let p = project(&input).unwrap();
        assert_eq!(p.finish_lines.len(), 1);
        assert_eq!(p.finish_lines[0].last_payment, d(2027, 3, 15));
        assert_eq!(p.finish_lines[0].frees_per_month_centavos, 208300);
    }

    #[test]
    fn monthly_equivalents() {
        assert_eq!(monthly_equivalent(1000, &Cadence::Kinsenas { second: KinsenasSecond::LastDay }), 2000);
        assert_eq!(monthly_equivalent(1000, &Cadence::Weekly), 4333);
        assert_eq!(monthly_equivalent(1000, &Cadence::EveryTwoWeeks), 2167);
        assert_eq!(monthly_equivalent(1000, &Cadence::Yearly { month: 1, day: 1 }), 83);
    }

    #[test]
    fn gipit_causes_are_top_outflows_in_cutoff() {
        let mut input = base();
        input.items = ["a", "b", "c", "e"]
            .iter()
            .enumerate()
            .map(|(i, id)| {
                bill(id, Decimal::from(100 * (i as i64 + 1)), ItemKind::Bill, d(2027, 1, 5), Cadence::Once)
            })
            .collect();
        let p = project(&input).unwrap();
        assert_eq!(p.gipit.unwrap().causes, vec!["e", "c", "b"]);
    }
}
