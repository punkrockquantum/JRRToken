import { useState } from 'react';

/**
 * SHARP(ER) ENTERPRISES — TOKEN CONSULTANT
 *
 * Architect-facing console: the team builds its own constraints from
 * blank boxes, selects which facilitator prompt it is preparing to face,
 * and Generates a balanced brief — strengths, risks and talking points —
 * to form the basis of the pitch. No answer keys anywhere: the numbers
 * come out of the constraints the architects defined.
 */

interface Brief {
  promptLabel: string;
  script: string;
  gbPerUser: number;
  cap: number;
  devLoadGB: number;
  devLoadPct: number;
  fits: boolean;
  headroomAfterDevsGB: number;
  strengths: string[];
  risks: string[];
  slideText: string;
}

export function TokenConsultant() {
  const [weights, setWeights] = useState('');
  const [mbTok, setMbTok] = useState('');
  const [ctx, setCtx] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [devs, setDevs] = useState('');
  const [ttft, setTtft] = useState('');
  const [tokensDay, setTokensDay] = useState('');
  const [promptChoice, setPromptChoice] = useState<'p1' | 'p2'>('p1');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [copied, setCopied] = useState(false);
  const [formError, setFormError] = useState('');

  const generate = () => {
    const w = parseFloat(weights);
    const mb = parseFloat(mbTok);
    const c = parseInt(ctx, 10);
    const ws = parseFloat(workspace);
    const d = parseInt(devs, 10);
    const t = parseInt(ttft, 10);
    const td = parseFloat(tokensDay);
    if ([w, mb, c, ws, d, t, td].some((n) => !Number.isFinite(n) || n <= 0)) {
      setFormError(
        'Define every constraint first — the brief is only as strong as the numbers behind it.'
      );
      return;
    }
    setFormError('');

    const gbPerUser = (c * mb) / 1000;
    const cap = Math.floor(ws / gbPerUser);
    const devLoadGB = d * gbPerUser;
    const devLoadPct = (devLoadGB / ws) * 100;
    const fits = devLoadGB <= ws;
    const headroomAfterDevsGB = ws - devLoadGB;

    // ---- balanced assessment: strengths AND risks -------------------------
    const strengths: string[] = [];
    const risks: string[] = [];
    if (fits && devLoadPct >= 70) {
      strengths.push(
        `Capacity plan is efficient: ${d.toLocaleString()} concurrent sessions use ${devLoadPct.toFixed(0)}% of the workspace, with ${headroomAfterDevsGB.toFixed(0)} GB in reserve for surges.`
      );
    }
    if (fits && devLoadPct < 70) {
      strengths.push(
        `Resilience headroom: at ${d.toLocaleString()} sessions the node holds ${headroomAfterDevsGB.toFixed(0)} GB spare — burst traffic and failover both have room.`
      );
      risks.push(
        `Utilisation risk: ${(100 - devLoadPct).toFixed(0)}% of paid-for memory sits idle at plan load. Expect the CFO question — why not fewer nodes, or more users per node (cap: ${cap.toLocaleString()})?`
      );
    }
    if (!fits) {
      risks.push(
        `Memory risk: ${d.toLocaleString()} sessions demand ${devLoadGB.toFixed(0)} GB against ${ws.toFixed(0)} GB of workspace. Above ${cap.toLocaleString()} sessions, requests queue — plan admission control or add nodes before pitching this load.`
      );
    } else {
      strengths.push(
        `Hard cap is known and defensible: ${ws.toFixed(0)} GB \u00f7 ${gbPerUser.toFixed(2)} GB per ${c.toLocaleString()}-token session = ${cap.toLocaleString()} concurrent sessions per node.`
      );
    }
    if (Math.abs(mb - 0.33) > 0.005) {
      risks.push(
        `Precision risk: ${mb.toFixed(3)} MB/token is not the native FP16 density. If product engineering holds the no-quantization rule, this constraint will be challenged in the room.`
      );
    } else {
      strengths.push(
        'KV density is grounded in native FP16 physics — the precision parameter will survive scrutiny.'
      );
    }
    if (c >= 8000 && t <= 100) {
      risks.push(
        `Latency tension: a ${c.toLocaleString()}-token context against a ${t} ms TTFT target is the hardest promise on this slide — prefill time grows linearly with context. Be ready to defend batching, caching or a tiered SLA.`
      );
    } else if (t >= 100) {
      strengths.push(
        `SLA is realistic: ${t} ms TTFT at ${c.toLocaleString()}-token contexts leaves engineering margin.`
      );
    }
    risks.push(
      `Scale-out dependency: ${td}M tokens/day per hub will not come from one node — the pitch must show the node count and the cost line that delivers it.`
    );

    const script =
      promptChoice === 'p1'
        ? `\u201cArchitects, walk me through your memory math. Product engineering has locked you out of quantization to preserve code quality \u2014 so lower-tier weights aren\u2019t coming to save your budget. Once you load those raw ${w.toFixed(0)} GB model parameters across your silicon cluster, what is the exact VRAM footprint left over, and how many active users can hit that specific node before the system drops an OOM error?\u201d`
        : `\u201cYou\u2019re showing me throughput metrics, but I need to see customer-facing SLAs. If ${d.toLocaleString()} developers concurrently push a heavy ${c.toLocaleString()}-token context stream at a regional hub, what happens to our Time-to-First-Token latency boundary? If your KV Cache math isn\u2019t built on ${mb.toFixed(3)} MB/token FP16 parameters, you aren\u2019t designing a solution \u2014 you\u2019re building a corporate liability.\u201d`;

    const slideText = [
      'SHARP(ER) ENTERPRISES \u2014 TOKEN CONSULTATION PITCH BRIEF',
      '',
      'CONSTRAINTS (as defined by the team)',
      `\u2022 Base model weights: ${w.toFixed(0)} GB (locked, no quantization)`,
      `\u2022 KV cache density: ${mb.toFixed(3)} MB/token`,
      `\u2022 Context window: ${c.toLocaleString()} tokens \u2192 ${gbPerUser.toFixed(2)} GB per session`,
      `\u2022 Node workspace: ${ws.toFixed(0)} GB \u2192 hard cap ${cap.toLocaleString()} sessions/node`,
      `\u2022 Planned load: ${d.toLocaleString()} concurrent users \u2192 ${devLoadGB.toFixed(0)} GB (${devLoadPct.toFixed(0)}% of workspace)`,
      `\u2022 SLA: TTFT \u2264 ${t} ms \u00b7 ${td}M tokens/day/hub`,
      '',
      'STRENGTHS TO LEAD WITH',
      ...strengths.map((s) => `\u2022 ${s}`),
      '',
      'RISKS TO OWN BEFORE THE ROOM FINDS THEM',
      ...risks.map((r) => `\u2022 ${r}`),
      '',
      `PREPARE FOR (${promptChoice === 'p1' ? 'Prompt 1 \u2014 baseline scaling variables' : 'Prompt 2 \u2014 executive alignment on SLAs'})`,
      script,
    ].join('\n');

    setBrief({
      promptLabel:
        promptChoice === 'p1'
          ? 'Prompt 1 \u2014 baseline scaling variables'
          : 'Prompt 2 \u2014 executive alignment on performance SLAs',
      script,
      gbPerUser,
      cap,
      devLoadGB,
      devLoadPct,
      fits,
      headroomAfterDevsGB,
      strengths,
      risks,
      slideText,
    });
    setCopied(false);
  };

  const copySlide = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief.slideText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="consultant">
      <section className="panel">
        <div className="mb-eyebrow">Track A: AI performance &amp; token optimization</div>
        <h2 className="mission-title">SHARP(ER) ENTERPRISES — TOKEN CONSULTANT</h2>
        <p className="mission-brief">
          Sharp(er) Enterprises ($500M ARR SaaS vendor) is launching
          AuraCopilot in 90 days: Llama 3.3 70B at native FP16, quantization
          banned, sub-100ms TTFT, three private hubs at 100M tokens/day each.
          Your table owns the token math. Build your constraints below —
          interview the table lead to uncover the engineering metrics — then
          Generate a balanced brief to anchor your pitch.
        </p>

        <div className="cost-breakdown-title">1 &middot; Build your constraints</div>
        <div className="studio-grid">
          <label className="picker">
            <span className="picker-label">Base model weights (GB)</span>
            <input type="number" step="1" min="0" placeholder="GB" value={weights} onChange={(e) => setWeights(e.target.value)} />
            <span className="picker-note">What does the model itself lock up before any user connects?</span>
          </label>
          <label className="picker">
            <span className="picker-label">KV cache density (MB/token)</span>
            <input type="number" step="0.001" min="0" placeholder="MB per token" value={mbTok} onChange={(e) => setMbTok(e.target.value)} />
            <span className="picker-note">The precision parameter — defend it, the room will test it.</span>
          </label>
          <label className="picker">
            <span className="picker-label">Context window spike (tokens)</span>
            <input type="number" step="100" min="0" placeholder="tokens" value={ctx} onChange={(e) => setCtx(e.target.value)} />
            <span className="picker-note">The traffic surge your capacity plan must survive.</span>
          </label>
          <label className="picker">
            <span className="picker-label">Node workspace after weights (GB)</span>
            <input type="number" step="1" min="0" placeholder="GB" value={workspace} onChange={(e) => setWorkspace(e.target.value)} />
            <span className="picker-note">Memory left for user sessions on your chosen chassis.</span>
          </label>
          <label className="picker">
            <span className="picker-label">Planned concurrent users</span>
            <input type="number" step="10" min="0" placeholder="sessions" value={devs} onChange={(e) => setDevs(e.target.value)} />
            <span className="picker-note">The load your pitch commits to serving per node.</span>
          </label>
          <label className="picker">
            <span className="picker-label">TTFT commitment (ms)</span>
            <input type="number" step="10" min="0" placeholder="ms" value={ttft} onChange={(e) => setTtft(e.target.value)} />
            <span className="picker-note">The latency promise on your SLA slide.</span>
          </label>
          <label className="picker">
            <span className="picker-label">Tokens/day per hub (millions)</span>
            <input type="number" step="10" min="0" placeholder="M tokens" value={tokensDay} onChange={(e) => setTokensDay(e.target.value)} />
            <span className="picker-note">The capacity commitment per region.</span>
          </label>
        </div>

        <div className="cost-breakdown-title" style={{ marginTop: 16 }}>
          2 &middot; Which challenge are you preparing for?
        </div>
        <div className="seg option-seg">
          <button className={promptChoice === 'p1' ? 'on' : ''} onClick={() => setPromptChoice('p1')}>
            Prompt 1 — baseline scaling variables
          </button>
          <button className={promptChoice === 'p2' ? 'on' : ''} onClick={() => setPromptChoice('p2')}>
            Prompt 2 — executive alignment on SLAs
          </button>
        </div>
        <div className="picker-row" style={{ marginTop: 14 }}>
          <button className="run-btn big" onClick={generate}>
            Generate brief
          </button>
        </div>
        {formError && <div className="warning">{formError}</div>}
      </section>

      {brief && (
        <section className="panel">
          <h2>Your pitch brief</h2>
          <div className="tracka-rows">
            <div className="tracka-row">
              <span className="tracka-k">Per-session footprint</span>
              <span className="tracka-v">{brief.gbPerUser.toFixed(2)} GB</span>
            </div>
            <div className="tracka-row cap">
              <span className="tracka-k">Hard concurrency cap per node</span>
              <span className="tracka-v">{brief.cap.toLocaleString()} sessions</span>
            </div>
            <div className="tracka-row">
              <span className="tracka-k">Planned load vs workspace</span>
              <span className="tracka-v">
                {brief.devLoadGB.toFixed(0)} GB ({brief.devLoadPct.toFixed(0)}%) —{' '}
                {brief.fits
                  ? `${brief.headroomAfterDevsGB.toFixed(0)} GB spare`
                  : `over by ${Math.abs(brief.headroomAfterDevsGB).toFixed(0)} GB`}
              </span>
            </div>
          </div>

          <div className="brief-cols">
            <div>
              <div className="cost-breakdown-title">Strengths to lead with</div>
              {brief.strengths.map((s, i) => (
                <div key={i} className="tracka-row exp-insight brief-strength">
                  <span className="tracka-k">{s}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="cost-breakdown-title">Risks to own first</div>
              {brief.risks.map((r, i) => (
                <div key={i} className="tracka-row exp-insight brief-risk">
                  <span className="tracka-k">{r}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="script-card" style={{ marginTop: 12 }}>
            <div className="script-label">Prepare for — {brief.promptLabel}</div>
            <blockquote className="script-quote" style={{ whiteSpace: 'pre-wrap' }}>
              {brief.script}
            </blockquote>
          </div>

          <pre className="pitch-box">{brief.slideText}</pre>
          <button className="run-btn" onClick={copySlide}>
            {copied ? 'Copied' : 'Copy brief for your deck'}
          </button>
        </section>
      )}
    </div>
  );
}
