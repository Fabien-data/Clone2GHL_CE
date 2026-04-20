/**
 * backend/src/routes/ai.js
 *
 * AI feature endpoints — all OpenAI calls are made server-side.
 * Users never need their own API key. Access is gated by plan.
 *
 * POST /api/ai/optimize   → GPT-4.1       copy rewriting (all plans)
 * POST /api/ai/report     → GPT-4.1-mini  funnel intelligence report (all plans)
 * POST /api/ai/headlines  → GPT-4.1-mini  headline generation (all plans)
 * POST /api/ai/logo       → gpt-image-1   logo generation (Pro + Agency only)
 */

import express from 'express';
import { authRequired } from '../middleware/auth.js';
import { config, logoLimits } from '../config.js';
import { readDb, writeDb } from '../store.js';

const router = express.Router();

// ─── OpenAI helpers ──────────────────────────────────────────────────────────

const OPENAI_CHAT_URL  = 'https://api.openai.com/v1/chat/completions';
const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_TIMEOUT   = 60_000; // 60 s — image/copy calls can be slow

function openAIHeaders() {
  return {
    Authorization: `Bearer ${config.openaiApiKey}`,
    'Content-Type': 'application/json',
  };
}

async function openAIChat(model, messages, { temperature = 0.7, max_tokens = 2000, json = false } = {}) {
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');

  const body = { model, messages, temperature, max_tokens };
  if (json) body.response_format = { type: 'json_object' };

  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), OPENAI_TIMEOUT);

  try {
    const resp = await fetch(OPENAI_CHAT_URL, {
      method:  'POST',
      headers: openAIHeaders(),
      body:    JSON.stringify(body),
      signal:  ac.signal,
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }

    if (!resp.ok) {
      throw new Error(data?.error?.message || `OpenAI chat error: HTTP ${resp.status}`);
    }
    return data?.choices?.[0]?.message?.content || '';
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('OpenAI request timed out.');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function openAIImage(body) {
  if (!config.openaiApiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');

  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), OPENAI_TIMEOUT);

  try {
    const resp = await fetch(OPENAI_IMAGE_URL, {
      method:  'POST',
      headers: openAIHeaders(),
      body:    JSON.stringify(body),
      signal:  ac.signal,
    });

    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }

    if (!resp.ok) {
      throw new Error(data?.error?.message || `OpenAI image error: HTTP ${resp.status}`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('OpenAI image request timed out.');
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ─── Plan helpers ─────────────────────────────────────────────────────────────

function currentPeriod() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

async function getUserAndPlan(userId) {
  const db   = await readDb();
  const user = db.users.find(u => u.id === userId);
  if (!user) throw new Error('User not found.');
  return { user, db };
}

// ─── Niche profiles (mirrors aiOptimizer.js) ─────────────────────────────────

const NICHE_PROFILES = {
  plumber: {
    audience:     'Homeowners with plumbing emergencies or service needs',
    painPoints:   ['water damage fear', 'high repair costs', 'finding a trustworthy plumber quickly'],
    outcomes:     ['fast fix', 'fair price', 'no more leaks', 'peace of mind'],
    tone:         'urgent, reassuring, professional',
    headlineAngle:'Fast response + fair price + licensed',
    ctaAngle:     'Free estimate, same-day service',
    trustSignals: ['licensed & insured badge', 'years in business', 'review count'],
  },
  electrician: {
    audience:     'Homeowners and business owners needing electrical work',
    painPoints:   ['electrical safety fears', 'permit issues', 'cost uncertainty'],
    outcomes:     ['safe installation', 'code compliance', 'reliable service'],
    tone:         'professional, safety-focused, authoritative',
    headlineAngle:'Safety + expertise + licensed',
    ctaAngle:     'Free estimate, same-day dispatch',
    trustSignals: ['license number', 'years of experience', 'service area'],
  },
  hvac: {
    audience:     'Homeowners with broken AC or heating systems',
    painPoints:   ['uncomfortable home', 'high energy bills', 'system breakdowns in extreme weather'],
    outcomes:     ['cool/warm home', 'lower bills', 'reliable system'],
    tone:         'urgent, helpful, expert',
    headlineAngle:'Fast repair + same-day + comfort guarantee',
    ctaAngle:     'Dispatch a tech now, free diagnostic',
    trustSignals: ['certifications', 'brands serviced', 'service guarantee'],
  },
  real_estate: {
    audience:     'Homeowners considering selling or buyers looking to purchase',
    painPoints:   ['uncertainty about home value', 'fear of leaving money on table', 'agent trust'],
    outcomes:     ['accurate valuation', 'maximum sale price', 'fast sale'],
    tone:         'professional, data-driven, trustworthy',
    headlineAngle:'Accurate valuation + maximum results',
    ctaAngle:     'Free home value report, no obligation',
    trustSignals: ['homes sold count', 'average days on market', 'client testimonials'],
  },
  gym: {
    audience:     'Adults wanting to get fit, lose weight, or build muscle',
    painPoints:   ['lack of motivation', 'wasted gym memberships', 'no results', 'gym intimidation'],
    outcomes:     ['visible results', 'accountability', 'community', 'expert guidance'],
    tone:         'energetic, motivational, inclusive',
    headlineAngle:'Real results, zero excuses, start free',
    ctaAngle:     'Free trial, no contract, cancel anytime',
    trustSignals: ['member transformations', 'trainer credentials', 'class variety'],
  },
  solar: {
    audience:     'Homeowners paying high electric bills who own their home',
    painPoints:   ['rising electricity costs', 'environmental concerns', 'complex installation process'],
    outcomes:     ['lower bills', 'energy independence', 'tax credits', 'home value increase'],
    tone:         'educational, savings-focused, reassuring',
    headlineAngle:'Exact monthly savings + federal tax credit',
    ctaAngle:     'Free savings calculation, no-pressure quote',
    trustSignals: ['installer certifications', 'panels installed count', 'savings guaranteed'],
  },
  dental: {
    audience:     'Adults looking for a new dentist or specific dental treatment',
    painPoints:   ['dental anxiety', 'cost/insurance concerns', 'finding trusted dentist'],
    outcomes:     ['healthy smile', 'pain-free experience', 'affordable care'],
    tone:         'warm, reassuring, professional',
    headlineAngle:'Comfortable, affordable, accepting new patients',
    ctaAngle:     'Free new patient exam, flexible payment plans',
    trustSignals: ['patient reviews', 'years in practice', 'insurance accepted'],
  },
  coaching: {
    audience:     'Established business owners and entrepreneurs seeking growth',
    painPoints:   ['plateaued revenue', 'working too many hours', 'no clear growth strategy'],
    outcomes:     ['revenue growth', 'time freedom', 'systemized business', 'clear roadmap'],
    tone:         'authoritative, results-focused, premium',
    headlineAngle:'Specific revenue result + timeframe + unique mechanism',
    ctaAngle:     'Apply now, limited spots, free strategy call',
    trustSignals: ['client results', 'revenue generated', 'methodology credentials'],
  },
  insurance: {
    audience:     'Homeowners and vehicle owners looking to save on insurance',
    painPoints:   ['overpaying', 'confusing policies', 'poor claims service'],
    outcomes:     ['lower premiums', 'better coverage', 'easy claims', 'peace of mind'],
    tone:         'friendly, money-saving focused, simple',
    headlineAngle:'How much you could save + multiple carriers',
    ctaAngle:     'Free quote, compare multiple carriers, no SSN',
    trustSignals: ['carrier logos', 'average savings amount', 'licensed agents'],
  },
  cleaning: {
    audience:     'Homeowners and property managers needing cleaning services',
    painPoints:   ['busy schedule', 'cleaning quality', 'reliable service'],
    outcomes:     ['clean home', 'time savings', 'peace of mind', 'consistent quality'],
    tone:         'friendly, reliable, professional',
    headlineAngle:'Clean home + reliable + affordable',
    ctaAngle:     'Free estimate, book online, same-week availability',
    trustSignals: ['bonded & insured', 'background-checked staff', 'satisfaction guarantee'],
  },
  roofing: {
    audience:     'Homeowners with roof damage, especially storm-related',
    painPoints:   ['hidden damage', 'insurance claim complexity', 'unreliable contractors'],
    outcomes:     ['protected home', 'insurance claim help', 'quality installation', 'warranty'],
    tone:         'urgent, authoritative, helpful',
    headlineAngle:'Free inspection + insurance help + licensed',
    ctaAngle:     'Free roof inspection, insurance claim assistance',
    trustSignals: ['license number', 'manufacturer certifications', 'warranty terms'],
  },
  legal: {
    audience:     'Individuals seeking legal representation for injury or disputes',
    painPoints:   ['uncertainty about rights', 'attorney cost fears', 'complex legal process'],
    outcomes:     ['fair compensation', 'expert representation', 'no upfront cost', 'justice'],
    tone:         'authoritative, empathetic, results-focused',
    headlineAngle:'No win no fee + specific settlement amounts',
    ctaAngle:     'Free case evaluation, no obligation, confidential',
    trustSignals: ['settlement amounts won', 'bar association membership', 'years of experience'],
  },
  weight_loss: {
    audience:     'Adults wanting to lose weight without extreme dieting',
    painPoints:   ['failed diets', 'no sustainable results', 'lack of accountability'],
    outcomes:     ['sustainable weight loss', 'energy boost', 'confidence', 'health improvement'],
    tone:         'empathetic, motivational, scientific',
    headlineAngle:'Specific lbs lost + timeframe + without restriction',
    ctaAngle:     'Free challenge, quick results, no judgment',
    trustSignals: ['transformation photos', 'participant count', 'clinical backing'],
  },
  landscaping: {
    audience:     'Homeowners wanting a beautiful yard without the work',
    painPoints:   ['time to maintain lawn', 'inconsistent service', 'lawn appearance concerns'],
    outcomes:     ['beautiful yard', 'reliable weekly service', 'curb appeal', 'time savings'],
    tone:         'friendly, reliable, quality-focused',
    headlineAngle:'Beautiful lawn + no effort + affordable',
    ctaAngle:     'Free estimate, flexible scheduling, seasonal deals',
    trustSignals: ['years in service', 'neighborhoods served', 'satisfaction guarantee'],
  },
  marketing_agency: {
    audience:     'Business owners and marketing managers seeking ROI-driven growth',
    painPoints:   ['wasted ad spend', 'no clear attribution', 'agency overpromises'],
    outcomes:     ['measurable ROI', 'qualified leads', 'revenue growth', 'transparency'],
    tone:         'data-driven, results-focused, direct',
    headlineAngle:'Specific ROI result + proven method + no long contract',
    ctaAngle:     'Free audit, no obligation, results in 30 days',
    trustSignals: ['client revenue generated', 'case studies', 'certifications'],
  },
};

const FALLBACK_NICHE = {
  audience:     'Local business customers',
  painPoints:   ['finding reliable service', 'pricing concerns', 'quality uncertainty'],
  outcomes:     ['professional service', 'fair pricing', 'peace of mind'],
  tone:         'professional, helpful, trustworthy',
  headlineAngle:'Quality service + fair price + reliable',
  ctaAngle:     'Free estimate, quick response',
  trustSignals: ['reviews', 'license', 'experience'],
};

function getNicheContext(niche) {
  return NICHE_PROFILES[niche] || FALLBACK_NICHE;
}

// ─── Logo style guides ────────────────────────────────────────────────────────

const LOGO_STYLE_GUIDES = {
  modern:       'clean, minimal, geometric, contemporary sans-serif typography',
  professional: 'corporate, trustworthy, serif typography, structured layout',
  bold:         'bold, high-contrast, strong typography, impactful mark',
  friendly:     'rounded shapes, approachable, warm colors, welcoming feel',
  luxury:       'elegant, sophisticated, premium quality, refined letterforms',
};

// ─── POST /api/ai/optimize ────────────────────────────────────────────────────
// Rewrite funnel HTML copy for a given niche using GPT-4.1.
// Available to all plans.

router.post('/optimize', authRequired, async (req, res) => {
  try {
    const { user } = await getUserAndPlan(req.user.userId);
    const { html = '', niche = 'general', businessName = '' } = req.body;

    if (!html.trim()) {
      return res.status(400).json({ error: 'html is required.' });
    }

    const ctx = getNicheContext(niche);
    const systemPrompt = `You are an expert direct-response copywriter specializing in high-converting landing pages and sales funnels.
Your task is to rewrite funnel copy to maximize conversions for a specific niche.
Rules:
- Keep the HTML structure intact. Only rewrite the TEXT content inside tags.
- Lead with a clear, specific, benefit-driven headline.
- Use the niche's specific pain points and desired outcomes.
- Include urgency or scarcity where appropriate (keep it believable).
- CTA buttons should use strong action verbs: "Get", "Claim", "Book", "Start", "Unlock".
- Add specific numbers and results where believable (e.g., "Save $1,200/yr", "Lose 15 lbs").
- Keep sentences short. Write at a 6th-grade reading level.
- Never change class names, IDs, or HTML structure.
- Return ONLY the modified HTML with no explanation or markdown fencing.`;

    const userPrompt = `Rewrite the following landing page copy for a ${niche} business${businessName ? ` named "${businessName}"` : ''}.

Target audience: ${ctx.audience}
Key pain points: ${ctx.painPoints.join(', ')}
Desired outcomes: ${ctx.outcomes.join(', ')}
Tone: ${ctx.tone}

Specific instructions:
- Headline should address: "${ctx.headlineAngle}"
- CTA should emphasize: "${ctx.ctaAngle}"
- Trust signals to include: ${ctx.trustSignals.join(', ')}

HTML to optimize:

${html.slice(0, 14000)}`;

    const optimizedHtml = await openAIChat(
      config.openaiCopyModel,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      { temperature: 0.7, max_tokens: 4096 },
    );

    // Log activity
    await writeDb((draft) => {
      draft.activity.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: user.id,
        action: 'ai.optimize',
        resourceType: 'funnel',
        resourceId: '',
        status: 'ok',
        metadata: { niche, model: config.openaiCopyModel },
        createdAt: new Date().toISOString(),
      });
      draft.activity = draft.activity.slice(0, 5000);
      return draft;
    });

    return res.json({ html: optimizedHtml, model: config.openaiCopyModel });
  } catch (err) {
    console.error('[ai/optimize]', err.message);
    return res.status(502).json({ error: err.message || 'AI copy optimization failed.' });
  }
});

// ─── POST /api/ai/report ──────────────────────────────────────────────────────
// Generate a funnel intelligence report using GPT-4.1-mini.
// Available to all plans.

router.post('/report', authRequired, async (req, res) => {
  try {
    const { user } = await getUserAndPlan(req.user.userId);
    const { html = '', analysis = {} } = req.body;

    const score    = analysis.score        ?? 'N/A';
    const grade    = analysis.grade        ?? 'N/A';
    const niche    = analysis.detectedNiche ?? 'general';
    const trust    = (analysis.trustSignals  || []).map(t => t.label || t).join(', ') || 'None detected';
    const urgency  = (analysis.urgencyElements || []).join(', ')                        || 'None detected';

    const prompt = `Analyze this funnel and provide a concise intelligence report.

Funnel data:
- Detected niche: ${niche}
- Conversion score: ${score}/100 (Grade: ${grade})
- Trust signals found: ${trust}
- Urgency elements found: ${urgency}
- HTML snippet (first 1000 chars): ${html.slice(0, 1000)}

Write a 150–200 word analysis covering:
1. Why this funnel converts (or doesn't)
2. The psychological triggers being used
3. The top 3 optimization opportunities
4. An estimated conversion rate range for this type of funnel

Be specific and actionable. Use bullet points. Start with "This funnel [converts/struggles] because:"`;

    const report = await openAIChat(
      config.openaiMiniModel,
      [
        { role: 'system', content: 'You are a world-class conversion rate optimization expert. Be concise, specific, and actionable.' },
        { role: 'user',   content: prompt },
      ],
      { temperature: 0.5, max_tokens: 600 },
    );

    await writeDb((draft) => {
      draft.activity.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: user.id,
        action: 'ai.report',
        resourceType: 'funnel',
        resourceId: '',
        status: 'ok',
        metadata: { niche, model: config.openaiMiniModel },
        createdAt: new Date().toISOString(),
      });
      draft.activity = draft.activity.slice(0, 5000);
      return draft;
    });

    return res.json({ report, model: config.openaiMiniModel });
  } catch (err) {
    console.error('[ai/report]', err.message);
    return res.status(502).json({ error: err.message || 'Intelligence report generation failed.' });
  }
});

// ─── POST /api/ai/headlines ───────────────────────────────────────────────────
// Generate 5 headline variations using GPT-4.1-mini.
// Available to all plans.

router.post('/headlines', authRequired, async (req, res) => {
  try {
    const { user } = await getUserAndPlan(req.user.userId);
    const { niche = 'general', offer = '' } = req.body;

    const content = await openAIChat(
      config.openaiMiniModel,
      [
        {
          role: 'system',
          content: 'You are a direct-response copywriter. Write compelling landing page headlines. Return exactly 5 headlines, one per line, no numbering, no quotes, no extra explanation.',
        },
        {
          role: 'user',
          content: `Write 5 high-converting landing page headlines for a ${niche} business offering: ${offer || `${niche} service`}

Use these proven formulas:
1. Benefit + Timeframe (e.g., "Lose 15 lbs in 30 Days")
2. Question that reveals pain (e.g., "Still Paying Too Much for Electricity?")
3. "How to" with a specific result
4. Social proof + result (e.g., "Join 5,000+ homeowners who saved $1,200/yr")
5. Urgency/scarcity angle

Keep each under 12 words. Be specific with numbers where believable.`,
        },
      ],
      { temperature: 0.9, max_tokens: 400 },
    );

    const headlines = content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .slice(0, 5);

    await writeDb((draft) => {
      draft.activity.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: user.id,
        action: 'ai.headlines',
        resourceType: 'funnel',
        resourceId: '',
        status: 'ok',
        metadata: { niche, model: config.openaiMiniModel },
        createdAt: new Date().toISOString(),
      });
      draft.activity = draft.activity.slice(0, 5000);
      return draft;
    });

    return res.json({ headlines, model: config.openaiMiniModel });
  } catch (err) {
    console.error('[ai/headlines]', err.message);
    return res.status(502).json({ error: err.message || 'Headline generation failed.' });
  }
});

// ─── POST /api/ai/logo ────────────────────────────────────────────────────────
// Generate a logo using gpt-image-1 (Pro + Agency plans only).
// Tracks monthly logo usage against per-plan limits.

router.post('/logo', authRequired, async (req, res) => {
  try {
    const { user, db } = await getUserAndPlan(req.user.userId);
    const plan = user.plan || 'free';

    // ── Plan gating ──────────────────────────────────────────────────────────
    const limit = logoLimits[plan] ?? 0;
    if (limit === 0) {
      return res.status(403).json({
        error: 'Logo generation requires a Pro or Agency plan. Upgrade to unlock this feature.',
        upgradeRequired: true,
      });
    }

    // ── Monthly usage check ──────────────────────────────────────────────────
    const period    = currentPeriod();
    const usageRow  = db.usage.find(u => u.userId === user.id && u.period === period) || {};
    const logosUsed = usageRow.logosUsed ?? 0;

    if (limit > 0 && logosUsed >= limit) {
      return res.status(402).json({
        error: `You have used all ${limit} logo generations for this month (${plan} plan). Resets on the 1st.`,
        logosUsed,
        logosLimit: limit,
      });
    }

    // ── Build prompt ─────────────────────────────────────────────────────────
    const {
      businessName = 'My Business',
      industry     = 'business',
      style        = 'modern',
      colorPalette = 'professional',
    } = req.body;

    const styleDesc = LOGO_STYLE_GUIDES[style] || style;
    const logoPrompt = `Professional logo design for "${businessName}", a ${industry} company.
Style: ${styleDesc}.
Color palette: ${colorPalette}.
Requirements:
- Vector-style mark on a white background
- Business name "${businessName}" in a clean, readable font
- No photorealistic elements or photographs
- Scalable, suitable for print and digital use
- Conveys trust, professionalism, and relevance for the ${industry} industry
- Simple enough to work at small sizes (favicon, business card)`;

    // ── Call gpt-image-1, fall back to dall-e-3 ──────────────────────────────
    let imageData;
    let modelUsed = config.openaiImageModel;

    try {
      imageData = await openAIImage({
        model:   config.openaiImageModel,  // gpt-image-1
        prompt:  logoPrompt,
        size:    '1024x1024',
        quality: 'high',
        n:       1,
      });
    } catch (primaryErr) {
      console.warn('[ai/logo] gpt-image-1 failed, falling back to dall-e-3:', primaryErr.message);
      modelUsed = 'dall-e-3';
      imageData = await openAIImage({
        model:           'dall-e-3',
        prompt:          logoPrompt,
        n:               1,
        size:            '1024x1024',
        quality:         'standard',
        response_format: 'url',
      });
    }

    const imageItem      = imageData?.data?.[0] || {};
    const url            = imageItem.url
      || (imageItem.b64_json ? `data:image/png;base64,${imageItem.b64_json}` : '');
    const revisedPrompt  = imageItem.revised_prompt || logoPrompt;

    if (!url) {
      return res.status(502).json({ error: 'Logo generation returned no image.' });
    }

    // ── Increment logo usage ─────────────────────────────────────────────────
    await writeDb((draft) => {
      let row = draft.usage.find(u => u.userId === user.id && u.period === period);
      if (!row) {
        row = { userId: user.id, period, clonesUsed: 0, logosUsed: 0, updatedAt: new Date().toISOString() };
        draft.usage.push(row);
      }
      row.logosUsed = (row.logosUsed ?? 0) + 1;
      row.updatedAt = new Date().toISOString();

      draft.activity.unshift({
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: user.id,
        action: 'ai.logo',
        resourceType: 'logo',
        resourceId: '',
        status: 'ok',
        metadata: { businessName, industry, style, model: modelUsed },
        createdAt: new Date().toISOString(),
      });
      draft.activity = draft.activity.slice(0, 5000);
      return draft;
    });

    return res.json({
      url,
      revisedPrompt,
      model:       modelUsed,
      logosUsed:   logosUsed + 1,
      logosLimit:  limit,
    });
  } catch (err) {
    console.error('[ai/logo]', err.message);
    return res.status(502).json({ error: err.message || 'Logo generation failed.' });
  }
});

export default router;
