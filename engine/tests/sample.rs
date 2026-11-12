//! Invariants on the bundled sample budget (also what the web demo loads).

use chrono::NaiveDate;
use lantaw_engine::model::Input;
use lantaw_engine::money::to_centavos;
use lantaw_engine::project::project;

#[test]
fn sample_budget_invariants() {
    let input: Input =
        serde_json::from_str(include_str!("../../web/src/lib/sample/sample-budget.json")).unwrap();
    let p = project(&input).unwrap();

    // The gipit is the minimum of the main series.
    assert_eq!(p.gipit.as_ref().unwrap().centavos, *p.days.iter().min().unwrap());

    // The last day equals the opening balance plus every included event.
    let included: i64 = p.events.iter().filter(|e| e.included).map(|e| e.centavos).sum();
    assert_eq!(*p.days.last().unwrap(), to_centavos(input.settings.balance) + included);

    // BPI laptop is a what-if, so the what-if series exists.
    assert!(p.what_if_days.is_some());

    let hc = p.finish_lines.iter().find(|f| f.item_id == "home-credit-phone").unwrap();
    assert_eq!(hc.last_payment, NaiveDate::from_ymd_opt(2027, 8, 15).unwrap());

    assert_eq!(p.cutoffs[0].payday, NaiveDate::from_ymd_opt(2026, 11, 13).unwrap());
}
