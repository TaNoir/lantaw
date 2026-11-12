// Mirrors engine/src/model.rs and engine/src/compare.rs (camelCase over the wire).
// Money in = decimal strings ("2083.33"); balances out = integer centavos (number).
// Dates are "YYYY-MM-DD".

export type Money = string;
export type IsoDate = string;

export interface Input {
  today: IsoDate;
  settings: Settings;
  items: Item[];
  holidays: IsoDate[];
  fx: FxRate[];
}

export interface Settings {
  balance: Money;
  balanceAsOf: IsoDate;
  safetyBuffer: Money;
  horizonMonths: number;
  cardFxFeePct: Money;
  paidOnAsOf: string[];
}

export interface FxRate {
  currency: string;
  phpPerUnit: Money;
  asOf: IsoDate;
}

export type Direction = 'in' | 'out';
export type BusinessDayRule = 'none' | 'previous' | 'next';
export type KinsenasSecond = 'thirtieth' | 'lastDay';

export type ItemKind =
  | { type: 'income'; mainSweldo: boolean }
  | { type: 'bill' }
  | { type: 'installment'; totalPayments: number; paidOverride: number | null }
  | { type: 'paluwagan'; members: number; myTurn: number }
  | { type: 'oneOff'; direction: Direction };

export type Cadence =
  | { type: 'once' }
  | { type: 'weekly' }
  | { type: 'everyTwoWeeks' }
  | { type: 'kinsenas'; second: KinsenasSecond }
  | { type: 'monthly'; day: number }
  | { type: 'yearly'; month: number; day: number };

export interface Schedule {
  start: IsoDate;
  end: IsoDate | null;
  every: Cadence;
}

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  amount: Money;
  currency: string;
  schedule: Schedule;
  businessDay: BusinessDayRule;
  included: boolean;
  paidFrom: string | null;
}

/** Rust `Event`, renamed so it does not clash with the DOM `Event`. */
export interface EngineEvent {
  date: IsoDate;
  nominalDate: IsoDate;
  itemId: string;
  name: string;
  centavos: number;
  note: string | null;
  included: boolean;
}

export interface LowPoint {
  date: IsoDate;
  centavos: number;
  causes: string[];
}

export interface Cutoff {
  payday: IsoDate;
  nominal: IsoDate;
  end: IsoDate;
  incomeCentavos: number;
  outflowCentavos: number;
  leftCentavos: number;
  eventIndices: number[];
}

export interface FinishLine {
  itemId: string;
  name: string;
  lastPayment: IsoDate;
  freesPerMonthCentavos: number;
}

export interface MonthEnd {
  month: string;
  centavos: number;
}

export interface Projection {
  start: IsoDate;
  days: number[];
  events: EngineEvent[];
  whatIfDays: number[] | null;
  gipit: LowPoint | null;
  firstBelowBuffer: IsoDate | null;
  firstBelowZero: IsoDate | null;
  cutoffs: Cutoff[];
  finishLines: FinishLine[];
  monthEnds: MonthEnd[];
  expectedToday: number | null;
}

export type PayOption =
  | { type: 'cash' }
  | { type: 'installment'; months: number; monthly: Money | null };

export interface Purchase {
  name: string;
  price: Money;
  date: IsoDate;
  options: PayOption[];
}

export type Verdict = 'kaya' | 'gipit' | 'hindiKaya';

export interface OptionResult {
  label: string;
  option: PayOption;
  verdict: Verdict;
  lowest: LowPoint;
  daysBelowBuffer: number;
  daysBelowZero: number;
  totalPaidCentavos: number;
  addOnCentavos: number;
  monthlyCentavos: number | null;
}

export interface BestDate {
  date: IsoDate;
  reason: string | null;
  lowestAfter: LowPoint;
}

export interface Comparison {
  bestCashDate: BestDate | null;
  options: OptionResult[];
}
