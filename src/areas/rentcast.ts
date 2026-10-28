/**
 * Optional RentCast market statistics for one ZIP code: current listings, prices and days on
 * market for homes for sale and for rent. RentCast is metered (the free plan allows 50 calls a
 * month), so results are cached per ZIP and calls are capped per month by the caller.
 */

export const DEFAULT_RENTCAST = "https://api.rentcast.io/v1";

export interface MarketSnapshot {
  zip: string;
  updated: string | null;
  sale: {
    medianPrice: number | null;
    averagePrice: number | null;
    medianPricePerSqft: number | null;
    medianDaysOnMarket: number | null;
    listings: number | null;
    newListings: number | null;
  } | null;
  rent: {
    medianRent: number | null;
    averageRent: number | null;
    medianDaysOnMarket: number | null;
    listings: number | null;
    newListings: number | null;
  } | null;
}

export function rentcastMarketUrl(base: string, zip: string): string {
  return `${base.replace(/\/+$/, "")}/markets?zipCode=${encodeURIComponent(zip)}&dataType=All&historyRange=1`;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

export function parseRentcastMarket(zip: string, body: unknown): MarketSnapshot {
  const data = (body && typeof body === "object" ? body : {}) as Record<string, Record<string, unknown> | undefined>;
  const sale = data.saleData;
  const rent = data.rentalData;
  return {
    zip,
    updated: (typeof sale?.lastUpdatedDate === "string" && sale.lastUpdatedDate.slice(0, 10)) ||
      (typeof rent?.lastUpdatedDate === "string" && rent.lastUpdatedDate.slice(0, 10)) ||
      null,
    sale: sale
      ? {
          medianPrice: num(sale.medianPrice),
          averagePrice: num(sale.averagePrice),
          medianPricePerSqft: num(sale.medianPricePerSquareFoot),
          medianDaysOnMarket: num(sale.medianDaysOnMarket),
          listings: num(sale.totalListings),
          newListings: num(sale.newListings),
        }
      : null,
    rent: rent
      ? {
          medianRent: num(rent.medianRent),
          averageRent: num(rent.averageRent),
          medianDaysOnMarket: num(rent.medianDaysOnMarket),
          listings: num(rent.totalListings),
          newListings: num(rent.newListings),
        }
      : null,
  };
}
