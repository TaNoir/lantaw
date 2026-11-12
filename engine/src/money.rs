//! Exact peso arithmetic. Money is `Decimal` (never `f64`) so 0.1 + 0.2 really is 0.3.

use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};

/// The money type used across the engine. An alias keeps signatures readable
/// and gives us one place to change if the representation ever needs to.
pub type Money = Decimal;

/// Converts a peso amount to whole centavos.
///
/// Rounds to 2 decimal places with `MidpointAwayFromZero` (0.005 -> 0.01,
/// -0.005 -> -0.01), the way people expect money to round, then shifts the
/// decimal point two places. Centavos fit comfortably in an `i64`, and they are
/// plain integers when handed to JS.
pub fn to_centavos(d: Decimal) -> i64 {
    let rounded = d.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    (rounded * Decimal::ONE_HUNDRED)
        .to_i64()
        .expect("amount too large to represent in centavos")
}

/// Converts a foreign-currency amount to pesos: `amount x rate x (1 + fee_pct/100)`.
///
/// `fee_pct` is a percentage (3 means 3%), e.g. a card's foreign-exchange fee.
/// The result is deliberately NOT rounded: rounding happens once, at the end,
/// via [`to_centavos`], so intermediate steps never lose precision.
pub fn convert_to_php(amount: Decimal, php_per_unit: Decimal, fee_pct: Decimal) -> Decimal {
    amount * php_per_unit * (Decimal::ONE + fee_pct / Decimal::ONE_HUNDRED)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn parses_and_converts_to_centavos() {
        assert_eq!(to_centavos(dec!(2083.33)), 208333);
    }

    #[test]
    fn rounds_half_away_from_zero() {
        assert_eq!(to_centavos(dec!(0.005)), 1);
        assert_eq!(to_centavos(dec!(-0.005)), -1);
        assert_eq!(to_centavos(dec!(1274.545)), 127455);
    }

    #[test]
    fn converts_usd_without_fee() {
        assert_eq!(to_centavos(convert_to_php(dec!(20), dec!(63.727), dec!(0))), 127454);
    }

    #[test]
    fn converts_usd_with_card_fee() {
        assert_eq!(to_centavos(convert_to_php(dec!(20), dec!(63.727), dec!(3))), 131278);
    }
}
