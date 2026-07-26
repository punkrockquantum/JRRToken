import { useState } from 'react';
import { ACCELERATORS } from '../data/accelerators';
import { BUSINESS_CASES, RACK_DENSITIES } from '../data/businessCases';
import { COOLING, CPUS, DATACENTERS, FABRICS, STORAGE } from '../data/infrastructure';
import { PLATFORMS } from '../data/platforms';
import { SCENARIO } from '../data/workshop';
import {
  evaluate,
  TEAMS,
  type Evaluation,
  type Submission,
  type TeamColor,
} from '../game/judge';

/**
 * Token Alchemy Challenge — the live evaluation terminal for the
 * competitive lab rotation. Teams design their architecture offline,
 * bring their worksheet to the facilitator, and the engine scores the
 * whole design: memory, watts-into-tokens, throughput, facility design
 * and economics. No crashes, no disqualifications — real platforms queue,
 * and weak designs lose points, not their seat at the table.
 */

interface LogItem {
  sub: Submission;
  ev: Evaluation;
  at: string;
}

interface Standing {
  total: number;
  band: string;
  rubric: string;
  attempts: number;
}

export function ChallengeView() {
  const [team, setTeam] = useState<TeamColor>('Red');
  const [platformId, setPlatformId] = useState('hpe-xd670');
  const [accelId, setAccelId] = useState('nvidia-h200');
  const [cpuId, setCpuId] = useState('intel-xeon-8592');
  const [nodes, setNodes] = useState(2);
  const [fabricId, setFabricId] = useState('ib-ndr');
  const [storageId, setStorageId] = useState('parallel-fs');
  const [dcId, setDcId] = useState('iad');
  const [coolingId, setCoolingId] = useState('rdhx');
  const [businessCaseId, setBusinessCaseId] = useState('lifesci');
  const [rackDensityId, setRackDensityId] = useState('standard');
  const [kvMb, setKvMb] = useState('');
  const [cap, setCap] = useState('');
  const [breakEven, setBreakEven] = useState('');
  const [log, setLog] = useState<LogItem[]>([]);
  const [board, setBoard] = useState<Partial<Record<TeamColor, Standing>>>({});
  const [formError, setFormError] = useState('');

  const submit = () => {
    const kvMbPerToken = parseFloat(kvMb);
    const concurrencyTarget = parseInt(cap, 10);
    const breakEvenMonth = parseInt(breakEven, 10);
    if (
      !Number.isFinite(kvMbPerToken) ||
      !Number.isInteger(concurrencyTarget) ||
      !Number.isInteger(breakEvenMonth) ||
      kvMbPerToken <= 0 ||
      concurrencyTarget <= 0 ||
      breakEvenMonth <= 0
    ) {
      setFormError(
        'All three worksheet numbers are required: KV cache MB/token, safe sessions per node, and break-even month.'
      );
      return;
    }
    setFormError('');
    const sub: Submission = {
      team,
      platformId,
      accelId,
      nodesPerRegion: nodes,
      fabricId,
      storageId,
      cpuId,
      dcId,
      coolingId,
      businessCaseId,
      rackDensityId,
      kvMbPerToken,
      concurrencyTarget,
      breakEvenMonth,
    };
    const ev = evaluate(sub);
    setLog((l) => [
      {
        sub,
        ev,
        at: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      },
      ...l,
    ]);
    setBoard((b) => ({
      ...b,
      [team]: {
        total: ev.total,
        band: ev.band,
        rubric: `${ev.rubricLevel}/5`,
        attempts: (b[team]?.attempts ?? 0) + 1,
      },
    }));
    setKvMb('');
    setCap('');
    setBreakEven('');
  };

  const ranked = [...TEAMS].sort((a, b) => {
    const sa = board[a];
    const sb = board[b];
    if (sa && sb) return sb.total - sa.total;
    if (sa) return -1;
    if (sb) return 1;
    return 0;
  });

  const byIdName = <T extends { id: string; name: string }>(arr: T[], id: string) =>
    arr.find((x) => x.id === id)?.name ?? id;

  const usdShort = (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1000).toLocaleString()}k`;

  return (
    <div className="challenge">
      <section className="panel">
        <div className="mb-eyebrow">Token Alchemy Challenge — live evaluation terminal</div>
        <h2 className="mission-title">
          Token Chemists, the terminal is live. Bring up your architecture.
        </h2>
        <p className="mission-brief">
          Each team designs offline, then submits the full proposal: reference
          architecture, compute, network, location, cooling — plus the two
          worksheet numbers. The engine runs the physics on a standard judging
          workload and scores five categories, 20 points each: memory &amp;
          concurrency, watts into tokens, throughput &amp; latency, facility
          design, and economics.
        </p>

        <div className="studio-grid">
          <label className="picker entry-team">
            <span className="picker-label">Team</span>
            <select value={team} onChange={(e) => setTeam(e.target.value as TeamColor)}>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="picker-label">Business case</span>
            <select
              value={businessCaseId}
              onChange={(e) => setBusinessCaseId(e.target.value)}
            >
              {BUSINESS_CASES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <span className="picker-note">
              {(() => {
                const b = BUSINESS_CASES.find((x) => x.id === businessCaseId)!;
                return `TTFT \u2264 ${b.ttftTargetMs} ms \u00b7 ${b.tokensPerDayTargetM}M tok/day/hub \u00b7 $${b.revenuePer1M.toFixed(2)}/1M value \u00b7 ${Math.round(b.utilization * 100)}% utilisation. ${b.blurb}`;
              })()}
            </span>
          </label>
          <label className="picker">
            <span className="picker-label">Rack density</span>
            <select value={rackDensityId} onChange={(e) => setRackDensityId(e.target.value)}>
              {RACK_DENSITIES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="picker-note">
              {RACK_DENSITIES.find((r) => r.id === rackDensityId)?.note}
            </span>
          </label>
          <label className="picker">
            <span className="picker-label">Reference architecture</span>
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="picker-label">Compute (accelerator)</span>
            <select value={accelId} onChange={(e) => setAccelId(e.target.value)}>
              {ACCELERATORS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.vendor} {a.name}
                </option>
              ))}
            </select>
            <span className="picker-note">
              Includes the alternative architectures: SambaNova SN40L racks
              and Cerebras CS-3 wafer-scale pods, as sold at market.
            </span>
          </label>
          <label className="picker">
            <span className="picker-label">Host CPU (Intel / AMD)</span>
            <select value={cpuId} onChange={(e) => setCpuId(e.target.value)}>
              {CPUS.filter((c) => c.vendor === 'Intel' || c.vendor === 'AMD').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.vendor} {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="picker-label">Nodes per region: {nodes}</span>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={nodes}
              onChange={(e) => setNodes(Number(e.target.value))}
            />
          </label>
          <label className="picker">
            <span className="picker-label">Network fabric</span>
            <select value={fabricId} onChange={(e) => setFabricId(e.target.value)}>
              {FABRICS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="picker-label">Storage layer</span>
            <select value={storageId} onChange={(e) => setStorageId(e.target.value)}>
              {STORAGE.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id === 'parallel-fs' ? 'WEKA parallel filesystem (DL345)' : s.name}
                </option>
              ))}
            </select>
            <span className="picker-note">
              Per the judges&rsquo; note: WEKA (original XD670 architecture)
              and the Alletra-class NVMe-oF array are both correct answers.
            </span>
          </label>
          <label className="picker">
            <span className="picker-label">Location</span>
            <select value={dcId} onChange={(e) => setDcId(e.target.value)}>
              {DATACENTERS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="picker-label">Cooling</span>
            <select value={coolingId} onChange={(e) => setCoolingId(e.target.value)}>
              {COOLING.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="picker-label">Worksheet: KV cache density (MB/token)</span>
            <input
              type="number"
              step="0.001"
              min="0"
              placeholder="MB per token"
              value={kvMb}
              onChange={(e) => setKvMb(e.target.value)}
            />
            <span className="picker-note">
              The rubric hinges on this number. Generic industry estimates
              score Proficient at best; quantized KV math violates Rule 1.
            </span>
          </label>
          <label className="picker">
            <span className="picker-label">Worksheet: safe sessions / node</span>
            <input
              type="number"
              step="1"
              min="0"
              placeholder="sessions"
              value={cap}
              onChange={(e) => setCap(e.target.value)}
            />
            <span className="picker-note">
              {(() => {
                const b = BUSINESS_CASES.find((x) => x.id === businessCaseId)!;
                return `Compute it for THIS case: ${b.sessionContextTokens.toLocaleString()}-token sessions \u00d7 0.330 MB/token at FP16.`;
              })()}
            </span>
          </label>
          <label className="picker">
            <span className="picker-label">Worksheet: break-even month</span>
            <input
              type="number"
              step="1"
              min="0"
              placeholder="e.g. 38"
              value={breakEven}
              onChange={(e) => setBreakEven(e.target.value)}
            />
          </label>
          <div className="picker entry-submit">
            <span className="picker-label">&nbsp;</span>
            <button className="run-btn entry-run" onClick={submit}>
              Evaluate architecture
            </button>
          </div>
        </div>
        {formError && <div className="warning">{formError}</div>}
      </section>

      <div className="challenge-body">
        <section className="panel term-panel">
          <h2>Evaluation results</h2>
          {log.length === 0 ? (
            <p className="stream-hint">
              Awaiting the first submission. Teams bring their designed
              architecture and two worksheet numbers: safe sessions per node
              at their business case&rsquo;s context size (FP16, 0.330
              MB/token) and break-even month for their design vs the $
              {(SCENARIO.cloudAlternativeMonthly / 1000).toFixed(0)}k/month
              cloud alternative.
            </p>
          ) : (
            <div className="term-log">
              {log.map((item, i) => (
                <div key={i} className="term-entry">
                  <div className="term-head">
                    <span className="term-team">Team {item.sub.team}</span>
                    <span className="term-input">
                      {byIdName(BUSINESS_CASES, item.sub.businessCaseId)} &middot;{' '}
                      {byIdName(PLATFORMS, item.sub.platformId).split('(')[0].trim()} &middot;{' '}
                      {byIdName(ACCELERATORS, item.sub.accelId)} &middot;{' '}
                      {item.sub.nodesPerRegion} node(s) &middot;{' '}
                      {byIdName(RACK_DENSITIES, item.sub.rackDensityId).split(' \u2014')[0]} &middot;{' '}
                      {byIdName(DATACENTERS, item.sub.dcId).split(' (')[0]} &middot;{' '}
                      {byIdName(COOLING, item.sub.coolingId).split(' (')[0]}
                    </span>
                    <span className="term-time">{item.at}</span>
                  </div>
                  <div
                    className={`term-banner ${item.ev.total >= 85 ? 'perfect' : item.ev.total >= 50 ? 'inefficient' : 'crash'}`}
                  >
                    {item.ev.band} — {item.ev.total}/100
                    <span className="rubric-badge">
                      Track A rubric: {item.ev.rubricLevel}/5 ({item.ev.rubricLabel})
                    </span>
                  </div>
                  <div className="cat-list">
                    {item.ev.categories.map((c) => (
                      <div key={c.id} className="cat-row">
                        <div className="cat-head">
                          <span className="cat-label">
                            {c.label}
                            {c.weight !== 1 && (
                              <span className="cat-weight"> &times;{c.weight} weight</span>
                            )}
                          </span>
                          <span className="cat-pts">
                            {c.points}/{c.max}
                          </span>
                        </div>
                        <div className="cat-bar">
                          <div
                            className="cat-fill"
                            style={{ width: `${(c.points / c.max) * 100}%` }}
                          />
                        </div>
                        <div className="cat-detail">{c.detail}</div>
                      </div>
                    ))}
                  </div>
                  <div className="outcome-block">
                    <div className="outcome-title">
                      Deployment outcome — time to ROI &amp; profit / loss
                    </div>
                    <div className="outcome-timeline">
                      {item.ev.outcome.timeline.map((p) => {
                        const maxAbs = Math.max(
                          ...item.ev.outcome.timeline.map((q) => Math.abs(q.cumulativeUSD))
                        );
                        const pct = maxAbs > 0 ? (Math.abs(p.cumulativeUSD) / maxAbs) * 100 : 0;
                        const positive = p.cumulativeUSD >= 0;
                        return (
                          <div key={p.month} className="outcome-row">
                            <span className="outcome-m">M{p.month}</span>
                            <div className="outcome-track">
                              <div
                                className={`outcome-fill${positive ? ' positive' : ''}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className={`outcome-val${positive ? ' positive' : ''}`}>
                              {positive ? '+' : '\u2212'}
                              {usdShort(Math.abs(p.cumulativeUSD))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="outcome-statement">{item.ev.outcome.statement}</div>
                  </div>
                  <div className="roi-strip">
                    <div className="roi-cell">
                      <span className="roi-v">
                        {usdShort(item.ev.derived.capexGlobal)}
                      </span>
                      <span className="roi-k">CapEx</span>
                    </div>
                    <div className="roi-cell">
                      <span className="roi-v">
                        {usdShort(item.ev.derived.opexMonthly)}/mo
                      </span>
                      <span className="roi-k">OpEx</span>
                    </div>
                    <div className="roi-cell">
                      <span className="roi-v">
                        {usdShort(item.ev.derived.revenueMonthly)}/mo
                      </span>
                      <span className="roi-k">Token value earned</span>
                    </div>
                    <div className="roi-cell">
                      <span className="roi-v">
                        {item.ev.derived.netCashMonthly >= 0
                          ? `${usdShort(item.ev.derived.netCashMonthly)}/mo`
                          : 'negative'}
                      </span>
                      <span className="roi-k">Net cash</span>
                    </div>
                    <div className="roi-cell">
                      <span className="roi-v">
                        {item.ev.derived.paddedBreakEven
                          ? `M${item.ev.derived.paddedBreakEven}`
                          : 'never'}
                      </span>
                      <span className="roi-k">Payback (padded)</span>
                    </div>
                    <div className="roi-cell">
                      <span className="roi-v">
                        {item.ev.derived.net60 >= 0
                          ? usdShort(item.ev.derived.net60)
                          : `\u2212${usdShort(Math.abs(item.ev.derived.net60))}`}
                      </span>
                      <span className="roi-k">60-mo net</span>
                    </div>
                    <div className="roi-cell">
                      <span className="roi-v">{item.ev.derived.roiPct.toFixed(0)}%</span>
                      <span className="roi-k">ROI</span>
                    </div>
                  </div>
                  <details className="coeff-panel">
                    <summary>The maths — every coefficient behind this score</summary>
                    <div className="coeff-list">
                      {item.ev.formulas.map((f, j) => (
                        <div key={j} className="term-math-line">
                          {f}
                        </div>
                      ))}
                    </div>
                  </details>
                  <div className="term-critique">
                    <span className="term-critique-k">Pitch coach</span>
                    {item.ev.critique}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel board-panel">
          <h2>Session leaderboard</h2>
          <table className="lease-table board-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Score</th>
                <th>Rubric</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((t, i) => {
                const s = board[t];
                return (
                  <tr key={t} className={s && s.total >= 85 ? 'lease-total' : ''}>
                    <td>{s ? i + 1 : '\u2014'}</td>
                    <td>
                      <span className={`team-dot team-${t.toLowerCase()}`} />
                      {t}
                    </td>
                    <td>{s ? `${s.total} / 100` : '\u2014'}</td>
                    <td>{s ? s.rubric : '\u2014'}</td>
                    <td>
                      {s ? `${s.band.toLowerCase()} (attempt ${s.attempts})` : 'Not yet participated'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="option-tagline">
            Latest submission counts. Five categories, 20 points each — 85+
            is board-ready. Overshooting a session cap queues users instead of
            crashing; it costs accuracy points, not the game.
          </p>
        </section>
      </div>
    </div>
  );
}
