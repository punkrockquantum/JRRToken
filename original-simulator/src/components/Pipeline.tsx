import { useEffect, useRef, useState } from 'react';
import type { SimConfig, SimResult } from '../simulation/engine';

/**
 * Animated journey of one prompt: user -> CPU -> network -> datacenter
 * (prefill then decode) -> tokens streaming back. Phase lengths on screen
 * are log-scaled from the simulated timings so both a 3ms hop and a 20s
 * generation stay watchable.
 */

type Phase = 'idle' | 'tokenize' | 'network' | 'prefill' | 'decode' | 'done';

const SAMPLE_PROMPT = 'Explain how a datacenter turns my question into an answer.';
const SAMPLE_OUTPUT =
  'Your question was split into tokens, raced through fibre to a GPU hall, and every word you are reading was produced by streaming billions of model weights out of high-bandwidth memory \u2014 once per token. The speed you see is set less by raw compute than by memory bandwidth, cooling headroom and the network path back to you.'.split(
    ' '
  );

function phaseScreenMs(actualMs: number): number {
  if (actualMs <= 0) return 300;
  return Math.min(4000, Math.max(500, 400 * Math.log10(actualMs + 10) * 2));
}

function fmtMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}\u00b5s`;
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 1 : 0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Pipeline({ cfg, result }: { cfg: SimConfig; result: SimResult }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [wordsShown, setWordsShown] = useState(0);
  const [tokenCount, setTokenCount] = useState(0);
  const raf = useRef(0);

  const stageMs: Record<string, number> = {};
  for (const s of result.stages) stageMs[s.id] = s.ms;

  const run = () => {
    cancelAnimationFrame(raf.current);
    setWordsShown(0);
    setTokenCount(0);

    const seq: { phase: Phase; screenMs: number }[] = [
      { phase: 'tokenize', screenMs: phaseScreenMs(stageMs.tokenize) },
      { phase: 'network', screenMs: phaseScreenMs(stageMs.network) },
      { phase: 'prefill', screenMs: phaseScreenMs(stageMs.prefill) },
      { phase: 'decode', screenMs: phaseScreenMs(stageMs.decode) + 2500 },
    ];
    const start = performance.now();
    let decodeStart = -1;

    const tick = (now: number) => {
      let t = now - start;
      let current: Phase = 'done';
      for (const step of seq) {
        if (t < step.screenMs) {
          current = step.phase;
          break;
        }
        t -= step.screenMs;
      }
      setPhase(current);
      if (current === 'decode') {
        if (decodeStart < 0) decodeStart = now;
        const decodeElapsed = (now - decodeStart) / 1000;
        // Words appear at a readable pace; the counter runs at true speed.
        const wordRate = Math.min(18, Math.max(2, result.perUserTps));
        setWordsShown(Math.min(SAMPLE_OUTPUT.length, Math.floor(decodeElapsed * wordRate)));
        setTokenCount(Math.floor(decodeElapsed * result.perUserTps));
      }
      if (current !== 'done') {
        raf.current = requestAnimationFrame(tick);
      } else {
        setWordsShown(SAMPLE_OUTPUT.length);
        setTokenCount(cfg.outputTokens);
      }
    };
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const active = (p: Phase | Phase[]) =>
    (Array.isArray(p) ? p : [p]).includes(phase) ? ' active' : '';

  const computing = phase === 'prefill' || phase === 'decode';
  const powerPct = Math.min(
    100,
    (result.sustainedWPerGpu / cfg.accelerator.tdpW) * 100
  );

  return (
    <section className="panel pipeline">
      <div className="panel-title-row">
        <h2>The journey of a prompt</h2>
        <button className="run-btn" onClick={run}>
          {phase === 'idle' || phase === 'done' ? 'Send a prompt' : 'Replay'}
        </button>
      </div>

      <div className="flow">
        {/* USER */}
        <div className={`flow-node user${active(['tokenize', 'idle'])}`}>
          <div className="node-label">You</div>
          <div className="node-sub">&ldquo;{SAMPLE_PROMPT.slice(0, 26)}&hellip;&rdquo;</div>
        </div>

        <FlowLink
          label="Tokenise"
          sub={`${cfg.cpu.vendor} CPU \u00b7 ${fmtMs(stageMs.tokenize)}`}
          on={phase === 'tokenize'}
        />

        {/* CPU */}
        <div className={`flow-node${active('tokenize')}`}>
          <div className="node-label">Tokenizer</div>
          <div className="node-sub">
            {cfg.promptTokens.toLocaleString()} tokens
          </div>
        </div>

        <FlowLink
          label="Network"
          sub={`${cfg.wan.name.split('(')[0].trim()} \u00b7 ${fmtMs(stageMs.network)}`}
          on={phase === 'network'}
        />

        {/* DATACENTER */}
        <div className={`flow-dc${computing ? ' active' : ''}`}>
          <div className="dc-header">
            <span className="dc-name">{cfg.datacenter.name}</span>
            <span className="dc-pue">PUE {result.pue.toFixed(2)}</span>
          </div>

          <div className="dc-inner">
            <div className="gpu-grid">
              {Array.from({ length: Math.min(result.gpuCount, 16) }).map((_, i) => (
                <div
                  key={i}
                  className={`gpu-cell${computing ? ' hot' : ''}`}
                  style={{ animationDelay: `${(i % 8) * 90}ms` }}
                  title={cfg.accelerator.name}
                />
              ))}
              {result.gpuCount > 16 && (
                <div className="gpu-more">+{result.gpuCount - 16}</div>
              )}
            </div>
            <div className="dc-meta">
              <div className="dc-meta-row">
                <span>{result.gpuCount}&times; {cfg.accelerator.name}</span>
              </div>
              <div className="dc-meta-row phase-row">
                <span className={`chip${active('prefill')}`}>
                  Prefill {fmtMs(stageMs.prefill)}
                </span>
                <span className={`chip${active('decode')}`}>
                  Decode {fmtMs(stageMs.decode)}
                </span>
              </div>
              <div className="power-bar" title="Sustained power vs TDP per accelerator">
                <div
                  className={`power-fill${computing ? ' pulsing' : ''}`}
                  style={{ width: `${powerPct}%` }}
                />
                <span className="power-label">
                  {Math.round(result.sustainedWPerGpu)}W / {cfg.accelerator.tdpW}W
                  {result.throttleFactor < 1 &&
                    ` \u00b7 throttled ${Math.round(result.throttleFactor * 100)}%`}
                </span>
              </div>
              <div className="cooling-row">
                <span className={`cooling-badge${computing ? ' flowing' : ''}`}>
                  {cfg.cooling.name}
                </span>
              </div>
            </div>
          </div>
        </div>

        <FlowLink
          label="Stream"
          sub={`${result.perUserTps.toFixed(1)} tok/s`}
          on={phase === 'decode'}
          reverse
        />

        {/* OUTPUT */}
        <div className={`flow-node${active('decode')}${phase === 'done' ? ' active' : ''}`}>
          <div className="node-label">Answer</div>
          <div className="node-sub">
            {phase === 'idle' ? '\u2014' : `${tokenCount.toLocaleString()} tokens`}
          </div>
        </div>
      </div>

      {/* Token stream */}
      <div className={`token-stream${phase === 'idle' ? ' empty' : ''}`}>
        {phase === 'idle' ? (
          <span className="stream-hint">
            Press &ldquo;Send a prompt&rdquo; to watch words become tokens, tokens
            become GPU work, and GPU work become words again.
          </span>
        ) : (
          <>
            {SAMPLE_OUTPUT.slice(0, wordsShown).map((w, i) => (
              <span key={i} className="tok">
                {w}{' '}
              </span>
            ))}
            {(phase === 'decode' || phase === 'prefill') && <span className="cursor" />}
          </>
        )}
      </div>

      {/* Timeline bar */}
      <div className="timeline">
        {result.stages
          .filter((s) => s.ms > 0)
          .map((s) => {
            const total = result.stages.reduce((a, b) => a + Math.max(0.1, b.ms), 0);
            const pct = Math.max(4, (s.ms / total) * 100);
            return (
              <div
                key={s.id}
                className={`tl-seg tl-${s.id}${phase === s.id ? ' active' : ''}`}
                style={{ flexGrow: pct }}
                title={`${s.label}: ${fmtMs(s.ms)}`}
              >
                <span className="tl-label">{s.label}</span>
                <span className="tl-ms">{fmtMs(s.ms)}</span>
              </div>
            );
          })}
      </div>
      <p className="timeline-caption">
        Where the {fmtMs(result.totalRequestMs)} of a full request actually goes
        (bar widths proportional to time).
      </p>
    </section>
  );
}

function FlowLink({
  label,
  sub,
  on,
  reverse,
}: {
  label: string;
  sub: string;
  on: boolean;
  reverse?: boolean;
}) {
  return (
    <div className={`flow-link${on ? ' on' : ''}${reverse ? ' reverse' : ''}`}>
      <div className="link-track">
        <span className="packet" />
        <span className="packet p2" />
        <span className="packet p3" />
      </div>
      <div className="link-label">{label}</div>
      <div className="link-sub">{sub}</div>
    </div>
  );
}
