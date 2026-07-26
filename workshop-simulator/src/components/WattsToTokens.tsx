import { useEffect, useRef, useState } from 'react';
import type { UseCase } from '../data/useCases';
import type { SimConfig, SimResult } from '../simulation/engine';

/**
 * Watts-to-tokens: animates the energy chain (grid, PUE overhead, IT load,
 * accelerators, heat) alongside a live prompt-to-token stream for the
 * selected use case, so each track can see electricity being converted
 * into tokens step by step.
 */

type Phase = 'idle' | 'prefill' | 'decode' | 'done';

export function WattsToTokens({
  cfg,
  result,
  useCase,
}: {
  cfg: SimConfig;
  result: SimResult;
  useCase: UseCase;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [tokens, setTokens] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    setPhase('idle');
    setTokens(0);
    cancelAnimationFrame(raf.current);
  }, [useCase.id, cfg.accelerator.id, cfg.fabric.id]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const run = () => {
    cancelAnimationFrame(raf.current);
    setTokens(0);
    const prefillScreenMs = 1200;
    const decodeScreenMs = 5500;
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      if (t < prefillScreenMs) {
        setPhase('prefill');
      } else if (t < prefillScreenMs + decodeScreenMs) {
        setPhase('decode');
        const frac = (t - prefillScreenMs) / decodeScreenMs;
        setTokens(Math.floor(frac * useCase.outputTokens));
      } else {
        setPhase('done');
        setTokens(useCase.outputTokens);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const live = phase === 'prefill' || phase === 'decode';
  const overheadKw = result.facilityPowerKw - result.itPowerKw;
  const joulesPerToken = result.energyWhPer1kTokens * 3.6;
  const answerWh = (result.energyWhPer1kTokens * useCase.outputTokens) / 1000;
  const spentWh = (result.energyWhPer1kTokens * tokens) / 1000;
  const ledSeconds = Math.round((answerWh * 3600) / 10);

  const chain: { id: string; label: string; value: string; sub: string }[] = [
    {
      id: 'grid',
      label: 'Grid feed',
      value: `${result.facilityPowerKw.toFixed(1)} kW`,
      sub: `${cfg.datacenter.metro} tariff $${cfg.datacenter.usdPerKwh.toFixed(3)}/kWh`,
    },
    {
      id: 'overhead',
      label: 'Cooling + distribution',
      value: `${overheadKw.toFixed(1)} kW`,
      sub: `PUE ${result.pue.toFixed(2)} overhead`,
    },
    {
      id: 'it',
      label: 'IT load',
      value: `${result.itPowerKw.toFixed(1)} kW`,
      sub: `${result.gpuCount}\u00d7 ${cfg.accelerator.name} + hosts`,
    },
    {
      id: 'gpu',
      label: 'Accelerators',
      value: `${Math.round(result.sustainedWPerGpu)} W each`,
      sub:
        result.throttleFactor < 1
          ? `throttled to ${Math.round(result.throttleFactor * 100)}%`
          : 'at full sustained power',
    },
    {
      id: 'tokens',
      label: 'Tokens out',
      value: `${result.systemTps.toFixed(0)} tok/s`,
      sub: `${joulesPerToken.toFixed(1)} J per token`,
    },
    {
      id: 'heat',
      label: 'Heat out',
      value: `${result.itPowerKw.toFixed(1)} kW`,
      sub: `100% of IT watts \u2192 ${cfg.cooling.name.toLowerCase()}`,
    },
  ];

  return (
    <div className="w2t">
      {/* Go row first: the facilitator hits this before anything else. */}
      <div className="w2t-prompt w2t-toprow">
        <button className="run-btn big" onClick={run} disabled={live}>
          {live ? 'Running the journey' : phase === 'done' ? 'Go — run it again' : 'Go — run the journey'}
        </button>
        <span className="w2t-prompt-label">Prompt ({useCase.name})</span>
        <span className="w2t-prompt-text">&ldquo;{useCase.samplePrompt}&rdquo;</span>
      </div>

      <div className="w2t-meters w2t-headline">
        <div className={`w2t-meter${live ? ' active' : ''}`}>
          <span className="w2t-meter-k">TTFT — the latency that matters</span>
          <span className="w2t-meter-v">
            {result.ttftMs < 1000
              ? `${result.ttftMs.toFixed(0)} ms`
              : `${(result.ttftMs / 1000).toFixed(2)} s`}
          </span>
        </div>
        <div className={`w2t-meter${live ? ' active' : ''}`}>
          <span className="w2t-meter-k">Token value — all-in cost per 1M</span>
          <span className="w2t-meter-v">${result.costPer1MTokensUSD.toFixed(2)}</span>
        </div>
        <div className={`w2t-meter${live ? ' active' : ''}`}>
          <span className="w2t-meter-k">Per-stream speed</span>
          <span className="w2t-meter-v">{result.perUserTps.toFixed(0)} tok/s</span>
        </div>
      </div>

      <div className="w2t-chain">
        {chain.map((n, i) => (
          <div key={n.id} className="w2t-step">
            <div className={`w2t-node${live ? ' live' : ''} w2t-${n.id}`}>
              <span className="w2t-label">{n.label}</span>
              <span className="w2t-value">{n.value}</span>
              <span className="w2t-sub">{n.sub}</span>
            </div>
            {i < chain.length - 1 && (
              <div className={`w2t-arrow${live ? ' live' : ''}`}>
                <span className="w2t-dot" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="w2t-demo">
        <div className="w2t-meters">
          <div className={`w2t-meter${phase === 'prefill' ? ' active' : ''}`}>
            <span className="w2t-meter-k">Prefill</span>
            <span className="w2t-meter-v">
              {useCase.promptTokens.toLocaleString()} tokens read
            </span>
          </div>
          <div className={`w2t-meter${phase === 'decode' ? ' active' : ''}`}>
            <span className="w2t-meter-k">Decode</span>
            <span className="w2t-meter-v">
              {tokens.toLocaleString()} / {useCase.outputTokens.toLocaleString()} tokens
            </span>
          </div>
          <div className={`w2t-meter${live ? ' active' : ''}`}>
            <span className="w2t-meter-k">Energy this answer</span>
            <span className="w2t-meter-v">
              {(phase === 'done' ? answerWh : spentWh).toFixed(2)} Wh
            </span>
          </div>
        </div>

        <div className="w2t-streambar">
          <div
            className="w2t-streamfill"
            style={{ width: `${(tokens / useCase.outputTokens) * 100}%` }}
          />
        </div>

        <p className="w2t-note">
          {useCase.flowNote}{' '}
          {phase === 'done' && (
            <>
              This answer: {useCase.outputTokens.toLocaleString()} tokens,{' '}
              {answerWh.toFixed(2)} Wh &mdash; an LED bulb for ~{ledSeconds} s. At{' '}
              {result.perUserTps.toFixed(0)} tok/s per stream, TTFT{' '}
              {result.ttftMs < 1000
                ? `${result.ttftMs.toFixed(0)} ms`
                : `${(result.ttftMs / 1000).toFixed(2)} s`}
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}
