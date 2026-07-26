import type { ReactNode } from 'react';
import type { SimConfig, SimResult } from '../simulation/engine';

/**
 * Optional deeper layers for users who want to go beyond the top-level
 * picture: memory maths, the decode roofline, power chain, network path
 * and the economics stack.
 */
export function DeepDive({ result, cfg }: { result: SimResult; cfg: SimConfig }) {
  const weightsPct = Math.min(100, (result.weightsGB / result.memTotalGB) * 100);
  const kvPct =
    cfg.kvPlacement === 'hbm'
      ? Math.min(100 - weightsPct, (result.kvCacheGB / result.memTotalGB) * 100)
      : 0;

  const bytesPerTokenGB =
    (cfg.model.activeParamsB * result.bytesPerParam) +
    ((cfg.promptTokens + cfg.outputTokens / 2) *
      cfg.model.kvKBPerToken *
      (result.bytesPerParam / 2)) /
      1e6;

  return (
    <section className="panel">
      <h2>Dive deeper</h2>
      <p className="deep-intro">
        Every number above falls out of a handful of physical facts. Open a
        layer to see the machinery.
      </p>

      <Layer title="Why generation speed is a memory problem, not a maths problem">
        <p>
          To produce <strong>one token</strong>, the accelerator must stream{' '}
          <strong>every active parameter</strong> out of memory:{' '}
          {cfg.model.activeParamsB}B params × {result.bytesPerParam} bytes ≈{' '}
          <strong>{(cfg.model.activeParamsB * result.bytesPerParam).toFixed(0)} GB</strong>{' '}
          per token, plus the growing KV cache (≈{bytesPerTokenGB.toFixed(0)} GB
          total per step here). Your {result.gpuCount}× {cfg.accelerator.name}{' '}
          moves ~{result.effectiveMemBwTBs.toFixed(1)} TB/s, so the ceiling is
          roughly {(result.effectiveMemBwTBs * 1000 / (cfg.model.activeParamsB * result.bytesPerParam)).toFixed(0)}{' '}
          tokens/s before compute, sync or thermals bite. This is why HBM
          bandwidth — not TFLOPS — headlines every inference chip launch, and
          why MoE models (fewer active params) and quantization (fewer bytes per
          param) are the two big levers.
        </p>
      </Layer>

      <Layer title="GPU memory budget">
        <div className="mem-bar">
          <div className="mem-weights" style={{ width: `${weightsPct}%` }}>
            Weights {result.weightsGB.toFixed(0)}GB
          </div>
          {kvPct > 1 && (
            <div className="mem-kv" style={{ width: `${kvPct}%` }}>
              KV {result.kvCacheGB.toFixed(0)}GB
            </div>
          )}
          <div className="mem-free">
            free of {result.memTotalGB.toFixed(0)}GB
          </div>
        </div>
        <p>
          The model needs {result.minGpus} accelerator
          {result.minGpus > 1 ? 's' : ''} just to hold its weights at{' '}
          {cfg.quant.toUpperCase()}. The KV cache — the model's running memory of
          every conversation — grows with batch size × context length:{' '}
          {cfg.batchSize} users × {(cfg.promptTokens + cfg.outputTokens).toLocaleString()}{' '}
          tokens ≈ {result.kvCacheGB.toFixed(1)}GB here. Long-context serving is
          usually a memory-capacity problem before it is anything else.
        </p>
      </Layer>

      <Layer title="The power & cooling chain">
        <p>
          Silicon draws {Math.round(result.sustainedWPerGpu)}W ×{' '}
          {result.gpuCount} accelerators (+hosts, +storage) ={' '}
          {result.itPowerKw.toFixed(1)} kW of IT load. {cfg.cooling.name} in{' '}
          {cfg.datacenter.metro} yields PUE {result.pue.toFixed(2)}, so the
          building actually pulls{' '}
          <strong>{result.facilityPowerKw.toFixed(1)} kW</strong> from the grid
          — every watt of maths is bought with{' '}
          {(result.pue - 1 < 0.005 ? '<0.01' : (result.pue - 1).toFixed(2))} extra
          watts of cooling and distribution. 100% of the electricity ends up as
          heat; cooling exists purely to move that heat outdoors.
          {result.throttleFactor < 1 && (
            <>
              {' '}
              Right now cooling (or your power cap) limits the silicon to{' '}
              <strong>{Math.round(result.throttleFactor * 100)}% of peak</strong> —
              upgrading cooling is literally a performance upgrade.
            </>
          )}
        </p>
      </Layer>

      <Layer title="The network path">
        <p>
          Two very different networks matter. Inside the cluster,{' '}
          {cfg.fabric.name} keeps {result.gpuCount} accelerators acting as one
          chip — each decode step pays a synchronisation tax, and a slower
          fabric taxes every single token. Outside, your prompt rides{' '}
          {cfg.wan.name} to the {cfg.datacenter.name} campus (
          {(cfg.datacenter.baseRttMs + cfg.wan.addedRttMs).toFixed(0)} ms round
          trip). WAN latency never changes tokens/sec — it only delays the
          first one — which is why interconnection-dense campuses matter most
          for interactive AI.
        </p>
      </Layer>

      <Layer title="Cold starts: why storage tier matters">
        <p>
          Before the first prompt, {result.weightsGB.toFixed(0)}GB of weights
          must travel from storage into GPU memory. From{' '}
          {cfg.storage.name.toLowerCase()} at ~{cfg.storage.gbPerSec} GB/s that
          takes <strong>{result.coldStartS.toFixed(1)} s</strong>. Object
          storage is where weights sleep; GPU-adjacent NVMe is where they wake
          up fast. Serving platforms that scale replicas up and down live or
          die by this number.
        </p>
      </Layer>

      <Layer title="Tokenomics">
        <p>
          At {result.systemTps.toFixed(0)} tokens/s system-wide, this deployment
          produces ~{((result.systemTps * 86400) / 1e9).toFixed(2)}B tokens/day.
          Every layer you configured has a line item in the{' '}
          <strong>${result.costPer1MTokensUSD.toFixed(2)}</strong> per million
          tokens: the accelerators and hosts amortised over four years, the{' '}
          {cfg.fabric.name} fabric ports and switches, the cooling plant and the
          overhead energy its PUE implies, colocation space at{' '}
          {cfg.datacenter.metro} rates, the storage tier holding the weights,
          and the {cfg.wan.name} connection. Batching is the single biggest
          lever: every extra user shares the same weight-streaming cost. This
          is the whole economic logic of large shared inference clusters.
        </p>
      </Layer>
    </section>
  );
}

function Layer({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="layer">
      <summary>{title}</summary>
      <div className="layer-body">{children}</div>
    </details>
  );
}
