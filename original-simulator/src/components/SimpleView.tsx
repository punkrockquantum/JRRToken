import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { ModelSpec } from '../data/types';
import { simulate } from '../simulation/engine';
import { DEMO_MODELS, type DemoSpec } from '../simple/demoModels';
import {
  composeResponse,
  makeLogits,
  STOPWORDS,
  type LogitCandidate,
} from '../simple/respond';
import { tokenId, tokenize } from '../simple/tokenize';

/**
 * Beginner mode: build a custom prompt, then follow it through the whole
 * process — tokenizer, embeddings (meaning), the neural network's weights
 * and biases, the transformer's attention and experts, the next-token
 * prediction loop, and the growing context — as an answer streams out.
 *
 * The demonstration model is switchable between DeepSeek, Mistral, OpenAI
 * and Anthropic; every architecture number in the visualisation follows
 * the selection (see src/simple/demoModels.ts).
 */

type Phase = 'idle' | 'tokenizing' | 'embedding' | 'prefill' | 'decode' | 'done';

const LAYERS_SHOWN = 8;
const EXPERT_CELLS = 64; // visual stand-ins for the routed experts per layer
const ACTIVE_EXPERTS = 8; // illustrative firing count in the grid
const DECODE_STEP_MS = 150;

const DEFAULT_PROMPT = 'Why is the sky blue?';

function modelFacts(m: ModelSpec, s: DemoSpec) {
  return [
    { k: `${m.totalParamsB}B`, v: 'total parameters' },
    { k: `${m.activeParamsB}B`, v: 'active per token' },
    { k: `${s.layers}`, v: 'transformer layers' },
    { k: `${s.heads}`, v: 'attention heads / layer' },
    s.expertsTotal
      ? {
          k: s.sharedExperts ? `${s.expertsTotal}+${s.sharedExperts}` : `${s.expertsTotal}`,
          v: `experts / layer (${s.expertsActive + s.sharedExperts} fire)`,
        }
      : { k: 'dense', v: 'all parameters, every token' },
    { k: `${Math.round(s.vocab / 1000)}k`, v: 'vocabulary tokens' },
  ];
}

const STEPPER: { id: Phase; label: string; sub: string }[] = [
  { id: 'tokenizing', label: 'Tokens', sub: 'text becomes token IDs' },
  { id: 'embedding', label: 'Meaning', sub: 'IDs become vectors' },
  { id: 'prefill', label: 'Prefill', sub: 'whole prompt, in parallel' },
  { id: 'decode', label: 'Decode', sub: 'one token per pass' },
  { id: 'done', label: 'Answer', sub: 'tokens become words' },
];

/** Content words earn attention; filler words mostly don't. */
function attentionWeight(token: string): number {
  const core = token.replace(/[^a-zA-Z0-9']/g, '').toLowerCase();
  const filler = core.length <= 2 || STOPWORDS.has(core);
  const base = filler ? 0.1 : 0.5;
  return Math.min(1, base + Math.random() * (filler ? 0.18 : 0.5));
}

const byId = <T extends { id: string }>(arr: T[], id: string): T =>
  arr.find((x) => x.id === id) ?? arr[0];

function randomExperts(): number[] {
  const set = new Set<number>();
  while (set.size < ACTIVE_EXPERTS) set.add(Math.floor(Math.random() * EXPERT_CELLS));
  return [...set];
}

export function SimpleView() {
  const [specId, setSpecId] = useState('deepseek');
  const spec = byId(DEMO_MODELS, specId);
  const model = byId(MODELS, spec.modelId);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [phase, setPhase] = useState<Phase>('idle');
  const [promptToks, setPromptToks] = useState<string[]>([]);
  const [shownPromptToks, setShownPromptToks] = useState(0);
  const [outWords, setOutWords] = useState<string[]>([]);
  const [shownWords, setShownWords] = useState(0);
  const [logits, setLogits] = useState<LogitCandidate[]>([]);
  const [wasSampled, setWasSampled] = useState(false);
  const [experts, setExperts] = useState<number[]>(randomExperts);
  const [attention, setAttention] = useState<number[]>([]);
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);

  const sim = useMemo(
    () =>
      simulate({
        model,
        quant: 'fp8',
        accelerator: byId(ACCELERATORS, 'nvidia-h200'),
        extraGpus: 2,
        cpu: byId(CPUS, 'nvidia-grace'),
        storage: byId(STORAGE, 'local-nvme'),
        kvPlacement: 'hbm',
        fabric: byId(FABRICS, 'ib-ndr'),
        wan: byId(WAN, 'servicefabric'),
        cooling: byId(COOLING, 'dlc'),
        datacenter: byId(DATACENTERS, 'iad'),
        powerLimitPct: 1,
        coolantSetpointC: 25,
        batchSize: 8,
        promptTokens: Math.max(8, promptToks.length),
        outputTokens: Math.max(64, outWords.length),
      }),
    [model, promptToks.length, outWords.length]
  );

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const reset = () => {
    clearTimers();
    setPhase('idle');
    setPromptToks([]);
    setShownPromptToks(0);
    setOutWords([]);
    setShownWords(0);
    setLogits([]);
    setStep(0);
  };

  const selectModel = (id: string) => {
    if (busy) return;
    reset();
    setSpecId(id);
  };

  const generate = () => {
    clearTimers();
    const toks = tokenize(prompt || DEFAULT_PROMPT);
    const response = composeResponse(prompt || DEFAULT_PROMPT, toks.length, spec);
    const promptWords = (prompt.toLowerCase().match(/[a-z0-9']+/g) ?? []).slice(0, 12);

    setPromptToks(toks);
    setShownPromptToks(0);
    setOutWords(response.words);
    setShownWords(0);
    setLogits([]);
    setStep(0);

    // 1 — tokenize: prompt pieces appear one by one
    setPhase('tokenizing');
    const tokMs = Math.min(60, 1200 / toks.length);
    toks.forEach((_, i) => later(() => setShownPromptToks(i + 1), i * tokMs));
    const tokenizeDone = toks.length * tokMs + 250;

    // 2 — embedding: tokens become vectors with meaning
    later(() => setPhase('embedding'), tokenizeDone);

    // 3 — prefill: whole prompt sweeps through the stack at once
    later(() => setPhase('prefill'), tokenizeDone + 1600);

    // 4 — decode: one token out per step, fed back in
    const decodeStart = tokenizeDone + 1600 + 1500;
    later(() => setPhase('decode'), decodeStart);
    response.words.forEach((w, i) =>
      later(() => {
        // ~1 in 5 steps demonstrates sampling picking a non-favourite token.
        const sampled = Math.random() < 0.2;
        setStep(i + 1);
        setExperts(randomExperts());
        setLogits(makeLogits(w, promptWords, { sampled }));
        setWasSampled(sampled);
        setAttention(toks.map(attentionWeight));
        setShownWords(i + 1);
      }, decodeStart + i * DECODE_STEP_MS)
    );

    later(() => setPhase('done'), decodeStart + response.words.length * DECODE_STEP_MS + 300);
  };

  const busy = phase !== 'idle' && phase !== 'done';
  const answerWh = (sim.energyWhPer1kTokens * outWords.length) / 1000;

  const contextTokens = promptToks.length + shownWords;
  const contextTotal = Math.max(1, promptToks.length + outWords.length);
  const kvMB = (contextTokens * model.kvKBPerToken) / 1024;

  const phaseIndex = STEPPER.findIndex((s) => s.id === phase);

  return (
    <div className="simple">
      {/* ---- the one demo model ---- */}
      <section className="panel model-banner">
        <div className="mb-left">
          <div className="mb-eyebrow">Demonstration model</div>
          <div className="seg vendor-seg">
            {DEMO_MODELS.map((d) => (
              <button
                key={d.id}
                className={specId === d.id ? 'on' : ''}
                onClick={() => selectModel(d.id)}
                disabled={busy}
              >
                {d.vendor}
              </button>
            ))}
          </div>
          <h2>{model.name}</h2>
          <p className="mb-blurb">
            {spec.estimated
              ? 'This vendor does not publish its architecture, so the numbers below are labelled industry estimates.'
              : 'An open-architecture model, so every number below is real.'}{' '}
            It is a <strong>transformer</strong>: a neural network that reads
            all its input at once, then writes its answer strictly one token
            at a time.
          </p>
        </div>
        <div className="mb-facts">
          {modelFacts(model, spec).map((f) => (
            <div key={f.v} className="mb-fact">
              <span className="mb-k">{f.k}</span>
              <span className="mb-v">
                {f.v}
                {spec.estimated ? ' (est.)' : ''}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- progress stepper ---- */}
      <div className="stepper">
        {STEPPER.map((s, i) => (
          <div
            key={s.id}
            className={`stepper-item${phase === s.id ? ' now' : ''}${
              phaseIndex > i || phase === 'done' ? ' past' : ''
            }`}
          >
            <span className="stepper-label">{s.label}</span>
            <span className="stepper-sub">{s.sub}</span>
          </div>
        ))}
      </div>

      {/* ---- 1: prompt in ---- */}
      <section className="panel">
        <h2>
          <span className="step-num">1</span> Build your prompt
        </h2>
        <div className="prompt-row">
          <textarea
            className="prompt-input"
            rows={2}
            value={prompt}
            maxLength={280}
            placeholder="Ask anything, in your own words"
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
          />
          <button className="run-btn big" onClick={generate} disabled={busy}>
            {busy ? 'Generating' : phase === 'done' ? 'Generate again' : 'Generate'}
          </button>
        </div>

        <div className={`sv-stage${phase === 'tokenizing' ? ' live' : ''}`}>
          <div className="sv-stage-title">
            Tokenizer — text becomes token IDs
            {promptToks.length > 0 && (
              <span className="sv-count">
                {shownPromptToks}/{promptToks.length} tokens
              </span>
            )}
          </div>
          <div className="tok-chips">
            {phase === 'idle' ? (
              <span className="stream-hint">
                The model never sees letters. Text is first chopped into
                subword pieces called tokens, and each piece has a fixed
                integer ID in the model&rsquo;s vocabulary.
              </span>
            ) : (
              promptToks.slice(0, shownPromptToks).map((t, i) => (
                <span key={i} className="tchip">
                  <span className="tchip-t">{t}</span>
                  <span className="tchip-id">{tokenId(t, spec.vocab).toLocaleString()}</span>
                </span>
              ))
            )}
          </div>
          {phase !== 'idle' && (
            <p className="net-hint">
              Each piece carries its position in the{' '}
              {spec.vocab.toLocaleString()}-token vocabulary (IDs shown here
              are illustrative). From this point on, the model works only
              with these integers.
            </p>
          )}
        </div>
      </section>

      {/* ---- 2: meaning ---- */}
      <section className={`panel${phase === 'embedding' ? ' computing' : ''}`}>
        <h2>
          <span className="step-num">2</span> Tokens become meaning
          {phase === 'embedding' && <span className="phase-tag">embedding your prompt</span>}
        </h2>
        <div className="net-detail">
          <div className="net-card">
            <div className="net-card-title">
              Each ID looks up {spec.dModel.toLocaleString()} numbers
            </div>
            <div className={`embed-demo${phase === 'embedding' ? ' live' : ''}`}>
              <span className="tchip">
                <span className="tchip-t">{promptToks[0] ?? 'sky'}</span>
                <span className="tchip-id">
                  {tokenId(promptToks[0] ?? 'sky', spec.vocab).toLocaleString()}
                </span>
              </span>
              <span className="embed-becomes">looks up row</span>
              <span className="embed-vec">[0.31, &minus;0.87, 1.04, 0.02, &hellip;]</span>
            </div>
            <p className="net-hint">
              The ID selects one row of the <strong>embedding matrix</strong> —
              a learned table with {spec.vocab.toLocaleString()} rows and{' '}
              {spec.dModel.toLocaleString()} columns. A positional signal is
              then mixed in so the model knows word order:{' '}
              <em>dog bites man</em> must not equal <em>man bites dog</em>.
            </p>
          </div>
          <div className="net-card">
            <div className="net-card-title">Meaning is geometry</div>
            <SemanticMap live={phase === 'embedding'} />
            <p className="net-hint">
              Words with similar meanings get similar numbers, so they sit
              near each other in this space — and directions carry meaning:
              the step from <em>man</em> to <em>woman</em> is the same step
              as <em>king</em> to <em>queen</em>. This is what lets the model
              relate ideas it has never seen side by side.
            </p>
          </div>
        </div>
      </section>

      {/* ---- 3: the neural network ---- */}
      <section className={`panel${phase === 'prefill' || phase === 'decode' ? ' computing' : ''}`}>
        <h2>
          <span className="step-num">3</span> Through the neural network
          {phase === 'prefill' && (
            <span className="phase-tag">
              prefill — all {promptToks.length} tokens at once, in parallel
            </span>
          )}
          {phase === 'decode' && (
            <span className="phase-tag">decode — token {step}, one pass each</span>
          )}
        </h2>

        <div className="net-detail">
          <div className="net-card">
            <div className="net-card-title">Weights and biases — the learned numbers</div>
            <NeuronDiagram live={phase === 'decode' || phase === 'prefill'} />
            <p className="net-hint">
              Every connection multiplies its input by a <strong>weight</strong>;
              every neuron then adds a <strong>bias</strong> and passes the
              result on. That is the whole trick — repeated{' '}
              {model.totalParamsB >= 1000
                ? `${(model.totalParamsB / 1000).toFixed(1)} trillion`
                : `${Math.round(model.totalParamsB)} billion`}{' '}
              times.
            </p>
          </div>
          <div className="net-card">
            <div className="net-card-title">Where the weights came from: training</div>
            <p className="net-hint train-note">
              Months before you typed anything, this network practised on
              trillions of words: guess the next token, compare with the real
              one, nudge every one of its{' '}
              {model.totalParamsB >= 1000
                ? `${(model.totalParamsB / 1000).toFixed(1)} trillion`
                : `${Math.round(model.totalParamsB)} billion`}{' '}
              weights a tiny bit, repeat. That was <strong>training</strong>,
              and it consumed thousands of GPUs for weeks. What runs for you
              now is <strong>inference</strong> — the weights are frozen;
              answering you only reads them.
            </p>
          </div>
        </div>

        <div className="layer-stack" key={phase === 'decode' ? `d${step}` : phase}>
          {Array.from({ length: LAYERS_SHOWN }).map((_, i) => {
            const per = spec.layers / LAYERS_SHOWN;
            const from = Math.floor(i * per) + 1;
            const to = Math.floor((i + 1) * per);
            return (
              <div
                key={i}
                className={`layer-block${phase === 'prefill' ? ' sweep-slow' : ''}${
                  phase === 'decode' ? ' sweep-fast' : ''
                }`}
                style={{ animationDelay: `${i * (phase === 'prefill' ? 150 : 14)}ms` }}
                title={`Layers ${from} to ${to} of ${spec.layers}`}
              >
                {from}&ndash;{to}
              </div>
            );
          })}
          <div className="layer-note">
            The model stacks {spec.layers} identical layers; each box here
            stands for a block of them (for example &ldquo;
            {Math.floor(spec.layers / LAYERS_SHOWN) + 1}&ndash;
            {Math.floor((2 * spec.layers) / LAYERS_SHOWN)}&rdquo; means layers{' '}
            {Math.floor(spec.layers / LAYERS_SHOWN) + 1} through{' '}
            {Math.floor((2 * spec.layers) / LAYERS_SHOWN)}). Your prompt
            enters at layer 1, and each layer refines the result of the one
            before it. During <strong>prefill</strong> every prompt token
            moves through together in parallel; during <strong>decode</strong>{' '}
            each new token needs its own full pass.
          </div>
        </div>

        <p className="inside-layer-note">
          Inside every one of the {spec.layers} layers, two sub-steps run in
          order — attention gathers context, then a feed-forward network
          transforms it — and each sub-step&rsquo;s output is added back onto
          a running &ldquo;residual stream&rdquo;:
        </p>

        <div className="net-detail">
          <div className="net-card">
            <div className="net-card-title">
              Sub-step A &middot; Attention — what is it looking at?
            </div>
            {phase === 'decode' && promptToks.length > 0 ? (
              <div className="attn-bars">
                {promptToks.slice(0, 14).map((t, i) => (
                  <div key={i} className="attn-col" title={t}>
                    <div
                      className="attn-bar"
                      style={{ height: `${(attention[i] ?? 0.2) * 100}%` }}
                    />
                    <span className="attn-tok">{t.slice(0, 6)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="net-hint">
                Each token broadcasts what it is looking for (its{' '}
                <em>query</em>) and what it can offer (its <em>key</em>); how
                well they match sets how much information flows between them.
                {' '}{spec.heads} heads per layer run this matching in
                parallel. Bars appear over your own words while it writes —
                content words typically earn more attention than filler.
              </p>
            )}
          </div>

          <div className="net-card">
            <div className="net-card-title">
              {spec.expertsTotal
                ? `Sub-step B \u00b7 Feed-forward experts — only ${
                    spec.expertsActive + spec.sharedExperts
                  } of ${spec.expertsTotal + spec.sharedExperts} wake up`
                : 'Sub-step B \u00b7 Dense feed-forward — everything wakes up'}
            </div>
            <div className="expert-grid">
              {Array.from({ length: EXPERT_CELLS }).map((_, i) => (
                <div
                  key={i}
                  className={`expert-cell${
                    phase === 'decode' &&
                    (spec.expertsTotal ? experts.includes(i) : true)
                      ? spec.expertsTotal
                        ? ' firing'
                        : ' dense-on'
                      : ''
                  }${phase === 'prefill' ? ' warm' : ''}`}
                />
              ))}
              {spec.sharedExperts > 0 && (
                <div
                  className={`expert-cell shared${busy ? ' firing' : ''}`}
                  title="shared expert"
                />
              )}
            </div>
            <p className="net-hint">
              {spec.expertsTotal ? (
                <>
                  This is why a {model.totalParamsB}B-parameter model only does{' '}
                  {model.activeParamsB}B parameters of work per token — and why
                  MoE models are so much cheaper to run.
                </>
              ) : (
                <>
                  All {model.totalParamsB}B parameters work on every single
                  token. Simple and predictable — but each token must stream
                  the whole network from memory, which is why dense models
                  cost more per token. Switch to DeepSeek or OpenAI to see the
                  MoE contrast.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ---- 4: next-token prediction ---- */}
      <section className="panel">
        <h2>
          <span className="step-num">4</span> Score, softmax, sample — the loop
        </h2>
        <div className="logit-area">
          {logits.length === 0 ? (
            <p className="net-hint">
              The final layer produces a score (a <em>logit</em>) for every
              one of the <strong>{spec.vocab.toLocaleString()}</strong>{' '}
              vocabulary tokens. <em>Softmax</em> turns those scores into
              probabilities that sum to 100%, and the next token is{' '}
              <em>sampled</em> from them — usually the favourite, but not
              always. That controlled randomness is what the
              &ldquo;temperature&rdquo; setting adjusts. Watch the race here
              during generation.
            </p>
          ) : (
            <>
              <div className="logit-bars">
                {logits.map((l) => (
                  <div key={l.token} className={`logit-row${l.winner ? ' winner' : ''}`}>
                    <span className="logit-tok">{l.token}</span>
                    <div className="logit-track">
                      <div className="logit-fill" style={{ width: `${l.prob * 100}%` }} />
                    </div>
                    <span className="logit-p">{(l.prob * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              {wasSampled && phase === 'decode' && (
                <div className="sampled-tag">
                  Sampling picked a runner-up this step, not the favourite —
                  that randomness is why the same prompt can give different
                  answers.
                </div>
              )}
            </>
          )}
          <div className={`feedback-loop${phase === 'decode' ? ' live' : ''}`}>
            The sampled token is appended to the context and fed back in —
            this is <strong>autoregressive</strong> generation, one loop per
            token. Reasoning models use exactly this loop too; they simply
            generate hidden thinking tokens first, spending more loops before
            the visible answer begins.
          </div>
        </div>
      </section>

      {/* ---- 5: token stream out ---- */}
      <section className="panel">
        <h2>
          <span className="step-num">5</span> The answer, one token at a time
        </h2>
        <div className={`token-stream${outWords.length === 0 ? ' empty' : ''}`}>
          {outWords.length === 0 ? (
            <span className="stream-hint">Your generated response will stream here.</span>
          ) : (
            <>
              {outWords.slice(0, shownWords).map((w, i) => (
                <span key={i} className="tok">
                  {w}{' '}
                </span>
              ))}
              {phase === 'decode' && <span className="cursor" />}
            </>
          )}
        </div>

        {phase !== 'idle' && (
          <div className="ctx-panel">
            <div className="ctx-head">
              <span>
                Context — everything the model can currently see:{' '}
                <strong>{contextTokens.toLocaleString()} tokens</strong>
              </span>
              <span className="ctx-kv">
                conversation memory (KV cache): {kvMB.toFixed(1)} MB
              </span>
            </div>
            <div className="ctx-bar">
              <div
                className="ctx-fill prompt-part"
                style={{ width: `${(promptToks.length / contextTotal) * 100}%` }}
                title="your prompt"
              />
              <div
                className="ctx-fill answer-part"
                style={{ width: `${(shownWords / contextTotal) * 100}%` }}
                title="the answer so far"
              />
            </div>
            <p className="net-hint">
              Your prompt (light) plus every token written so far (dark) form
              the context. The attention keys and values of every past token
              are cached in GPU memory — the <strong>KV cache</strong> — so
              nothing is re-processed through the {spec.layers} layers. That
              cache is why only the first token is slow (prefill) and the
              rest stream quickly, and why long conversations cost more
              memory and money.
            </p>
          </div>
        )}

        {(phase === 'decode' || phase === 'done') && (
          <div className="sv-stats">
            <div className="sv-stat">
              <span className="sv-stat-v">{shownWords}</span>
              <span className="sv-stat-k">tokens generated</span>
            </div>
            <div className="sv-stat">
              <span className="sv-stat-v">{sim.perUserTps.toFixed(0)}/s</span>
              <span className="sv-stat-k">
                simulated speed on {sim.gpuCount}x H200
              </span>
            </div>
            <div className="sv-stat">
              <span className="sv-stat-v">{(sim.ttftMs / 1000).toFixed(2)}s</span>
              <span className="sv-stat-k">time to first token</span>
            </div>
            <div className="sv-stat">
              <span className="sv-stat-v">{answerWh.toFixed(2)} Wh</span>
              <span className="sv-stat-k">
                energy, about an LED bulb for {Math.round((answerWh * 3600) / 10)}s
              </span>
            </div>
          </div>
        )}

        <p className="sv-disclaimer">
          The words above are composed by this demo in your browser — no real
          model is running. The mechanics, architecture numbers and
          speed/energy figures are the real physics of {model.name} on modern
          GPUs. Switch to the <strong>Full stack explorer</strong> to change
          the infrastructure behind them and watch the tokenomics move.
        </p>
      </section>
    </div>
  );
}

/**
 * The classic word-analogy picture: parallel arrows between man/woman and
 * king/queen show that directions in embedding space carry meaning.
 */
function SemanticMap({ live }: { live: boolean }) {
  return (
    <svg
      className={`semantic-map${live ? ' live' : ''}`}
      viewBox="0 0 260 120"
      role="img"
      aria-label="Word embedding analogy: man to woman parallels king to queen"
    >
      <defs>
        <marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="#8a8a92" />
        </marker>
      </defs>
      <line x1="52" y1="92" x2="112" y2="38" stroke="#8a8a92" strokeWidth="1.5" markerEnd="url(#arr)" strokeDasharray="4 3" />
      <line x1="168" y1="98" x2="228" y2="44" stroke="#8a8a92" strokeWidth="1.5" markerEnd="url(#arr)" strokeDasharray="4 3" />
      <circle cx="46" cy="96" r="4" fill="#66666e" />
      <circle cx="118" cy="34" r="4" fill="#ececee" />
      <circle cx="162" cy="102" r="4" fill="#66666e" />
      <circle cx="234" cy="40" r="4" fill="#ececee" />
      <text x="46" y="112" textAnchor="middle" fill="#8a8a92" fontSize="10">man</text>
      <text x="118" y="24" textAnchor="middle" fill="#ececee" fontSize="10">woman</text>
      <text x="162" y="117" textAnchor="middle" fill="#8a8a92" fontSize="10">king</text>
      <text x="234" y="30" textAnchor="middle" fill="#ececee" fontSize="10">queen</text>
    </svg>
  );
}

/**
 * One neuron: inputs times weights, plus bias, out. Activation pulses
 * travel the connections while the model runs; the weights stay still.
 */
function NeuronDiagram({ live }: { live: boolean }) {
  const inputs = [
    { y: 18, w: '0.8' },
    { y: 52, w: '-1.2' },
    { y: 86, w: '0.3' },
  ];
  return (
    <svg
      className={`neuron${live ? ' live' : ''}`}
      viewBox="0 0 260 104"
      role="img"
      aria-label="A neuron multiplying inputs by weights and adding a bias"
    >
      {inputs.map((inp, i) => (
        <g key={i}>
          <circle cx="18" cy={inp.y} r="7" fill="none" stroke="#66666e" strokeWidth="1.5" />
          <line x1="25" y1={inp.y} x2="128" y2="52" stroke="#4a4a52" strokeWidth="1.5" />
          <text
            x={(25 + 128) / 2 - 6}
            y={(inp.y + 52) / 2 - 5}
            fill="#8a8a92"
            fontSize="9"
            fontFamily="ui-monospace, monospace"
          >
            w={inp.w}
          </text>
          {live && (
            <circle r="2.5" fill="#ececee">
              <animateMotion
                dur="1.1s"
                repeatCount="indefinite"
                begin={`${i * 0.25}s`}
                path={`M25,${inp.y} L128,52`}
              />
            </circle>
          )}
        </g>
      ))}
      <circle cx="140" cy="52" r="15" fill="none" stroke="#ececee" strokeWidth="1.5" />
      <text x="140" y="56" textAnchor="middle" fill="#ececee" fontSize="11">&Sigma;</text>
      <text x="140" y="82" textAnchor="middle" fill="#8a8a92" fontSize="9" fontFamily="ui-monospace, monospace">
        + bias
      </text>
      <line x1="155" y1="52" x2="238" y2="52" stroke="#4a4a52" strokeWidth="1.5" />
      {live && (
        <circle r="2.5" fill="#ececee">
          <animateMotion dur="0.8s" repeatCount="indefinite" path="M155,52 L238,52" />
        </circle>
      )}
      <text x="246" y="56" textAnchor="middle" fill="#8a8a92" fontSize="10">out</text>
    </svg>
  );
}
