/** Public risk diagnostics shared by the engine and its authenticated proxy. */
export const f5RiskMessages = {
  paused: 'Las entradas F5 están pausadas. Los cierres y las coberturas que reducen delta siguen disponibles.',
  dailyLoss: 'Se alcanzó el límite de pérdida diaria de F5.',
  uncertain: 'No se pudo verificar la exposición y delta de la cuenta.',
  cycleCapital: 'La asignación acumulada del ciclo supera el límite de capital por ciclo.',
  grossExposure: 'La operación superaría el límite de exposición bruta.',
  premiumExposure: 'La operación superaría el límite de exposición en primas.',
  delta: 'La operación superaría el límite de delta absoluta.',
} as const;

export function publicF5RiskMessage(message: unknown): string | undefined {
  return typeof message === 'string' && Object.values(f5RiskMessages).some(known => known === message) ? message : undefined;
}
