//! The JSON contract between the web app and the engine.
//!
//! Everything here is plain data: the web side sends an [`Input`] (as JSON) and
//! gets a [`Projection`] back. Conventions used throughout:
//!
//! * Struct fields are `snake_case` in Rust and `camelCase` on the wire
//!   (`#[serde(rename_all = "camelCase")]`).
//! * Enums with data use an internal tag: `{"type": "monthly", "day": 15}`.
//!   `rename_all_fields` makes the fields inside those variants camelCase too.
//! * Unknown JSON fields are ignored (serde's default), so the web can keep
//!   extras such as `updatedAt` next to the fields the engine reads.
//! * Money inputs are `Decimal` serialized as strings (`"2083.33"`); outputs
//!   are integer centavos (`i64`), where positive means money in and negative
//!   means money out.

use std::fmt;

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::money::Money;

/// Everything the engine needs to build a forecast. "Today" is passed in
/// (the engine never reads a clock) so results are reproducible.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Input {
    pub today: NaiveDate,
    pub settings: Settings,
    pub items: Vec<Item>,
    /// Non-working weekdays (public holidays); used by business-day shifting.
    pub holidays: Vec<NaiveDate>,
    /// Cached exchange rates for any non-PHP items.
    pub fx: Vec<FxRate>,
}

/// User-level settings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Cash on hand as of `balance_as_of`.
    pub balance: Money,
    /// The balance includes everything dated before this day.
    pub balance_as_of: NaiveDate,
    /// The cushion the user wants to stay above.
    pub safety_buffer: Money,
    pub horizon_months: u32,
    /// Card foreign-exchange fee as a percentage (3 means 3%).
    pub card_fx_fee_pct: Money,
    /// Ids of items already paid on the `balance_as_of` day itself, so they are
    /// not counted again as upcoming.
    pub paid_on_as_of: Vec<String>,
}

/// A foreign currency's exchange rate into pesos.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxRate {
    pub currency: String,
    pub php_per_unit: Money,
    pub as_of: NaiveDate,
}

/// One income, bill, installment, paluwagan or one-off entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub name: String,
    pub kind: ItemKind,
    pub amount: Money,
    pub currency: String,
    pub schedule: Schedule,
    pub business_day: BusinessDayRule,
    /// `false` means "what-if": shown in the what-if line, not the main one.
    pub included: bool,
    /// Optional label of the account/wallet it is paid from (display only).
    pub paid_from: Option<String>,
}

/// What an item is, plus any data specific to that kind.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ItemKind {
    /// Money coming in. `main_sweldo` marks the salary that defines cutoffs.
    Income { main_sweldo: bool },
    Bill,
    /// A fixed number of payments; `paid_override` lets the user correct the
    /// count of payments already made.
    Installment { total_payments: u32, paid_override: Option<u32> },
    /// A rotating savings group: pay every cycle, collect once on `my_turn`.
    Paluwagan { members: u32, my_turn: u32 },
    OneOff { direction: Direction },
}

/// Whether a one-off moves money in or out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    In,
    Out,
}

/// How to move a date that lands on a weekend or holiday.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BusinessDayRule {
    None,
    Previous,
    Next,
}

/// When an item happens: a first date, an optional last date, and a cadence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub start: NaiveDate,
    pub end: Option<NaiveDate>,
    pub every: Cadence,
}

/// How often a schedule repeats.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Cadence {
    Once,
    Weekly,
    EveryTwoWeeks,
    /// The 15th plus either the 30th or the last day of the month.
    Kinsenas { second: KinsenasSecond },
    Monthly { day: u32 },
    Yearly { month: u32, day: u32 },
}

/// Which day is the second kinsenas payday.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KinsenasSecond {
    Thirtieth,
    LastDay,
}

/// One dated money movement in the forecast.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// The date it actually happens (after any business-day shift).
    pub date: NaiveDate,
    /// The date before shifting.
    pub nominal_date: NaiveDate,
    pub item_id: String,
    pub name: String,
    /// Signed centavos: positive in, negative out.
    pub centavos: i64,
    pub note: Option<String>,
    pub included: bool,
}

/// The lowest point of the balance ("gipit"), and which items caused it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LowPoint {
    pub date: NaiveDate,
    pub centavos: i64,
    /// Item ids.
    pub causes: Vec<String>,
}

/// One pay period: from a payday up to the next, with totals.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cutoff {
    pub payday: NaiveDate,
    pub nominal: NaiveDate,
    pub end: NaiveDate,
    pub income_centavos: i64,
    pub outflow_centavos: i64,
    pub left_centavos: i64,
    /// Indices into [`Projection::events`].
    pub event_indices: Vec<usize>,
}

/// When an installment ends and how much monthly cash that frees up.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinishLine {
    pub item_id: String,
    pub name: String,
    pub last_payment: NaiveDate,
    pub frees_per_month_centavos: i64,
}

/// Projected balance at the end of a month.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthEnd {
    /// `"YYYY-MM"`, e.g. `"2027-02"`.
    pub month: String,
    pub centavos: i64,
}

/// The engine's full output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Projection {
    /// Date of `days[0]`.
    pub start: NaiveDate,
    /// End-of-day balance in centavos, one entry per day from `start`.
    pub days: Vec<i64>,
    pub events: Vec<Event>,
    /// Same as `days` but including what-if items; `None` if there are none.
    pub what_if_days: Option<Vec<i64>>,
    pub gipit: Option<LowPoint>,
    pub first_below_buffer: Option<NaiveDate>,
    pub first_below_zero: Option<NaiveDate>,
    pub cutoffs: Vec<Cutoff>,
    pub finish_lines: Vec<FinishLine>,
    pub month_ends: Vec<MonthEnd>,
    /// Expected balance today; `None` when today is outside the horizon.
    pub expected_today: Option<i64>,
}

/// Everything that can go wrong inside the engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
// Externally tagged (serde's default) because an internal tag cannot wrap the
// plain-string payloads of `MissingFxRate` and `Backup`.
#[serde(rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EngineError {
    /// A foreign-currency item has no exchange rate (holds the currency code).
    MissingFxRate(String),
    InvalidItem { id: String, reason: String },
    /// A backup file could not be read or decrypted.
    Backup(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::MissingFxRate(cur) => write!(f, "missing exchange rate for {cur}"),
            EngineError::InvalidItem { id, reason } => write!(f, "invalid item {id}: {reason}"),
            EngineError::Backup(msg) => write!(f, "backup error: {msg}"),
        }
    }
}

impl std::error::Error for EngineError {}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn deserializes_web_json() {
        // Note the extra "updatedAt" field: the web stores it, the engine must ignore it.
        let json = r#"{"id":"hc","name":"Home Credit","kind":{"type":"installment","totalPayments":12,"paidOverride":null},
 "amount":"2083","currency":"PHP","businessDay":"none","included":true,"paidFrom":"GCash","updatedAt":123,
 "schedule":{"start":"2026-09-15","end":null,"every":{"type":"monthly","day":15}}}"#;
        let item: Item = serde_json::from_str(json).unwrap();
        assert_eq!(
            item.kind,
            ItemKind::Installment { total_payments: 12, paid_override: None }
        );
        assert_eq!(item.amount, dec!(2083));
        assert_eq!(item.schedule.every, Cadence::Monthly { day: 15 });
    }
}
