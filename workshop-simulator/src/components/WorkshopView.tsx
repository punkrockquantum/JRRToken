import { useMemo, useState } from 'react';
import { ACCELERATORS } from '../data/accelerators';
import {
  COOLING,
  CPUS,
  DATACENTERS,
  FABRICS,
  STORAGE,
  WAN,
} from '../data/infrastructure';
import { MODELS } from '../data/models';
import { PLATFORMS, type PlatformSpec } from '../data/platforms';
import { USE_CASES, type UseCase } from '../data/useCases';
import {
  financials,
  leaseSubtotal,
  regionMrc,
  SCENARIO,
  WORKSHOP_OPTIONS,
  WORKSHOP_REGIONS,
  type WorkshopOption,
} from '../data/workshop';
import { simulate, type SimConfig, type SimResult } from '../simulation/engine';
import { TrackA } from './TrackA';
import { WattsToTokens } from './WattsToTokens';

/**
 * The Sharp(er) Enterprises workshop, track by track. Users pick one of
 * the three architecture options from the judges' registry; every track
 * card shows that option's official workbook values, and the simulation
 * engine runs the same configuration to show the physics behind them.
 */

const byId = <T extends { id: string }>(arr: T[], id: string): T =>
  arr.find((x) => x.id === id) ?? arr[0];

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function optionSim(
  opt: WorkshopOption,
  platform: PlatformSpec,
  useCase: UseCase
): { cfg: SimConfig; result: SimResult } {
  const base: SimConfig = {
    model: byId(MODELS, 'llama-3.3-70b'),
    quant: 'fp16',
    // Alternative architectures (SambaNova, Cerebras) bring their own silicon.
    accelerator: byId(
      ACCELERATORS,
      platform.overridesAccelerator ? platform.accelId : opt.accelId
    ),
    extraGpus: 0,
    cpu: byId(CPUS, 'intel-xeon-8592'),
    storage: byId(STORAGE, 'parallel-fs'), // WEKA / PowerScale parallel flash
    kvPlacement: 'hbm',
    fabric: byId(FABRICS, platform.fabricId), // IB NDR (HPE doc) vs RoCE (Dell)
    wan: byId(WAN, opt.wanId),
    cooling: byId(COOLING, opt.coolingId),
    datacenter: byId(DATACENTERS, 'iad'),
    powerLimitPct: 1,
    coolantSetpointC: 25,
    batchSize: useCase.batchSize,
    promptTokens: useCase.promptTokens,
    outputTokens: useCase.outputTokens,
  };
  // Size to one full chassis (all accelerators in the node).
  const probe = simulate(base);
  const perNode = base.accelerator.perNode;
  const cfg = { ...base, extraGpus: Math.max(0, perNode - probe.minGpus) };
  return { cfg, result: simulate(cfg) };
}

/** Chassis naming per option family for the selected vendor platform. */
function chassisName(platform: PlatformSpec, opt: WorkshopOption): string {
  // Alternative architectures keep their own chassis regardless of option.
  if (platform.overridesAccelerator) return platform.chassis;
  if (opt.n === 2) {
    return platform.vendor === 'HPE'
      ? 'HPE Enterprise Blackwell Architecture Frame'
      : 'Dell PowerEdge XE9685L (Blackwell)';
  }
  if (opt.n === 3) {
    return platform.vendor === 'HPE'
      ? 'HPE Secure Enclave Architecture Platform'
      : 'Dell PowerEdge XE9680 (secure enclave build)';
  }
  return platform.chassis;
}

export function WorkshopView() {
  const [optionId, setOptionId] = useState('option1');
  const [platformId, setPlatformId] = useState('hpe-xd670');
  const [useCaseId, setUseCaseId] = useState('copilot');
  const opt = byId(WORKSHOP_OPTIONS, optionId);
  const platform = byId(PLATFORMS, platformId);
  const useCase = byId(USE_CASES, useCaseId);
  const { cfg, result } = useMemo(
    () => optionSim(opt, platform, useCase),
    [opt, platform, useCase]
  );
  const fin = useMemo(() => financials(opt), [opt]);
  const [optNote, setOptNote] = useState('');

  const regionTokensPerDay = result.systemTps * 86400 * opt.nodesPerRegion;
  const hubPct = Math.min(999, (regionTokensPerDay / SCENARIO.tokensPerDayPerHub) * 100);
  const ingestGBs = opt.lakeIngestGB / opt.lakeIngestSeconds;

  /** Search every option x platform pairing for the lowest TTFT, breaking
   *  ties on the best all-in cost per 1M tokens, and apply the winner. */
  const optimise = () => {
    let best: {
      o: WorkshopOption;
      p: PlatformSpec;
      ttft: number;
      cost: number;
      tps: number;
    } | null = null;
    for (const o of WORKSHOP_OPTIONS) {
      for (const p of PLATFORMS) {
        const { result: r } = optionSim(o, p, useCase);
        if (
          !best ||
          r.ttftMs < best.ttft - 0.01 ||
          (Math.abs(r.ttftMs - best.ttft) <= 0.01 && r.costPer1MTokensUSD < best.cost)
        ) {
          best = {
            o,
            p,
            ttft: r.ttftMs,
            cost: r.costPer1MTokensUSD,
            tps: r.perUserTps,
          };
        }
      }
    }
    if (!best) return;
    setOptionId(best.o.id);
    setPlatformId(best.p.id);
    setOptNote(
      `Optimised for the \u201c${useCase.name}\u201d workload: ${best.o.name} on ${best.p.name.split('(')[0].trim()} \u2014 TTFT ${best.ttft.toFixed(0)} ms and $${best.cost.toFixed(2)}/1M tokens at ${best.tps.toFixed(0)} tok/s per stream, the best of ${WORKSHOP_OPTIONS.length * PLATFORMS.length} configurations tested. Latency is won by fast fabric and short prefill; token value by cheap power, dense batching and hardware the workload actually saturates.`
    );
  };

  return (
    <div className="workshop">
      {/* ---- watts to tokens: the journey, first thing on screen ---- */}
      <section className="panel">
        <div className="panel-title-row">
          <h2>Watts to tokens — the journey</h2>
          <button className="run-btn" onClick={optimise}>
            Optimise: lowest TTFT, best token value
          </button>
        </div>
        <WattsToTokens cfg={cfg} result={result} useCase={useCase} />
        {optNote && <div className="judges-note">{optNote}</div>}
      </section>

      {/* ---- mission brief ---- */}
      <section className="panel">
        <div className="mb-eyebrow">The scenario</div>
        <h2 className="mission-title">
          {SCENARIO.company} — {SCENARIO.product} GA launch
        </h2>
        <p className="mission-brief">
          A {SCENARIO.arr} must launch its AI-native development assistant in{' '}
          {SCENARIO.windowDays} days across three private hubs — Ashburn,
          Frankfurt and Tokyo. Hard constraints: {SCENARIO.model}; each hub
          sustains {SCENARIO.tokensPerDayPerHub / 1e6}M tokens per 24 hours;
          TTFT stays under {SCENARIO.ttftTargetMs} ms. Your table picks one of
          three architecture options and defends it across five tracks.
        </p>
        <div className="seg option-seg">
          {WORKSHOP_OPTIONS.map((o) => (
            <button
              key={o.id}
              className={optionId === o.id ? 'on' : ''}
              onClick={() => setOptionId(o.id)}
            >
              Option {o.n} — {o.name}
            </button>
          ))}
        </div>
        <p className="option-tagline">{opt.tagline}</p>

        <div className="picker-row">
          <label className="picker">
            <span className="picker-label">Server architecture</span>
            <select value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
              {PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="picker">
            <span className="picker-label">Use case (token flow)</span>
            <select value={useCaseId} onChange={(e) => setUseCaseId(e.target.value)}>
              {USE_CASES.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="option-tagline">
          {platform.blurb} {useCase.description}
        </p>
      </section>

      {/* ---- Track A ---- */}
      <TrackA cfg={cfg} result={result} />

      {/* ---- Track B ---- */}
      <section className="panel">
        <h2>
          Track B — {platform.vendor} consultant: compute &amp; local storage
        </h2>
        <div className="tracka">
          <div className="tracka-rows">
            <Row k="Server chassis selection" v={chassisName(platform, opt)} strong />
            <Row
              k={`Nodes per region (16\u00d7 GPU footprint)`}
              v={`${opt.nodesPerRegion} nodes`}
            />
            <Row
              k="Aggregate VRAM per chassis frame"
              v={`${opt.vramPerChassisGB.toLocaleString()} GB`}
            />
            <Row
              k={`Node VRAM headroom post-weights (${SCENARIO.baseWeightsGB} GB base)`}
              v={`${opt.headroomGB} GB`}
            />
            <Row k="Node CPUs" v={platform.cpus} />
            <Row k="Node memory" v={platform.memory} />
            <Row k="Node local storage" v={platform.localStorage} />
            <Row k="Node networking" v={platform.nics} />
            <Row k="Node power" v={platform.psus} />
            <Row k="Rack building block" v={platform.buildingBlock} />
            <Row k="Storage layer" v={platform.storageArray} strong />
            <Row
              k="Storage cluster"
              v={`${platform.storageNodes.split('(')[0].trim()} \u2014 ${platform.storageCapacity}`}
            />
            <Row
              k="Storage throughput"
              v={`${platform.storageWriteGBs} GB/s write / ${platform.storageReadGBs} GB/s read`}
            />
            <Row
              k="Registry storage line (Alletra MP \u2014 see judges' note)"
              v={`${opt.writeIops.toLocaleString()} IOPS \u00b7 ${opt.storageProtocol}`}
            />
            <Row
              k={`${opt.lakeIngestGB} GB lake ingest runtime (registry)`}
              v={`${opt.lakeIngestSeconds.toFixed(2)} s (${ingestGBs.toFixed(1)} GB/s)`}
            />
          </div>
          <div className="tracka-side">
            <div className="tracka-check">
              <span className="tracka-check-k">
                Simulated: one chassis ({result.gpuCount}&times; {cfg.accelerator.name})
              </span>
              <span className="tracka-check-v">
                {result.perUserTps.toFixed(0)} tok/s per stream
              </span>
              <span className="tracka-check-note">
                {cfg.fabric.name} compute fabric ({platform.vendor === 'HPE' ? 'per the AI Factory doc' : 'Ethernet-first Dell design'}), {cfg.cooling.name.toLowerCase()}.
                Cold-start weight load: {result.coldStartS.toFixed(1)} s.
              </span>
            </div>
            <div className="tracka-check">
              <span className="tracka-check-k">
                Region capacity vs {SCENARIO.tokensPerDayPerHub / 1e6}M tokens/day
              </span>
              <span className="tracka-check-v">
                {(regionTokensPerDay / 1e6).toFixed(0)}M/day ({hubPct.toFixed(0)}%)
              </span>
              <span className="tracka-check-note">
                {opt.nodesPerRegion} nodes per region on the &ldquo;{useCase.name}&rdquo;
                profile ({useCase.batchSize}-stream batch) — why Track B sizes two
                chassis per hub, not one.
              </span>
            </div>
            <div className="tracka-check">
              <span className="tracka-check-k">Pricing anchors</span>
              {platform.priceAnchors.map((p) => (
                <span key={p.k} className="tracka-check-note">
                  {p.k}: <strong>{p.v}</strong>
                  {p.fromDoc ? ' (from doc)' : ' (estimate)'}
                </span>
              ))}
            </div>
            <div className="tracka-check">
              <span className="tracka-check-k">Fabric rationale</span>
              <span className="tracka-check-note">{platform.fabricNote}</span>
            </div>
            {result.warnings.length > 0 && (
              <div className="tracka-check">
                <span className="tracka-check-k">Simulation flags</span>
                <span className="tracka-check-note">{result.warnings[0]}</span>
              </div>
            )}
          </div>
        </div>
        <div className="judges-note">
          <strong>Judges&rsquo; note — Track B storage:</strong> accept either
          answer as correct. &ldquo;WEKA on DL345 Gen11&rdquo; is right per the
          original XD670 reference architecture taught on Day 1;
          &ldquo;HPE Alletra Storage MP&rdquo; is right per the answer key.
          They are different architectures with different protocols (parallel
          filesystem vs disaggregated array), and Alletra X10K performance
          figures are not yet fully validated &mdash; no team should be dinged
          for citing the &ldquo;other&rdquo; right answer.
        </div>
        {!platform.registryAligned && (
          <div className="warning">
            The judges&rsquo; registry names HPE hardware (Cray XD670 / Alletra
            MP). The Dell PowerEdge alternative is a valid market equivalent
            for discussion, but workbook answers keyed to the registry should
            use the HPE line items.
          </div>
        )}
      </section>

      {/* ---- Track C ---- */}
      <section className="panel">
        <h2>Track C — Data center configurator &amp; operator</h2>
        <div className="tracka-rows">
          <Row k="Site deployment geometry strategy" v={opt.geometry} strong />
          <Row k="Continuous power interface" v={opt.powerInterface} />
          <Row k="Physical cabinet isolation" v={opt.cageStrategy} />
        </div>
        <table className="lease-table">
          <thead>
            <tr>
              <th>Site target region</th>
              <th>Footprint</th>
              <th>Reserved kW</th>
              <th>Price / kW</th>
              <th>All-in base MRC</th>
            </tr>
          </thead>
          <tbody>
            {WORKSHOP_REGIONS.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{opt.racksPerRegion} racks</td>
                <td>{opt.kwPerRegion} kW</td>
                <td>${r.usdPerKwMonth} / kW</td>
                <td>{usd(regionMrc(opt, r))} / month</td>
              </tr>
            ))}
            <tr className="lease-total">
              <td colSpan={4}>Unified space &amp; power base MRC subtotal</td>
              <td>{usd(leaseSubtotal(opt))} / month</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ---- Track D ---- */}
      <section className="panel">
        <h2>Track D — WAN &amp; MCP consultant: connectivity backplane</h2>
        <p className="mission-brief">
          Port speeds, VLANs, carrier MCP servers and private vRouters per
          edge are uncovered by interviewing the Track D table lead — they are
          intentionally blank here, exactly as in the workbook. The one
          verification anchor: entries must total exactly{' '}
          <strong>{usd(SCENARIO.networkCircuitMonthly)} / month</strong> for
          the Track E ledger to balance.
        </p>
        <table className="lease-table">
          <thead>
            <tr>
              <th>Site edge</th>
              <th>Port speed</th>
              <th>VLAN</th>
              <th>Carrier MCP server</th>
              <th>Private vRouter MRC</th>
            </tr>
          </thead>
          <tbody>
            {WORKSHOP_REGIONS.map((r) => (
              <tr key={r.id}>
                <td>{r.name.split(' (')[0]} Edge</td>
                <td className="blank" />
                <td className="blank" />
                <td className="blank" />
                <td className="blank" />
              </tr>
            ))}
            <tr className="lease-total">
              <td colSpan={4}>Unified global networking circuit subtotal</td>
              <td>{usd(SCENARIO.networkCircuitMonthly)} / month</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* ---- Track E ---- */}
      <section className="panel">
        <h2>Track E — Solutions architect boardroom: the financial case</h2>
        <div className="fin-grid">
          <div className="fin-card">
            <span className="fin-v">{usd(opt.capexUSD)}</span>
            <span className="fin-k">Upfront CapEx build cost</span>
          </div>
          <div className="fin-card">
            <span className="fin-v">{usd(fin.year1Opex)}</span>
            <span className="fin-k">Year 1 operational runway (OpEx)</span>
          </div>
          <div className="fin-card">
            <span className="fin-v">{usd(fin.opexMonthly)} / mo</span>
            <span className="fin-k">Amortised month 13&ndash;60 flat rate</span>
          </div>
          <div className="fin-card">
            <span className="fin-v">Month {fin.paddedBreakEvenMonth}</span>
            <span className="fin-k">Break-even vs public cloud</span>
          </div>
        </div>
        <div className="fin-math">
          <div className="fin-step">
            <strong>1 &middot; True monthly operating weight.</strong>{' '}
            Depreciation {usd(opt.capexUSD)} / {SCENARIO.amortizationMonths} months ={' '}
            {usd(fin.depreciationMonthly)} + invoices ({usd(leaseSubtotal(opt))} DC
            lease + {usd(SCENARIO.networkCircuitMonthly)} network circuit) ={' '}
            <strong>{usd(fin.trueMonthlyWeight)} / month</strong>. Keep the
            CapEx/OpEx firewall: only the {usd(fin.opexMonthly)} of recurring
            cash belongs on the OpEx line.
          </div>
          <div className="fin-step">
            <strong>2 &middot; Break-even cross-over.</strong> Public cloud
            alternative {usd(fin.cloudMonthly)} &minus; private OpEx{' '}
            {usd(fin.opexMonthly)} = {usd(fin.netMonthlySavings)} saved per
            month. Naked division: {usd(opt.capexUSD)} &divide;{' '}
            {usd(fin.netMonthlySavings)} = {fin.nakedBreakEvenMonths.toFixed(2)}{' '}
            months. Factoring burn-in, data transitions and delivery loops,
            equilibrium lands at <strong>Month {fin.paddedBreakEvenMonth}</strong>{' '}
            — defending that padding is worth rubric points.
          </div>
          <div className="fin-step">
            <strong>3 &middot; The boardroom rubric</strong> scores mathematical
            accuracy against this registry, the CapEx/OpEx separation,
            deployment-risk factoring, and C-suite strategic defense — 5 points
            each, 20 total.
          </div>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={`tracka-row${strong ? ' cap' : ''}`}>
      <span className="tracka-k">{k}</span>
      <span className="tracka-v">{v}</span>
    </div>
  );
}
