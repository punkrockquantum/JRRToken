import { useState } from 'react';
import {
  CONTEXT,
  HARDWARE,
  KV,
  TOKENS_DAY,
  TTFT,
  USERS,
  WEIGHTS,
  type Opt,
} from '../data/explainerOptions';

/**
 * Explainer — live-session edition.
 *
 * Seven aspects, three choices each, zero sliders. Built to run on a
 * projector with 10-50 people: the facilitator (or a volunteer) clicks an
 * option and the room watches the memory bar, the verdicts and the
 * plain-English insights react instantly.
 */

const NETWORK_MS = 15;
const MAX_BATCH = 64;

function Aspect({
  name,
  what,
  options,
  selected,
  onSelect,
}: {
  name: string;
  what: string;
  options: Opt[];
  selected: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="aspect">
      <div className="aspect-head">
        <span className="aspect-name">{name}</span>
        <span className="aspect-what">{what}</span>
      </div>
      <div className="seg aspect-seg">
        {options.map((o, i) => (
          <button key={o.label} className={selected === i ? 'on' : ''} onClick={() => onSelect(i)}>
            <span className="aspect-opt-label">{o.label}</span>
            <span className="aspect-opt-sub">{o.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExplainerView() {
  const [wI, setWI] = useState(1);
  const [kvI, setKvI] = useState(2);
  const [ctxI, setCtxI] = useState(1);
  const [hwI, setHwI] = useState(1);
  const [uI, setUI] = useState(1);
  const [tI, setTI] = useState(1);
  const [tdI, setTdI] = useState(1);

  const weights = WEIGHTS[wI].value;
  const mbTok = KV[kvI].value;
  const ctx = CONTEXT[ctxI].value;
  const hw = HARDWARE[hwI];
  const devs = USERS[uI].value;
  const ttftTarget = TTFT[tI].value;
  const tokensDayTarget = TOKENS_DAY[tdI].value;

  // ---- the maths ----------------------------------------------------------
  const modelFits = weights < hw.value;
  const workspace = Math.max(0, hw.value - weights);
  const gbSession = (ctx * mbTok) / 1000;
  const cap = modelFits && gbSession > 0 ? Math.floor(workspace / gbSession) : 0;
  const demand = devs * gbSession;
  const oom = !modelFits || demand > workspace;
  const utilizationPct = workspace > 0 ? (demand / workspace) * 100 : 0;
  const wastedGB = Math.max(0, workspace - demand);

  const paramsB = weights / 2; // FP16
  const prefillMs = ((2 * paramsB * 1e9 * ctx) / (hw.tflops * 1e12)) * 1000;
  const ttft = prefillMs + NETWORK_MS;
  const ttftOk = ttft <= ttftTarget;

  const batch = Math.max(1, Math.min(devs, cap || 1, MAX_BATCH));
  const stepMs = (weights / hw.bwGBs) * 1000 + (batch * (gbSession * 0.5)) / (hw.bwGBs / 1000);
  const systemTps = stepMs > 0 ? (batch * 1000) / stepMs : 0;
  const tokensDayM = modelFits ? (systemTps * 86400) / 1e6 : 0;
  const tokensOk = tokensDayM >= tokensDayTarget;

  // Bar geometry.
  const barTotal = Math.max(hw.value, weights + demand);
  const weightsPct = (Math.min(weights, hw.value) / barTotal) * 100;
  const demandPct = (Math.min(demand, workspace) / barTotal) * 100;
  const overflowPct = !modelFits
    ? ((weights - hw.value) / barTotal) * 100
    : oom
      ? ((demand - workspace) / barTotal) * 100
      : 0;
  const freePct = Math.max(0, 100 - weightsPct - demandPct - overflowPct);

  // ---- verdicts & insights -------------------------------------------------
  const memoryVerdict = !modelFits
    ? 'MODEL DOES NOT FIT'
    : oom
      ? 'OUT OF MEMORY'
      : utilizationPct > 85
        ? 'REDLINED — EFFICIENT'
        : 'STABLE — HEADROOM';

  const insights: string[] = [];
  if (!modelFits) {
    insights.push(
      `The model alone needs ${weights} GB but the hardware only has ${hw.value.toLocaleString()} GB — zero users can connect. Bigger hardware or a smaller model; there is no third option.`
    );
  } else if (oom) {
    insights.push(
      `${devs.toLocaleString()} users need ${demand.toFixed(0)} GB of session memory but only ${workspace.toFixed(0)} GB exists after the weights. The real limit is ${cap.toLocaleString()} users — everyone else queues.`
    );
  } else if (utilizationPct > 85) {
    insights.push(
      `${utilizationPct.toFixed(0)}% of the memory is doing paid work — this is what an efficient deployment looks like. Cap: ${cap.toLocaleString()} users.`
    );
  } else {
    insights.push(
      `${wastedGB.toFixed(0)} GB (${(100 - utilizationPct).toFixed(0)}%) of paid-for memory sits idle. This node could serve ${cap.toLocaleString()} users — ${(cap - devs).toLocaleString()} more than planned.`
    );
  }
  if (kvI === 0) {
    insights.push(
      'The 0.044 rule-of-thumb makes every session look 7\u00d7 smaller than it really is at FP16 — capacity plans built on it crash in production. Click "Native FP16" to see the honest number.'
    );
  }
  if (kvI === 1) {
    insights.push(
      'Quantized KV halves the memory per session — which is exactly why product engineering banned it in the scenario: it trades precision for capacity.'
    );
  }
  insights.push(
    ttftOk
      ? `First token in ~${ttft.toFixed(0)} ms — inside the ${ttftTarget} ms promise with ${(ttftTarget - ttft).toFixed(0)} ms to spare.`
      : `Reading a ${ctx.toLocaleString()}-token context takes ~${ttft.toFixed(0)} ms — the ${ttftTarget} ms promise is broken before the first word appears. Context length is the TTFT lever.`
  );
  insights.push(
    tokensOk
      ? `~${tokensDayM.toFixed(0)}M tokens/day from this hardware — the ${tokensDayTarget}M target is met.`
      : `~${tokensDayM.toFixed(0)}M tokens/day vs a ${tokensDayTarget}M target — this is why real deployments buy more nodes, not bigger promises.`
  );

  return (
    <div className="explainer">
      <section className="panel">
        <div className="mb-eyebrow">Explainer — live session</div>
        <h2 className="mission-title">Seven choices. Three walls.</h2>
        <p className="mission-brief">
          Every AI deployment is governed by these seven choices, and they can
          hit three walls: memory, latency, throughput. Click any option and
          watch which wall moves.
        </p>

        <div className="aspect-grid">
          <Aspect name="1 · Base model weights" what="Memory the model locks up before a single user connects" options={WEIGHTS} selected={wI} onSelect={setWI} />
          <Aspect name="2 · KV cache density" what="Memory each token of conversation consumes" options={KV} selected={kvI} onSelect={setKvI} />
          <Aspect name="3 · Context window" what="How much conversation each user session holds" options={CONTEXT} selected={ctxI} onSelect={setCtxI} />
          <Aspect name="4 · Hardware" what="The total memory and compute budget" options={HARDWARE} selected={hwI} onSelect={setHwI} />
          <Aspect name="5 · Concurrent users" what="Sessions hitting this hardware at once" options={USERS} selected={uI} onSelect={setUI} />
          <Aspect name="6 · TTFT promise" what="How fast the first word must appear" options={TTFT} selected={tI} onSelect={setTI} />
          <Aspect name="7 · Tokens/day promise" what="Daily output committed to the business" options={TOKENS_DAY} selected={tdI} onSelect={setTdI} />
        </div>
      </section>

      <section className="panel">
        <div className="verdict-row">
          <div className={`verdict${oom ? ' bad' : ''}`}>
            <span className="verdict-v">{memoryVerdict}</span>
            <span className="verdict-k">memory</span>
          </div>
          <div className={`verdict${ttftOk ? '' : ' bad'}`}>
            <span className="verdict-v">{ttftOk ? 'ON TIME' : 'TOO SLOW'}</span>
            <span className="verdict-k">latency — ~{ttft.toFixed(0)} ms vs {ttftTarget} ms</span>
          </div>
          <div className={`verdict${tokensOk ? '' : ' bad'}`}>
            <span className="verdict-v">{tokensOk ? 'TARGET MET' : 'SHORTFALL'}</span>
            <span className="verdict-k">throughput — ~{tokensDayM.toFixed(0)}M vs {tokensDayTarget}M/day</span>
          </div>
        </div>

        <div className="mem-bar exp-bar">
          <div className="mem-weights" style={{ width: `${weightsPct}%` }}>
            Weights {weights} GB
          </div>
          {modelFits && demandPct > 3 && (
            <div className="mem-kv" style={{ width: `${demandPct}%` }}>
              Sessions {Math.min(demand, workspace).toFixed(0)} GB
            </div>
          )}
          {overflowPct > 0 && (
            <div className="exp-overflow" style={{ width: `${overflowPct}%` }}>
              {!modelFits
                ? `DOESN'T FIT +${(weights - hw.value).toFixed(0)} GB`
                : `OOM +${(demand - workspace).toFixed(0)} GB`}
            </div>
          )}
          {freePct > 3 && <div className="mem-free">free {wastedGB.toFixed(0)} GB</div>}
        </div>

        <div className="exp-stats">
          <div className="sv-stat">
            <span className="sv-stat-v">{gbSession.toFixed(2)} GB</span>
            <span className="sv-stat-k">per user session</span>
          </div>
          <div className="sv-stat">
            <span className="sv-stat-v">{cap.toLocaleString()}</span>
            <span className="sv-stat-k">max users on this hardware</span>
          </div>
          <div className="sv-stat">
            <span className={`sv-stat-v${oom ? ' exp-bad' : ''}`}>
              {!modelFits ? '\u2014' : oom ? 'OOM' : `${utilizationPct.toFixed(0)}%`}
            </span>
            <span className="sv-stat-k">memory utilisation</span>
          </div>
          <div className="sv-stat">
            <span className={`sv-stat-v${ttftOk ? '' : ' exp-bad'}`}>~{ttft.toFixed(0)} ms</span>
            <span className="sv-stat-k">time to first token</span>
          </div>
          <div className="sv-stat">
            <span className={`sv-stat-v${tokensOk ? '' : ' exp-bad'}`}>~{tokensDayM.toFixed(0)}M</span>
            <span className="sv-stat-k">tokens per day</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>What just happened</h2>
        <div className="tracka-rows">
          {insights.map((line, i) => (
            <div key={i} className="tracka-row exp-insight">
              <span className="tracka-k">{line}</span>
            </div>
          ))}
        </div>
        <p className="option-tagline">
          Session formula: context tokens &times; MB/token = GB per user &middot;
          (hardware &minus; weights) &divide; GB per user = the cap. Estimates
          assume H200-class silicon; the Full stack explorer runs the complete
          physics.
        </p>
      </section>
    </div>
  );
}
