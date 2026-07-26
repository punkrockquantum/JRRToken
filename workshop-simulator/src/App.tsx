import { useMemo, useState } from 'react';
import { ConfigPanel } from './components/ConfigPanel';
import { DeepDive } from './components/DeepDive';
import { Metrics } from './components/Metrics';
import { Pipeline } from './components/Pipeline';
import { ChallengeView } from './components/ChallengeView';
import { ExplainerView } from './components/ExplainerView';
import { TokenConsultant } from './components/TokenConsultant';
import { SimpleView } from './components/SimpleView';
import { TrackA } from './components/TrackA';
import { WorkshopView } from './components/WorkshopView';
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
  kvReusePct: number;
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

// Workshop scenario defaults: AuraCopilot on Llama 3.3 70B at native FP16
// (quantization banned by product engineering), H200 nodes, Ashburn hub,
// and a saturated 8,000-token user session (Track A drill).
const DEFAULT_CONFIG: AppConfig = {
  modelId: 'llama-3.3-70b',
  quant: 'fp16',
  accelId: 'nvidia-h200',
  extraGpus: 0,
  cpuId: 'intel-xeon-8592',
  storageId: 'local-nvme',
  kvPlacement: 'hbm',
  kvReusePct: 0,
  fabricId: 'roce-400',
  wanId: 'servicefabric',
  coolingId: 'rdhx',
  dcId: 'iad',
  powerLimitPct: 1,
  coolantSetpointC: 25,
  batchSize: 8,
  promptTokens: 7488,
  outputTokens: 512,
};

const byId = <T extends { id: string }>(arr: T[], id: string): T =>
  arr.find((x) => x.id === id) ?? arr[0];

type View = 'workshop' | 'explainer' | 'studio' | 'challenge' | 'simple' | 'explorer';

export default function App() {
  const [view, setView] = useState<View>('workshop');
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
      kvReusePct: cfg.kvReusePct,
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
            Sharp(er) Enterprises workshop edition — size the AuraCopilot
            launch: Llama 3.3 70B at native FP16 across the Ashburn,
            Frankfurt and Tokyo hubs.
          </p>
        </div>
        <div className="header-badge">
          Workshop scenario: 100M tokens/day per hub &middot; sub-100ms TTFT
          &middot; no quantization
        </div>
      </header>

      <nav className="view-tabs">
        <button
          className={view === 'workshop' ? 'on' : ''}
          onClick={() => setView('workshop')}
        >
          Workshop tracks A&ndash;E
          <span className="tab-sub">the Sharp(er) Enterprises exercise, option by option</span>
        </button>
        <button
          className={view === 'explainer' ? 'on' : ''}
          onClick={() => setView('explainer')}
        >
          Explainer
          <span className="tab-sub">visualise where the limits live</span>
        </button>
        <button
          className={view === 'studio' ? 'on' : ''}
          onClick={() => setView('studio')}
        >
          Sharp(er) Enterprises — Token Consultant
          <span className="tab-sub">build constraints, generate your pitch brief</span>
        </button>
        <button
          className={view === 'challenge' ? 'on' : ''}
          onClick={() => setView('challenge')}
        >
          Token Alchemy Challenge
          <span className="tab-sub">live judging terminal and leaderboard</span>
        </button>
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

      {view === 'workshop' ? (
        <WorkshopView />
      ) : view === 'explainer' ? (
        <ExplainerView />
      ) : view === 'studio' ? (
        <TokenConsultant />
      ) : view === 'challenge' ? (
        <ChallengeView />
      ) : view === 'simple' ? (
        <SimpleView />
      ) : (
        <div className="app-body">
          <aside className="sidebar">
            <ConfigPanel cfg={cfg} setCfg={setCfg} simConfig={simConfig} result={result} />
          </aside>

          <main className="main">
            <Pipeline cfg={simConfig} result={result} />
            <TrackA cfg={simConfig} result={result} />
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
