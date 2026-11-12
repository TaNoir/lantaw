//! "Kaya ba?" (can I afford it?): compares ways of paying for a purchase
//! against the baseline forecast, and finds the best date to pay cash.
//!
//! Each pay option is simulated by adding temporary one-off outflow items on
//! top of the user's included items and re-running [`project`]. The user's
//! real items are never touched.

use chrono::{Datelike, Duration, Months, NaiveDate};
use rust_decimal::Decimal;
use rust_decimal::RoundingStrategy;
use serde::{Deserialize, Serialize};

use crate::model::{
    BusinessDayRule, Cadence, Direction, EngineError, Input, Item, ItemKind, LowPoint, Projection,
    Schedule,
};
use crate::money::{to_centavos, Money};
use crate::project::project;

/// Something the user wants to buy, and the ways they could pay for it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Purchase {
    pub name: String,
    pub price: Money,
    /// The day the purchase happens (cash paid, or the anchor for installments).
    pub date: NaiveDate,
    pub options: Vec<PayOption>,
}

/// One way to pay.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PayOption {
    Cash,
    /// `months` equal payments. `monthly: None` means 0% interest
    /// (price / months); `Some(x)` is the quoted monthly amount.
    Installment { months: u32, monthly: Option<Money> },
}

/// The answer for one option.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    /// Never dips below the safety buffer.
    Kaya,
    /// Dips below the buffer, but spends at most 30 days below zero.
    Gipit,
    /// More than 30 days below zero.
    HindiKaya,
}

/// What happens to the balance if the user picks this option.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionResult {
    pub label: String,
    pub option: PayOption,
    pub verdict: Verdict,
    /// Lowest balance from the purchase date onwards.
    pub lowest: LowPoint,
    pub days_below_buffer: u32,
    pub days_below_zero: u32,
    pub total_paid_centavos: i64,
    /// Total paid minus the price (interest/fees); 0 for cash or 0% plans.
    pub add_on_centavos: i64,
    /// The regular monthly payment (installments only).
    pub monthly_centavos: Option<i64>,
}

/// The earliest date a cash purchase keeps the balance above the buffer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BestDate {
    pub date: NaiveDate,
    /// e.g. "right after your Sweldo"; `None` when it is the purchase date.
    pub reason: Option<String>,
    pub lowest_after: LowPoint,
}

/// The full comparison.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub best_cash_date: Option<BestDate>,
    /// Sorted best first: highest low point, then lowest total paid.
    pub options: Vec<OptionResult>,
}

/// Compares every option in `p` against the baseline forecast of `input`.
pub fn compare_purchase(input: &Input, p: &Purchase) -> Result<Comparison, EngineError> {
    let price_c = to_centavos(p.price);
    let buffer_c = to_centavos(input.settings.safety_buffer);

    let mut options = Vec::with_capacity(p.options.len());
    for opt in &p.options {
        // Payment schedule for this option: (date, centavos) pairs.
        let (payments, monthly_c) = payment_plan(opt, p, price_c)?;
        let total: i64 = payments.iter().map(|&(_, c)| c).sum();
        let add_on = total - price_c;

        let proj = simulate(input, &p.name, &payments)?;
        let (lowest, below_buffer, below_zero) = summarize(&proj, p.date, buffer_c)?;

        let verdict = if below_buffer == 0 {
            Verdict::Kaya
        } else if below_zero > 30 {
            Verdict::HindiKaya
        } else {
            Verdict::Gipit
        };

        let label = match (opt, monthly_c) {
            (PayOption::Installment { months, .. }, Some(m)) => {
                if add_on == 0 {
                    format!("{months} × {}", peso(m))
                } else {
                    let sign = if add_on > 0 { "+" } else { "−" };
                    format!("{months} × {} ({sign}{})", peso(m), peso(add_on.abs()))
                }
            }
            _ => format!("Cash on {}", short_date(p.date)),
        };

        options.push(OptionResult {
            label,
            option: opt.clone(),
            verdict,
            lowest,
            days_below_buffer: below_buffer,
            days_below_zero: below_zero,
            total_paid_centavos: total,
            add_on_centavos: add_on,
            monthly_centavos: monthly_c,
        });
    }

    // Stable sort: ties keep the user's option order.
    options.sort_by(|a, b| {
        b.lowest
            .centavos
            .cmp(&a.lowest.centavos)
            .then(a.total_paid_centavos.cmp(&b.total_paid_centavos))
    });

    Ok(Comparison { best_cash_date: best_cash_date(input, p, price_c, buffer_c)?, options })
}

/// Turns a pay option into dated payments (centavos, positive) and, for
/// installments, the regular monthly amount.
///
/// Payments fall one month after the purchase date, two months after, and so
/// on, always counted from the purchase date (Jan 31 gives Feb 28, then
/// Mar 31: the same anchored rule as a Monthly schedule). With no quoted
/// monthly amount the price is split evenly and the LAST payment absorbs the
/// rounding remainder, so the total equals the price exactly.
fn payment_plan(
    opt: &PayOption,
    p: &Purchase,
    price_c: i64,
) -> Result<(Vec<(NaiveDate, i64)>, Option<i64>), EngineError> {
    match opt {
        PayOption::Cash => Ok((vec![(p.date, price_c)], None)),
        PayOption::Installment { months, monthly } => {
            if *months == 0 {
                return Err(EngineError::InvalidItem {
                    id: p.name.clone(),
                    reason: "installment needs at least 1 month".into(),
                });
            }
            let n = i64::from(*months);
            let monthly_c = match monthly {
                Some(m) => to_centavos(*m),
                // price_c / n, rounded half away from zero, to whole centavos.
                None => (Decimal::from(price_c) / Decimal::from(n))
                    .round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero)
                    .try_into()
                    .map_err(|_| EngineError::InvalidItem {
                        id: p.name.clone(),
                        reason: "price is out of range".into(),
                    })?,
            };
            let mut payments = Vec::new();
            for k in 1..=*months {
                let date = p.date.checked_add_months(Months::new(k)).ok_or_else(|| {
                    EngineError::InvalidItem {
                        id: p.name.clone(),
                        reason: "installment date is out of range".into(),
                    }
                })?;
                // The last payment of a plan with no quoted monthly covers the rest.
                let amount = if monthly.is_none() && k == *months {
                    price_c - monthly_c * (n - 1)
                } else {
                    monthly_c
                };
                payments.push((date, amount));
            }
            Ok((payments, Some(monthly_c)))
        }
    }
}

/// Runs the baseline plus temporary one-off outflows for `payments`.
fn simulate(
    input: &Input,
    name: &str,
    payments: &[(NaiveDate, i64)],
) -> Result<Projection, EngineError> {
    let mut with = input.clone();
    for (i, &(date, c)) in payments.iter().enumerate() {
        with.items.push(temp_item(format!("__kaya_{i}"), name, c, date));
    }
    project(&with)
}

/// A temporary included one-off outflow of `centavos` on `date`.
fn temp_item(id: String, name: &str, centavos: i64, date: NaiveDate) -> Item {
    Item {
        id,
        name: name.to_string(),
        kind: ItemKind::OneOff { direction: Direction::Out },
        amount: Decimal::new(centavos, 2),
        currency: "PHP".into(),
        schedule: Schedule { start: date, end: None, every: Cadence::Once },
        business_day: BusinessDayRule::None,
        included: true,
        paid_from: None,
    }
}

/// Lowest point and the counts of days below buffer / below zero, all taken
/// over the days from `from` onwards.
fn summarize(
    proj: &Projection,
    from: NaiveDate,
    buffer_c: i64,
) -> Result<(LowPoint, u32, u32), EngineError> {
    let idx = window_index(proj.start, proj.days.len(), from)?;
    let window = &proj.days[idx..];
    // `min_by_key` keeps the first of equal minimums (the earliest day).
    let (off, &low) = window
        .iter()
        .enumerate()
        .min_by_key(|&(_, &c)| c)
        .expect("window is non-empty");
    let date = from.max(proj.start) + Duration::days(off as i64);
    // Reuse the projection's causes only when its overall low is that same day.
    let causes = match &proj.gipit {
        Some(g) if g.date == date => g.causes.clone(),
        _ => Vec::new(),
    };
    let below_buffer = window.iter().filter(|&&c| c < buffer_c).count() as u32;
    let below_zero = window.iter().filter(|&&c| c < 0).count() as u32;
    Ok((LowPoint { date, centavos: low, causes }, below_buffer, below_zero))
}

/// Index of `from` in the daily series (clamped to the start); an error if it
/// is past the horizon.
fn window_index(start: NaiveDate, len: usize, from: NaiveDate) -> Result<usize, EngineError> {
    let idx = (from - start).num_days().max(0) as usize;
    if idx >= len {
        return Err(EngineError::InvalidItem {
            id: "purchase".into(),
            reason: "purchase date is past the forecast horizon".into(),
        });
    }
    Ok(idx)
}

/// The first day D (from the purchase date) where paying cash keeps
/// `min(days[D..]) - price >= buffer`, or `None` if no day works.
fn best_cash_date(
    input: &Input,
    p: &Purchase,
    price_c: i64,
    buffer_c: i64,
) -> Result<Option<BestDate>, EngineError> {
    let base = project(input)?;
    let first = window_index(base.start, base.days.len(), p.date)?;

    // suffix_min[i] = min(days[i..]), built from the end.
    let mut suffix_min = base.days.clone();
    for i in (0..suffix_min.len().saturating_sub(1)).rev() {
        suffix_min[i] = suffix_min[i].min(suffix_min[i + 1]);
    }

    let Some(i) = (first..suffix_min.len()).find(|&i| suffix_min[i] - price_c >= buffer_c) else {
        return Ok(None);
    };
    let date = base.start + Duration::days(i as i64);

    // The biggest included inflow in (p.date, D] names the reason; on equal
    // amounts the earlier one wins.
    let reason = if date == p.date {
        None
    } else {
        base.events
            .iter()
            .filter(|e| e.included && e.centavos > 0 && e.date > p.date && e.date <= date)
            .max_by(|a, b| a.centavos.cmp(&b.centavos).then(b.date.cmp(&a.date)))
            .map(|e| format!("right after your {}", e.name))
    };

    let proj = simulate(input, &p.name, &[(date, price_c)])?;
    let (lowest_after, _, _) = summarize(&proj, date, buffer_c)?;
    Ok(Some(BestDate { date, reason, lowest_after }))
}

/// "Feb 1": short month name and day, no zero padding.
fn short_date(d: NaiveDate) -> String {
    format!("{} {}", d.format("%b"), d.day())
}

/// Centavos as pesos: "₱4,000", "₱3,333.33" (centavos only when non-zero).
fn peso(centavos: i64) -> String {
    let abs = centavos.abs();
    let whole = (abs / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in whole.chars().enumerate() {
        // A comma before every group of three digits counted from the right.
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    let sign = if centavos < 0 { "−" } else { "" };
    match abs % 100 {
        0 => format!("{sign}₱{grouped}"),
        c => format!("{sign}₱{grouped}.{c:02}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Settings;
    use rust_decimal_macros::dec;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    /// Balance 10000 as of 2027-01-01, buffer 3000, 12 months, Income
    /// "Sweldo" 5000 monthly on the 1st starting 2027-02-01.
    fn base() -> Input {
        Input {
            today: d(2027, 1, 1),
            settings: Settings {
                balance: dec!(10000),
                balance_as_of: d(2027, 1, 1),
                safety_buffer: dec!(3000),
                horizon_months: 12,
                card_fx_fee_pct: dec!(0),
                paid_on_as_of: vec![],
            },
            items: vec![Item {
                id: "sweldo".into(),
                name: "Sweldo".into(),
                kind: ItemKind::Income { main_sweldo: false },
                amount: dec!(5000),
                currency: "PHP".into(),
                schedule: Schedule {
                    start: d(2027, 2, 1),
                    end: None,
                    every: Cadence::Monthly { day: 1 },
                },
                business_day: BusinessDayRule::None,
                included: true,
                paid_from: None,
            }],
            holidays: vec![],
            fx: vec![],
        }
    }

    fn purchase(price: Decimal, options: Vec<PayOption>) -> Purchase {
        Purchase { name: "Laptop".into(), price, date: d(2027, 1, 1), options }
    }

    #[test]
    fn cash_now_is_hindi_kaya() {
        let c = compare_purchase(&base(), &purchase(dec!(12000), vec![PayOption::Cash])).unwrap();
        let r = &c.options[0];
        assert_eq!(r.lowest.centavos, -200000);
        assert_eq!(r.lowest.date, d(2027, 1, 1));
        assert_eq!(r.days_below_zero, 31);
        assert_eq!(r.verdict, Verdict::HindiKaya);
        assert_eq!(r.label, "Cash on Jan 1");
    }

    #[test]
    fn installment_zero_percent_is_kaya() {
        let opt = PayOption::Installment { months: 3, monthly: None };
        let c = compare_purchase(&base(), &purchase(dec!(12000), vec![opt])).unwrap();
        let r = &c.options[0];
        assert_eq!(r.monthly_centavos, Some(400000));
        assert_eq!(r.total_paid_centavos, 1200000);
        assert_eq!(r.add_on_centavos, 0);
        assert_eq!(r.verdict, Verdict::Kaya);
        assert_eq!(r.label, "3 × ₱4,000");
    }

    #[test]
    fn gipit_between_buffer_and_zero() {
        let c = compare_purchase(&base(), &purchase(dec!(8000), vec![PayOption::Cash])).unwrap();
        let r = &c.options[0];
        assert_eq!(r.lowest.centavos, 200000);
        assert_eq!(r.verdict, Verdict::Gipit);
    }

    #[test]
    fn remainder_on_last_payment() {
        let opt = PayOption::Installment { months: 3, monthly: None };
        let p = purchase(dec!(10000), vec![opt.clone()]);
        let (pay, monthly) = payment_plan(&opt, &p, 1_000_000).unwrap();
        let amounts: Vec<i64> = pay.iter().map(|&(_, c)| c).collect();
        assert_eq!(amounts, vec![333333, 333333, 333334]);
        assert_eq!(monthly, Some(333333));
        assert_eq!(pay[0].0, d(2027, 2, 1));
        let c = compare_purchase(&base(), &p).unwrap();
        assert_eq!(c.options[0].total_paid_centavos, 1_000_000);
        assert_eq!(c.options[0].label, "3 × ₱3,333.33");
    }

    #[test]
    fn add_on_is_reported() {
        let opt = PayOption::Installment { months: 12, monthly: Some(dec!(1100)) };
        let c = compare_purchase(&base(), &purchase(dec!(12000), vec![opt])).unwrap();
        let r = &c.options[0];
        assert_eq!(r.total_paid_centavos, 1320000);
        assert_eq!(r.add_on_centavos, 120000);
        assert_eq!(r.label, "12 × ₱1,100 (+₱1,200)");
    }

    #[test]
    fn best_cash_date_after_sweldo() {
        let c = compare_purchase(&base(), &purchase(dec!(12000), vec![PayOption::Cash])).unwrap();
        let b = c.best_cash_date.unwrap();
        assert_eq!(b.date, d(2027, 2, 1));
        assert_eq!(b.reason.as_deref(), Some("right after your Sweldo"));
        assert_eq!(b.lowest_after.centavos, 300000);
    }

    #[test]
    fn best_cash_date_none_when_never() {
        let c = compare_purchase(&base(), &purchase(dec!(999999), vec![PayOption::Cash])).unwrap();
        assert!(c.best_cash_date.is_none());
    }

    #[test]
    fn sorted_best_first() {
        let opts = vec![PayOption::Cash, PayOption::Installment { months: 3, monthly: None }];
        let c = compare_purchase(&base(), &purchase(dec!(12000), opts)).unwrap();
        assert!(matches!(c.options[0].option, PayOption::Installment { .. }));
    }

    #[test]
    fn serde_shapes() {
        assert_eq!(serde_json::to_string(&Verdict::HindiKaya).unwrap(), "\"hindiKaya\"");
        assert_eq!(serde_json::to_string(&PayOption::Cash).unwrap(), "{\"type\":\"cash\"}");
        let i = PayOption::Installment { months: 3, monthly: None };
        assert_eq!(
            serde_json::to_string(&i).unwrap(),
            "{\"type\":\"installment\",\"months\":3,\"monthly\":null}"
        );
    }

    #[test]
    fn peso_formatting() {
        assert_eq!(peso(400000), "₱4,000");
        assert_eq!(peso(333333), "₱3,333.33");
        assert_eq!(peso(123456700), "₱1,234,567");
    }
}
