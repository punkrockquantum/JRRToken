import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { AppConfig } from '../App';
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
import type { KvPlacement, Quantization } from '../data/types';
import type { SimConfig, SimResult } from '../simulation/engine';

interface Props {
  cfg: AppConfig;
  setCfg: Dispatch<SetStateAction<AppConfig>>;
  simConfig: SimConfig;
  result: SimResult;
}

export function ConfigPanel({ cfg, setCfg, simConfig, result }: Props) {
  const set = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) =>
    setCfg((c) => ({ ...c, [key]: value }));

  const model = simConfig.model;
  const acc = simConfig.accelerator;

  return (
    <div className="config">
      <p className="cfg-intro">
        Each layer of the deployment is a drawer. Open one, change something,
        and watch the results update instantly on the right.
      </p>

      <Section
        title="1 · Application layer"
        hint="What you ask, and which brain answers"
        defaultOpen
      >
        <Field label="Model & weights">
          <select value={cfg.modelId} onChange={(e) => set('modelId', e.target.value)}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.vendor} — {m.name}
              </option>
            ))}
          </select>
          <p className="field-blurb">
            {model.blurb}
            {model.estimated && (
              <em className="est-flag"> Size is an industry estimate.</em>
            )}
          </p>
          <div className="mini-stats">
            <span>{model.totalParamsB}B params</span>
            <span>{model.activeParamsB}B active/token</span>
            <span>{model.architecture.toUpperCase()}</span>
          </div>
        </Field>

        <Field label="Weight precision (quantization)">
          <div className="seg">
            {(['fp16', 'fp8', 'int4'] as Quantization[]).map((q) => (
              <button
                key={q}
                className={cfg.quant === q ? 'on' : ''}
                onClick={() => set('quant', q)}
              >
                {q.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="field-blurb">
            Fewer bits per weight = less memory to stream per token = faster and
            cheaper, with a small accuracy trade-off.
          </p>
        </Field>

        <Field label={`Prompt length · ${cfg.promptTokens.toLocaleString()} tokens`}>
          <input
            type="range"
            min={64}
            max={32768}
            step={64}
            value={cfg.promptTokens}
            onChange={(e) => set('promptTokens', Number(e.target.value))}
          />
        </Field>
        <Field label={`Answer length · ${cfg.outputTokens.toLocaleString()} tokens`}>
          <input
            type="range"
            min={64}
            max={8192}
            step={64}
            value={cfg.outputTokens}
            onChange={(e) => set('outputTokens', Number(e.target.value))}
          />
        </Field>
        <Field label={`Concurrent users batched · ${cfg.batchSize}`}>
          <input
            type="range"
            min={1}
            max={64}
            step={1}
            value={cfg.batchSize}
            onChange={(e) => set('batchSize', Number(e.target.value))}
          />
          <p className="field-blurb">
            Batching shares each weight-read across many users: system
            throughput soars, each individual stream slows slightly.
          </p>
        </Field>
      </Section>

      <Section title="2 · Silicon" hint="The chips doing the maths">
        <Field label="Accelerator (GPU / RDU)">
          <select value={cfg.accelId} onChange={(e) => set('accelId', e.target.value)}>
            {ACCELERATORS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.vendor} {a.name}
              </option>
            ))}
          </select>
          <p className="field-blurb">{acc.blurb}</p>
          <div className="mini-stats">
            <span>{acc.memGB}GB @ {acc.memBwTBs}TB/s</span>
            <span>{acc.tdpW}W TDP</span>
          </div>
        </Field>
        <Field
          label={`Accelerators · ${result.gpuCount} (min ${result.minGpus} to fit weights)`}
        >
          <input
            type="range"
            min={0}
            max={24}
            step={1}
            value={cfg.extraGpus}
            onChange={(e) => set('extraGpus', Number(e.target.value))}
          />
          <p className="field-blurb">
            Extra accelerators add bandwidth and compute, minus interconnect
            overhead — watch for diminishing returns.
          </p>
        </Field>
        <Field label="Host CPU">
          <select value={cfg.cpuId} onChange={(e) => set('cpuId', e.target.value)}>
            {CPUS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.vendor} {c.name}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="3 · Memory & storage" hint="Where weights and conversations live">
        <Field label="Weight storage tier">
          <select value={cfg.storageId} onChange={(e) => set('storageId', e.target.value)}>
            {STORAGE.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <p className="field-blurb">{simConfig.storage.blurb}</p>
        </Field>
        <Field label="KV cache placement">
          <div className="seg">
            {(
              [
                ['hbm', 'GPU HBM'],
                ['dram', 'Host DRAM'],
                ['nvme', 'NVMe'],
              ] as [KvPlacement, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                className={cfg.kvPlacement === k ? 'on' : ''}
                onClick={() => set('kvPlacement', k)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="field-blurb">
            The KV cache is the model’s memory of your conversation, re-read
            for every new token. Keep it in HBM unless it can’t fit.
          </p>
        </Field>
      </Section>

      <Section title="4 · Network" hint="Chip-to-chip and user-to-datacenter">
        <Field label="Cluster fabric">
          <select value={cfg.fabricId} onChange={(e) => set('fabricId', e.target.value)}>
            {FABRICS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.vendor} — {f.name}
              </option>
            ))}
          </select>
          <p className="field-blurb">{simConfig.fabric.blurb}</p>
        </Field>
        <Field label="User connectivity">
          <select value={cfg.wanId} onChange={(e) => set('wanId', e.target.value)}>
            {WAN.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <p className="field-blurb">{simConfig.wan.blurb}</p>
        </Field>
      </Section>

      <Section title="5 · Datacenter & cooling" hint="Power in, heat out">
        <Field label="Digital Realty campus">
          <select value={cfg.dcId} onChange={(e) => set('dcId', e.target.value)}>
            {DATACENTERS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="field-blurb">{simConfig.datacenter.blurb}</p>
          <div className="mini-stats">
            <span>${simConfig.datacenter.usdPerKwh}/kWh</span>
            <span>{simConfig.datacenter.gridCarbon} gCO₂/kWh</span>
            <span>{simConfig.datacenter.renewablePct}% renewable</span>
          </div>
        </Field>
        <Field label="Cooling technology">
          <select value={cfg.coolingId} onChange={(e) => set('coolingId', e.target.value)}>
            {COOLING.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="field-blurb">{simConfig.cooling.blurb}</p>
        </Field>
        <Field
          label={`GPU power limit · ${Math.round(cfg.powerLimitPct * 100)}% of TDP`}
        >
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={cfg.powerLimitPct}
            onChange={(e) => set('powerLimitPct', Number(e.target.value))}
          />
          <p className="field-blurb">
            Capping power costs less performance than it saves energy — the
            efficiency trick every operator uses.
          </p>
        </Field>
        <Field label={`Coolant setpoint · ${cfg.coolantSetpointC}°C`}>
          <input
            type="range"
            min={18}
            max={45}
            step={1}
            value={cfg.coolantSetpointC}
            onChange={(e) => set('coolantSetpointC', Number(e.target.value))}
          />
          <p className="field-blurb">
            Warmer coolant saves chiller energy (better PUE) but leaves less
            thermal headroom before the silicon throttles.
          </p>
        </Field>
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="cfg-section" open={defaultOpen}>
      <summary>
        <span className="cfg-title">{title}</span>
        <span className="cfg-hint">{hint}</span>
      </summary>
      <div className="cfg-body">{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
