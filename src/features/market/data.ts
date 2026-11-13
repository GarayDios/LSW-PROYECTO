export interface Company {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  /** Illustrative daily change in percentage points. */
  change: number;
  /** Illustrative annualized implied volatility, decimal. */
  iv: number;
  volume: number;
  liquidity: number;
  dividendYield: number;
  color: string;
  initials: string;
}

/** Fixed illustrative data, not historical snapshots or live market quotes. */
export const companies: Company[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Tecnología', price: 228.42, change: 1.24, iv: .28, volume: 184200, liquidity: 99, dividendYield: .004, color: '#d7dce2', initials: 'A' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Semiconductores', price: 147.22, change: 2.83, iv: .54, volume: 392800, liquidity: 98, dividendYield: .0003, color: '#94c85a', initials: 'N' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Tecnología', price: 428.76, change: .87, iv: .25, volume: 84600, liquidity: 97, dividendYield: .007, color: '#76afe4', initials: 'M' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', sector: 'Automotriz', price: 248.50, change: -1.62, iv: .66, volume: 287500, liquidity: 97, dividendYield: 0, color: '#e68688', initials: 'T' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', sector: 'Consumo discrecional', price: 207.84, change: 1.52, iv: .36, volume: 139200, liquidity: 96, dividendYield: 0, color: '#ecb16b', initials: 'a' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', sector: 'Comunicaciones', price: 585.31, change: 1.93, iv: .35, volume: 93800, liquidity: 95, dividendYield: .003, color: '#79a7ed', initials: '∞' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Comunicaciones', price: 178.65, change: -.45, iv: .29, volume: 116400, liquidity: 96, dividendYield: .004, color: '#c2a2e5', initials: 'G' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', sector: 'Semiconductores', price: 156.92, change: 2.14, iv: .57, volume: 213800, liquidity: 94, dividendYield: 0, color: '#d98e89', initials: 'A' },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Finanzas', price: 224.18, change: .62, iv: .24, volume: 42800, liquidity: 92, dividendYield: .022, color: '#83adb7', initials: 'J' },
  { symbol: 'KO', name: 'The Coca-Cola Company', sector: 'Consumo básico', price: 64.28, change: -.23, iv: .19, volume: 28400, liquidity: 87, dividendYield: .029, color: '#db898e', initials: 'K' },
  { symbol: 'DIS', name: 'The Walt Disney Company', sector: 'Comunicaciones', price: 109.46, change: 1.18, iv: .32, volume: 46700, liquidity: 89, dividendYield: .009, color: '#91b4dd', initials: 'D' },
  { symbol: 'PLTR', name: 'Palantir Technologies', sector: 'Tecnología', price: 58.37, change: 3.42, iv: .72, volume: 198600, liquidity: 93, dividendYield: 0, color: '#c4c7d1', initials: 'P' },
  { symbol: 'AVGO', name: 'Broadcom Inc.', sector: 'Semiconductores', price: 217.34, change: .78, iv: .48, volume: 102400, liquidity: 94, dividendYield: .012, color: '#a29ad6', initials: 'B' },
  { symbol: 'NFLX', name: 'Netflix, Inc.', sector: 'Comunicaciones', price: 924.18, change: 1.09, iv: .39, volume: 72800, liquidity: 95, dividendYield: 0, color: '#d87b88', initials: 'N' },
];
