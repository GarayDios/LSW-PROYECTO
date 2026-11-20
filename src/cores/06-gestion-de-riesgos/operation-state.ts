import type { F5Operation } from '../../features/f5/types.ts';

export function f5Today(time: number): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time)); }
export const f5Pending = (operation: F5Operation) => ['reserved', 'submitted', 'partial', 'ambiguous'].includes(operation.state);
