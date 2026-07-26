import type { SimConfig, SimResult } from '../simulation/engine';

function fmt(n: number, digits = 1): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(digits);
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Monochrome shades for the cost breakdown, dark to light. */
const COST_SHADES = ['#e4e4e7', '#b9b9c0', '#8a8a92', '#66666e', '#4a4a52', '#333338', '#232327'];

export function Metrics({ result, cfg }: { result: SimResult; cfg: SimConfig }) {
  const cards = [
    {
      label: 'Time to first token',
      value: fmtMs(result.ttftMs),
      sub: 'network + prefill, the pause before the answer starts',
    },
    {
      label: 'Tokens / sec (per user)',
      value: fmt(result.perUserTps),
      sub: 'reading speed of the stream you see',
    },
    {
      label: 'System throughput',
      value: `${fmt(result.systemTps, 0)} tok/s`,
      sub: `across ${cfg.batchSize} batched user${cfg.batchSize > 1 ? 's' : ''}`,
    },
    {
      label: 'Cost / 1M tokens',
      value: `$${result.costPer1MTokensUSD.toFixed(2)}`,
      sub: 'itemised below',
    },
    {
      label: 'Facility power',
      value: `${fmt(result.facilityPowerKw)} kW`,
      sub: `IT ${fmt(result.itPowerKw)} kW at PUE ${result.pue.toFixed(2)}`,
    },
    {
      label: 'Energy / 1k tokens',
      value: `${fmt(result.energyWhPer1kTokens)} Wh`,
      sub: `${fmt(result.carbonGPer1kTokens, 2)} g CO2e on this grid`,
    },
  ];

  const sorted = [...result.costBreakdown].sort((a, b) => b.usdPer1M - a.usdPer1M);
  const total = result.costPer1MTokensUSD;

  return (
    <section className="panel">
      <h2>Simulated results</h2>
      <div className="metric-grid">
        {cards.map((c) => (
          <div key={c.label} className="metric-card">
            <div className="metric-value">{c.value}</div>
            <div className="metric-label">{c.label}</div>
            <div className="metric-sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="cost-breakdown">
        <div className="cost-breakdown-title">
          Where each dollar of the ${total.toFixed(2)} / 1M tokens goes
        </div>
        <div className="cost-bar">
          {sorted.map((c, i) => (
            <div
              key={c.id}
              className="cost-seg"
              style={{
                width: `${(c.usdPer1M / total) * 100}%`,
                background: COST_SHADES[i % COST_SHADES.length],
              }}
              title={`${c.label}: $${c.usdPer1M.toFixed(3)}`}
            />
          ))}
        </div>
        <div className="cost-legend">
          {sorted.map((c, i) => (
            <span key={c.id} className="cost-legend-item">
              <span
                className="cost-swatch"
                style={{ background: COST_SHADES[i % COST_SHADES.length] }}
              />
              {c.label} <strong>${c.usdPer1M.toFixed(c.usdPer1M < 0.01 ? 4 : 2)}</strong>
            </span>
          ))}
        </div>
      </div>

      {result.warnings.length > 0 && (
        <div className="warnings">
          {result.warnings.map((w, i) => (
            <div key={i} className="warning">
              {w}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
