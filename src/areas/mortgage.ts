/**
 * Freddie Mac's weekly 30-year fixed mortgage rate, from FRED's keyless CSV download,
 * and the payment math built on it.
 */

export const DEFAULT_FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US";
export const DOWN_PAYMENT = 0.2;
const YEARS = 30;

export interface MortgageRate {
  /** Percent, e.g. 6.27. */
  rate: number;
  /** Week of the observation, YYYY-MM-DD. */
  date: string;
}

/** The latest observation in a FRED CSV ("observation_date,MORTGAGE30US" then one row per week). */
export function parseFredCsv(text: string): MortgageRate | null {
  const lines = text.trim().split(/\r?\n/);
  for (let i = lines.length - 1; i > 0; i--) {
    const [date, value] = lines[i].split(",");
    const rate = Number(value);
    // FRED marks missing weeks with ".".
    if (/^\d{4}-\d{2}-\d{2}$/.test(date?.trim() || "") && value?.trim() !== "." && Number.isFinite(rate) && rate > 0) {
      return { rate, date: date.trim() };
    }
  }
  return null;
}

/** Monthly principal and interest on `price` with 20% down over 30 years. */
export function monthlyPayment(price: number, ratePct: number): number {
  const principal = price * (1 - DOWN_PAYMENT);
  const r = ratePct / 100 / 12;
  const n = YEARS * 12;
  return r ? (principal * r) / (1 - (1 + r) ** -n) : principal / n;
}
