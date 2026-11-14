// Mockup-only forecast of the sample Davao budget. The real app computes this in the Rust engine;
// this approximation exists so the three restyle mockups show the same, self-consistent numbers.
(function () {
  const HOLIDAYS = new Set([
    '2026-11-30', '2026-12-08', '2026-12-24', '2026-12-25', '2026-12-30', '2026-12-31',
    '2027-01-01', '2027-02-06', '2027-03-10', '2027-03-16', '2027-03-25', '2027-03-26',
    '2027-03-27', '2027-04-09', '2027-05-01', '2027-05-17', '2027-06-12', '2027-08-21',
    '2027-08-30', '2027-11-01', '2027-11-02', '2027-11-30',
  ]);
  const DAY = 86400000;
  const d = (s) => new Date(s + 'T00:00:00Z');
  const iso = (t) => t.toISOString().slice(0, 10);
  const add = (t, n) => new Date(t.getTime() + n * DAY);
  const lastDay = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const working = (t) => t.getUTCDay() % 6 !== 0 && !HOLIDAYS.has(iso(t));
  const prevWorking = (t) => { while (!working(t)) t = add(t, -1); return t; };

  const TODAY = d('2026-11-13');
  const END = d('2027-11-12');
  const START_BALANCE = 12480;

  const events = [];
  const push = (date, name, amount, kind, extra) => {
    if (date >= TODAY && date <= END) events.push({ date, name, amount, kind, ...extra });
  };
  const months = [];
  for (let y = 2026, m = 7; y < 2028; m++) {
    if (m > 11) { m = 0; y++; }
    months.push([y, m]);
    if (y === 2027 && m === 11) break;
  }
  const on = (y, m, day) => new Date(Date.UTC(y, m, Math.min(day, lastDay(y, m))));

  for (const [y, m] of months) {
    for (const day of [15, 30]) {
      const raw = on(y, m, day);
      const paid = prevWorking(raw);
      push(paid, 'Sweldo', 18000, 'income', { payday: true, movedFrom: iso(paid) !== iso(raw) ? raw : null });
      push(raw, 'Pamalengke', -4500, 'bill');
      push(raw, 'Baon & pamasahe', -2500, 'bill');
    }
    push(on(y, m, 1), 'Rent', -7000, 'bill');
    push(on(y, m, 5), 'Converge', -1500, 'bill');
    push(on(y, m, 8), 'Netflix', -549, 'bill');
    push(on(y, m, 13), 'Globe postpaid', -999, 'bill', { from: 'GCash' });
    push(on(y, m, 15), 'Davao Light', -1850, 'bill', { from: 'GCash' });
    push(on(y, m, 16), 'Padala sa ginikanan', -3000, 'bill', { from: 'GCash' });
    push(on(y, m, 20), 'DCWD', -420, 'bill');
    push(on(y, m, 22), 'ChatGPT', -1274.6, 'bill', { fx: '$20 at ₱63.73' });
    if (m === 11) push(prevWorking(on(y, m, 15)), '13th month', 18000, 'income');
  }
  // Installments: k of n, counted from the first payment date.
  const hulog = (name, amount, first, n, day) => {
    let t = d(first);
    for (let k = 1; k <= n; k++) {
      const [y, m] = [t.getUTCFullYear(), t.getUTCMonth()];
      push(on(y, m, day), name, -amount, 'hulog', { k, n });
      t = new Date(Date.UTC(y, m + 1, 1));
    }
  };
  hulog('Home Credit phone', 2083, '2026-09-15', 12, 15);
  hulog('SPayLater', 1250, '2026-10-13', 6, 13);
  // Paluwagan: 10 members, my turn is round 10, so round 10 pays contribution × 9.
  for (let r = 1; r <= 10; r++) {
    const t = new Date(Date.UTC(2026, 7 + r - 1, 15));
    if (r === 10) push(t, 'Paluwagan payout', 9000, 'paluwagan', { k: r, n: 10 });
    else push(t, 'Paluwagan', -1000, 'paluwagan', { k: r, n: 10 });
  }
  push(d('2026-12-20'), 'Pasko gifts', -17000, 'oneoff');
  push(d('2027-01-30'), 'Tuition', -12000, 'oneoff');
  // What-if (excluded): BPI 0% laptop.
  const whatIf = [];
  for (let k = 1; k <= 12; k++) whatIf.push({ date: new Date(Date.UTC(2027, k - 1, 3)), amount: -3249 });

  events.sort((a, b) => a.date - b.date || b.amount - a.amount);

  const days = [];
  let bal = START_BALANCE, wbal = START_BALANCE, ei = 0;
  for (let t = TODAY; t <= END; t = add(t, 1)) {
    const today = [];
    while (ei < events.length && iso(events[ei].date) === iso(t)) { bal += events[ei].amount; today.push(events[ei++]); }
    for (const w of whatIf) if (iso(w.date) === iso(t)) wbal += w.amount;
    wbal += today.reduce((s, e) => s + e.amount, 0);
    days.push({ date: t, balance: Math.round(bal * 100) / 100, whatIf: Math.round(wbal * 100) / 100, events: today });
  }

  const paydays = events.filter((e) => e.payday).map((e) => e.date);
  const cutoffs = paydays.map((p, i) => {
    const end = i + 1 < paydays.length ? add(paydays[i + 1], -1) : END;
    const evs = events.filter((e) => e.date >= p && e.date <= end);
    const startBal = days.find((x) => iso(x.date) === iso(add(p, -1)))?.balance ?? START_BALANCE;
    const endBal = days.find((x) => iso(x.date) === iso(end))?.balance;
    const low = days.filter((x) => x.date >= p && x.date <= end).reduce((a, b) => (b.balance < a.balance ? b : a));
    return { start: p, end, events: evs, startBal, endBal, low };
  });

  const gipit = days.reduce((a, b) => (b.balance < a.balance ? b : a));
  const peso = (n, opts = {}) => {
    const neg = n < 0, v = Math.abs(n);
    const cents = Math.round(v * 100) % 100 !== 0;
    const s = v.toLocaleString('en-PH', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 });
    return (neg ? '−' : opts.sign && n > 0 ? '+' : '') + '₱' + s;
  };
  const fmt = (t, o) => t.toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
  const short = (t) => fmt(t, { month: 'short', day: 'numeric' });

  window.LANTAW = { days, events, cutoffs, gipit, peso, fmt, short, iso, TODAY, END, START_BALANCE };
})();
