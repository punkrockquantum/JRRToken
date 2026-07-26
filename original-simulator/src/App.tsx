import { useMemo, useState } from 'react';
import { ConfigPanel } from './components/ConfigPanel';
import { DeepDive } from './components/DeepDive';
import { Metrics } from './components/Metrics';
import { Pipeline } from './components/Pipeline';
import { SimpleView } from './components/SimpleView';
import { ACCELERATORS } from './data/accelerators';
import {
  COOLING,
  CPUS,
  DATACENTERS,
  FABRICS,
  STORAGE,
  WAN,
} from './data/infrastructure';
import { MODELS } from './data/models';
import type { KvPlacement, Quantization } from './data/types';
import { simulate, type SimConfig } from './simulation/engine';

export interface AppConfig {
  modelId: string;
  quant: Quantization;
  accelId: string;
  extraGpus: number;
  cpuId: string;
  storageId: string;
  kvPlacement: KvPlacement;
  fabricId: string;
  wanId: string;
  coolingId: string;
  dcId: string;
  powerLimitPct: number;
  coolantSetpointC: number;
  batchSize: number;
  promptTokens: number;
  outputTokens: number;
}

const DEFAULT_CONFIG: AppConfig = {
  modelId: 'deepseek-v3',
  quant: 'fp8',
  accelId: 'nvidia-h200',
  extraGpus: 0,
  cpuId: 'intel-xeon-8592',
  storageId: 'local-nvme',
  kvPlacement: 'hbm',
  fabricId: 'ib-ndr',
  wanId: 'servicefabric',
  coolingId: 'dlc',
  dcId: 'iad',
  powerLimitPct: 1,
  coolantSetpointC: 25,
  batchSize: 8,
  promptTokens: 512,
  outputTokens: 512,
};

const byId = <T extends { id: string }>(arr: T[], id: string): T =>
  arr.find((x) => x.id === id) ?? arr[0];

type View = 'simple' | 'explorer';

export default function App() {
  const [view, setView] = useState<View>('simple');
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);

  const simConfig: SimConfig = useMemo(
    () => ({
      model: byId(MODELS, cfg.modelId),
      quant: cfg.quant,
      accelerator: byId(ACCELERATORS, cfg.accelId),
      extraGpus: cfg.extraGpus,
      cpu: byId(CPUS, cfg.cpuId),
      storage: byId(STORAGE, cfg.storageId),
      kvPlacement: cfg.kvPlacement,
      fabric: byId(FABRICS, cfg.fabricId),
      wan: byId(WAN, cfg.wanId),
      cooling: byId(COOLING, cfg.coolingId),
      datacenter: byId(DATACENTERS, cfg.dcId),
      powerLimitPct: cfg.powerLimitPct,
      coolantSetpointC: cfg.coolantSetpointC,
      batchSize: cfg.batchSize,
      promptTokens: cfg.promptTokens,
      outputTokens: cfg.outputTokens,
    }),
    [cfg]
  );

  const result = useMemo(() => simulate(simConfig), [simConfig]);

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>
            Prompt <span className="accent">to</span> Compute{' '}
            <span className="accent">to</span> Tokens
          </h1>
          <p className="subtitle">
            An interactive simulator of the AI inference stack. Tune the
            hardware and watch the physics change the answer.
          </p>
        </div>
        <div className="header-badge">
          Modelled on Digital Realty datacenter &amp; connectivity profiles
        </div>
      </header>

      <nav className="view-tabs">
        <button
          className={view === 'simple' ? 'on' : ''}
          onClick={() => setView('simple')}
        >
          Simple view
          <span className="tab-sub">watch a prompt become an answer</span>
        </button>
        <button
          className={view === 'explorer' ? 'on' : ''}
          onClick={() => setView('explorer')}
        >
          Full stack explorer
          <span className="tab-sub">tune every layer of the infrastructure</span>
        </button>
      </nav>

      {view === 'simple' ? (
        <SimpleView />
      ) : (
        <div className="app-body">
          <aside className="sidebar">
            <ConfigPanel cfg={cfg} setCfg={setCfg} simConfig={simConfig} result={result} />
          </aside>

          <main className="main">
            <Pipeline cfg={simConfig} result={result} />
            <Metrics result={result} cfg={simConfig} />
            <DeepDive result={result} cfg={simConfig} />
          </main>
        </div>
      )}

      <footer className="app-footer">
        Figures come from public vendor datasheets and roofline-model physics;
        proprietary model sizes and street prices are labelled estimates.
        Educational tool &mdash; not a benchmark.
      </footer>
    </div>
  );
}
