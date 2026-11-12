//! Expands an [`Item`] (a rule such as "monthly on the 15th") into the dated
//! [`Event`]s that fall inside the forecast window.

use std::collections::HashSet;

use chrono::{Duration, NaiveDate};
use rust_decimal::Decimal;

use crate::calendar::HolidaySet;
use crate::model::{Direction, EngineError, Event, FxRate, Item, ItemKind};
use crate::money::{convert_to_php, to_centavos};
use crate::schedule;

/// Everything `expand` needs besides the item itself.
pub struct Ctx<'a> {
    /// The day the balance was taken ("today" for the forecast).
    pub as_of: NaiveDate,
    /// First day NOT in the forecast (exclusive upper bound).
    pub horizon_end: NaiveDate,
    pub holidays: &'a HolidaySet,
    pub fx: &'a [FxRate],
    /// Card foreign-exchange fee percentage (3 means 3%).
    pub fee_pct: Decimal,
    /// Item ids already paid on `as_of` itself.
    pub paid_on_as_of: &'a HashSet<String>,
}

/// How far past `horizon_end` we keep looking at nominal dates, because a
/// `Previous` business-day shift can pull a later nominal date back inside the
/// window. A month is far more than any realistic run of holidays.
const LOOKAHEAD_DAYS: i64 = 31;

/// One scheduled occurrence: where it nominally falls and where it lands
/// after the business-day shift.
struct Occurrence {
    /// 1-based position within the schedule (1 = the schedule's first date).
    position: u32,
    nominal: NaiveDate,
    date: NaiveDate,
}

/// The unsigned size of one payment in centavos, converted to pesos when the
/// item is in a foreign currency. Errors if the currency has no rate.
fn unit_centavos(item: &Item, ctx: &Ctx) -> Result<i64, EngineError> {
    let pesos = if item.currency.eq_ignore_ascii_case("PHP") {
        item.amount
    } else {
        let rate = ctx
            .fx
            .iter()
            .find(|r| r.currency.eq_ignore_ascii_case(&item.currency))
            .ok_or_else(|| EngineError::MissingFxRate(item.currency.clone()))?;
        convert_to_php(item.amount, rate.php_per_unit, ctx.fee_pct)
    };
    Ok(to_centavos(pesos))
}

/// "moved from Sun Nov 15" (English short day and month, no zero padding).
fn moved_note(nominal: NaiveDate) -> String {
    format!("moved from {}", nominal.format("%a %b %-d"))
}

/// Expands one item into the events that fall inside the forecast window.
///
/// An occurrence counts when its *shifted* date `d` satisfies
/// `as_of < d < horizon_end`, or `d == as_of` and the item was not already
/// paid on `as_of` (`ctx.paid_on_as_of`).
pub fn expand(item: &Item, ctx: &Ctx) -> Result<Vec<Event>, EngineError> {
    let in_forecast = |d: NaiveDate| {
        (d > ctx.as_of && d < ctx.horizon_end)
            || (d == ctx.as_of && !ctx.paid_on_as_of.contains(&item.id))
    };

    // How many schedule dates belong to the item at all (None = unlimited).
    // An installment with `paid_override` is NOT capped: the override is the
    // user's correction for a stale start date, so we simply take the next
    // `total - k` in-forecast dates instead.
    let limit = match &item.kind {
        ItemKind::Installment { total_payments, paid_override: None } => {
            Some(*total_payments as usize)
        }
        ItemKind::Paluwagan { members, .. } => Some(*members as usize),
        _ => None,
    };

    let nominal_limit = ctx.horizon_end + Duration::days(LOOKAHEAD_DAYS);
    let occurrences = schedule::dates(&item.schedule)
        .take(limit.unwrap_or(usize::MAX))
        .take_while(|n| limit.is_some() || *n <= nominal_limit)
        .enumerate()
        .map(|(i, nominal)| Occurrence {
            position: i as u32 + 1,
            nominal,
            date: ctx.holidays.shift(nominal, item.business_day),
        });

    // Step 1: decide which occurrences are in the forecast, each with a
    // multiplier (applied to the payment size) and a base note.
    let mut pending: Vec<(Occurrence, i64, String)> = Vec::new();
    let mut none_note = false;
    match &item.kind {
        ItemKind::Installment { total_payments, paid_override } => {
            let upcoming = occurrences.filter(|o| in_forecast(o.date));
            match paid_override {
                // k payments already made: take exactly the remaining ones
                // and number them from k + 1.
                Some(k) => {
                    let remaining = total_payments.saturating_sub(*k) as usize;
                    for (j, o) in upcoming.take(remaining).enumerate() {
                        let note = format!("{} of {}", k + 1 + j as u32, total_payments);
                        pending.push((o, -1, note));
                    }
                }
                // Otherwise number by position in the schedule.
                None => {
                    for o in upcoming {
                        let note = format!("{} of {}", o.position, total_payments);
                        pending.push((o, -1, note));
                    }
                }
            }
        }
        ItemKind::Paluwagan { members, my_turn } => {
            for o in occurrences.filter(|o| in_forecast(o.date)) {
                if o.position == *my_turn {
                    // Everyone else pays in; we collect (members - 1) shares.
                    let others = i64::from(members.saturating_sub(1));
                    pending.push((o, others, "payout".to_string()));
                } else {
                    let note = format!("turn {} of {}", o.position, members);
                    pending.push((o, -1, note));
                }
            }
        }
        kind => {
            none_note = true;
            let sign = match kind {
                ItemKind::Income { .. } | ItemKind::OneOff { direction: Direction::In } => 1,
                _ => -1, // Bill and OneOff out
            };
            for o in occurrences.filter(|o| in_forecast(o.date)) {
                pending.push((o, sign, String::new()));
            }
        }
    }

    // Nothing in the window: no event, and no need for an exchange rate.
    if pending.is_empty() {
        return Ok(Vec::new());
    }

    // Step 2: price the payment (needs an FX rate only now) and build events.
    let unit = unit_centavos(item, ctx)?;
    Ok(pending
        .into_iter()
        .map(|(o, factor, text)| {
            let base = if none_note { None } else { Some(text) };
            // Add the "moved from" note when the business-day rule shifted it.
            let note = match (base, o.date != o.nominal) {
                (Some(n), true) => Some(format!("{n} \u{b7} {}", moved_note(o.nominal))),
                (None, true) => Some(moved_note(o.nominal)),
                (n, false) => n,
            };
            Event {
                date: o.date,
                nominal_date: o.nominal,
                item_id: item.id.clone(),
                name: item.name.clone(),
                centavos: unit.saturating_mul(factor),
                note,
                included: item.included,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BusinessDayRule, Cadence, ItemKind, KinsenasSecond, Schedule};
    use rust_decimal_macros::dec;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    fn item(id: &str, kind: ItemKind, amount: Decimal, currency: &str, start: NaiveDate, every: Cadence, rule: BusinessDayRule) -> Item {
        Item {
            id: id.into(),
            name: id.into(),
            kind,
            amount,
            currency: currency.into(),
            schedule: Schedule { start, end: None, every },
            business_day: rule,
            included: true,
            paid_from: None,
        }
    }

    /// Runs `expand` with the shared context: as_of 2026-11-13, horizon_end
    /// 2027-11-13, holidays {Nov 30, Dec 25}, USD = 63.727.
    fn run(it: &Item, paid: &[&str]) -> Result<Vec<Event>, EngineError> {
        let holidays = HolidaySet::new(&[d(2026, 11, 30), d(2026, 12, 25)]);
        let fx = [FxRate { currency: "USD".into(), php_per_unit: dec!(63.727), as_of: d(2026, 11, 13) }];
        let paid_set: HashSet<String> = paid.iter().map(|s| s.to_string()).collect();
        let ctx = Ctx {
            as_of: d(2026, 11, 13),
            horizon_end: d(2027, 11, 13),
            holidays: &holidays,
            fx: &fx,
            fee_pct: dec!(0),
            paid_on_as_of: &paid_set,
        };
        expand(it, &ctx)
    }

    fn note(e: &Event) -> &str {
        e.note.as_deref().unwrap()
    }

    #[test]
    fn installment_counts_from_start() {
        let it = item(
            "hc",
            ItemKind::Installment { total_payments: 12, paid_override: None },
            dec!(2083), "PHP", d(2026, 9, 15), Cadence::Monthly { day: 15 }, BusinessDayRule::None,
        );
        let ev = run(&it, &[]).unwrap();
        assert_eq!(ev.len(), 10);
        assert_eq!(ev[0].date, d(2026, 11, 15));
        assert_eq!(note(&ev[0]), "3 of 12");
        assert_eq!(ev[9].date, d(2027, 8, 15));
        assert_eq!(note(&ev[9]), "12 of 12");
        assert!(ev.iter().all(|e| e.centavos == -208300));
    }

    #[test]
    fn installment_paid_override() {
        let it = item(
            "hc",
            ItemKind::Installment { total_payments: 12, paid_override: Some(10) },
            dec!(2083), "PHP", d(2026, 9, 15), Cadence::Monthly { day: 15 }, BusinessDayRule::None,
        );
        let ev = run(&it, &[]).unwrap();
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0].date, d(2026, 11, 15));
        assert_eq!(note(&ev[0]), "11 of 12");
        assert_eq!(note(&ev[1]), "12 of 12");
    }

    #[test]
    fn as_of_tick_removes_todays_occurrence() {
        let it = item(
            "spay",
            ItemKind::Installment { total_payments: 6, paid_override: None },
            dec!(1250), "PHP", d(2026, 10, 13), Cadence::Monthly { day: 13 }, BusinessDayRule::None,
        );
        let ev = run(&it, &[]).unwrap();
        assert_eq!(ev[0].date, d(2026, 11, 13));
        assert_eq!(note(&ev[0]), "2 of 6");
        let ev = run(&it, &["spay"]).unwrap();
        assert_eq!(ev.len(), 4);
        assert_eq!(ev[0].date, d(2026, 12, 13));
        assert_eq!(note(&ev[0]), "3 of 6");
    }

    #[test]
    fn paluwagan_payout_on_my_turn() {
        let it = item(
            "pal",
            ItemKind::Paluwagan { members: 10, my_turn: 10 },
            dec!(2000), "PHP", d(2026, 8, 15), Cadence::Monthly { day: 15 }, BusinessDayRule::None,
        );
        let ev = run(&it, &[]).unwrap();
        assert_eq!(ev.len(), 7);
        assert_eq!(note(&ev[0]), "turn 4 of 10");
        let last = &ev[6];
        assert_eq!(last.date, d(2027, 5, 15));
        assert_eq!(last.centavos, 1_800_000);
        assert_eq!(note(last), "payout");
        assert!(ev[..6].iter().all(|e| e.centavos == -200_000));
    }

    #[test]
    fn usd_item_converted() {
        let it = item(
            "gpt", ItemKind::Bill, dec!(20), "USD", d(2026, 11, 22), Cadence::Monthly { day: 22 }, BusinessDayRule::None,
        );
        let ev = run(&it, &[]).unwrap();
        assert!(!ev.is_empty());
        assert!(ev.iter().all(|e| e.centavos == -127454));
    }

    #[test]
    fn missing_rate_errors() {
        let it = item(
            "sg", ItemKind::Bill, dec!(10), "SGD", d(2026, 11, 22), Cadence::Monthly { day: 22 }, BusinessDayRule::None,
        );
        assert_eq!(run(&it, &[]), Err(EngineError::MissingFxRate("SGD".into())));
    }

    #[test]
    fn sweldo_shifts_to_previous_working_day() {
        let it = item(
            "sweldo",
            ItemKind::Income { main_sweldo: true },
            dec!(18000), "PHP", d(2026, 11, 1),
            Cadence::Kinsenas { second: KinsenasSecond::Thirtieth },
            BusinessDayRule::Previous,
        );
        let ev = run(&it, &[]).unwrap();
        assert_eq!(ev[0].date, d(2026, 11, 13));
        assert_eq!(ev[0].nominal_date, d(2026, 11, 15));
        assert!(note(&ev[0]).contains("moved from Sun Nov 15"));
        assert_eq!(ev[1].date, d(2026, 11, 27));
        assert!(note(&ev[1]).contains("moved from Mon Nov 30"));
        assert_eq!(ev[0].centavos, 1_800_000);
    }

    #[test]
    fn installment_paid_override_with_old_start() {
        let it = item(
            "hc",
            ItemKind::Installment { total_payments: 12, paid_override: Some(3) },
            dec!(2083), "PHP", d(2026, 1, 15), Cadence::Monthly { day: 15 }, BusinessDayRule::None,
        );
        let ev = run(&it, &[]).unwrap();
        assert_eq!(ev.len(), 9);
        assert_eq!(note(&ev[0]), "4 of 12");
        assert_eq!(note(&ev[8]), "12 of 12");
    }

    #[test]
    fn lowercase_php_needs_no_rate() {
        let it = item(
            "b", ItemKind::Bill, dec!(100), "php", d(2026, 11, 20), Cadence::Once, BusinessDayRule::None,
        );
        let ev = run(&it, &[]).unwrap();
        assert_eq!(ev[0].centavos, -10000);
    }

    #[test]
    fn missing_rate_ignored_when_no_occurrences_in_window() {
        let it = item(
            "sg", ItemKind::Bill, dec!(10), "SGD", d(2026, 1, 1), Cadence::Once, BusinessDayRule::None,
        );
        assert_eq!(run(&it, &[]), Ok(Vec::new()));
    }
}
