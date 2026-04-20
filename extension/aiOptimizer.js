/**
 * aiOptimizer.js
 * OpenAI-powered funnel copy optimization and logo generation.
 * Uses GPT-4o for copy rewriting and DALL-E 3 for logo generation.
 */

const AiOptimizer = (() => {
  const OPENAI_BASE = 'https://api.openai.com/v1';
  const OPENAI_TIMEOUT_MS = 25000;

  async function openAIRequest(endpoint, apiKey, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

    try {
      const resp = await fetch(`${OPENAI_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        if (resp.status === 429) {
          const retryAfter = resp.headers.get('retry-after');
          const waitHint = retryAfter ? ` Retry after ${retryAfter}s.` : '';
          throw new Error(`OpenAI rate limit reached.${waitHint}`);
        }
        if (resp.status === 401) {
          throw new Error('OpenAI API key is invalid or expired.');
        }
        throw new Error(data.error?.message || `OpenAI error: HTTP ${resp.status}`);
      }
      return data;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('OpenAI request timed out. Please try again.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Funnel Copy Rewriter ─────────────────────────────────────────────────

  const SYSTEM_PROMPT = `You are an expert direct-response copywriter specializing in high-converting landing pages and sales funnels.
Your task is to rewrite funnel copy to maximize conversions for a specific niche.
Rules:
- Keep the structure and HTML intact. Only rewrite the TEXT content inside tags.
- Lead with a clear, specific, benefit-driven headline.
- Use the niche's specific pain points and desired outcomes.
- Include urgency or scarcity where appropriate (but keep it believable).
- CTA buttons should use strong action verbs: "Get", "Claim", "Book", "Start", "Unlock".
- Add specific numbers and results where believable (e.g., "Save $1,200/yr", "Lose 15 lbs").
- Keep sentences short. Write at a 6th-grade reading level.
- Never change class names, IDs, or HTML structure.
- Return ONLY the modified HTML with no explanation.`;

  /**
   * Rewrite all text copy in an HTML funnel for a given niche.
   *
   * @param {string} apiKey - OpenAI API key
   * @param {string} html - Funnel HTML
   * @param {string} niche - e.g. "plumber", "real estate", "gym"
   * @param {Object} options - { model, maxTokens, businessName, location }
   * @returns {string} Optimized HTML
   */
  async function optimizeCopy(apiKey, html, niche, options = {}) {
    const {
      model = 'gpt-4o',
      maxTokens = 4000,
      businessName = '',
      location = '',
    } = options;

    const nicheContext = getNicheContext(niche);

    const userPrompt = `Rewrite the following landing page copy for a ${niche} business${businessName ? ` named "${businessName}"` : ''}${location ? ` in ${location}` : ''}.

Target audience: ${nicheContext.audience}
Key pain points: ${nicheContext.painPoints.join(', ')}
Desired outcomes: ${nicheContext.outcomes.join(', ')}
Tone: ${nicheContext.tone}

Specific instructions:
- Headline should address: "${nicheContext.headlineAngle}"
- CTA should emphasize: "${nicheContext.ctaAngle}"
- Trust signals to include: ${nicheContext.trustSignals.join(', ')}

Here is the HTML to optimize:

${html.slice(0, 12000)}`; // Limit to avoid token overflow

    const response = await openAIRequest('/chat/completions', apiKey, {
      model,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    });

    return response.choices?.[0]?.message?.content || html;
  }

  // ─── Funnel Intelligence Report (AI-enhanced) ────────────────────────────

  /**
   * Generate an AI-powered funnel intelligence report.
   * @param {string} apiKey
   * @param {Object} structure - From DomExtractor.extractStructure()
   * @param {Object} analysisData - From FunnelAnalyzer.analyze()
   * @returns {string} Markdown-formatted report
   */
  async function generateIntelligenceReport(apiKey, structure, analysisData) {
    const prompt = `Analyze this funnel and provide a concise intelligence report.

Funnel data:
- Detected niche: ${analysisData.detectedNiche}
- Score: ${analysisData.score}/100 (${analysisData.grade})
- Headlines: ${structure.headlines.slice(0, 3).map(h => h.text).join(' | ')}
- CTA count: ${structure.ctaButtons.length}
- Form fields: ${structure.forms[0]?.fields?.length || 0}
- Testimonials: ${structure.testimonials.length}
- Trust signals: ${analysisData.trustSignals.map(t => t.label).join(', ') || 'None'}
- Urgency elements: ${analysisData.urgencyElements.join(', ') || 'None'}
- Body text sample: ${structure.bodyText?.slice(0, 500)}

Write a 150-200 word analysis covering:
1. Why this funnel converts (or doesn't)
2. The psychological triggers being used
3. The top 3 optimization opportunities
4. An estimated conversion rate range for this type of funnel

Be specific and actionable. Use bullet points. Start with "This funnel [converts/struggles] because:"`;

    const response = await openAIRequest('/chat/completions', apiKey, {
      model: 'gpt-4o',
      max_tokens: 600,
      temperature: 0.5,
      messages: [
        { role: 'system', content: 'You are a world-class conversion rate optimization expert.' },
        { role: 'user', content: prompt },
      ],
    });

    return response.choices?.[0]?.message?.content || 'AI analysis unavailable.';
  }

  // ─── Logo Generator ───────────────────────────────────────────────────────

  /**
   * Generate a logo using gpt-image-1 with a DALL-E 3 fallback.
   * Returns { url: string, revisedPrompt: string }
   */
  async function generateLogo(apiKey, params) {
    const { businessName, industry, style = 'modern', colors = 'professional' } = params;

    const prompt = buildLogoPrompt(businessName, industry, style, colors);

    let response;
    try {
      response = await openAIRequest('/images/generations', apiKey, {
        model: 'gpt-image-1',
        prompt,
        size: '1024x1024',
        quality: 'high',
      });
    } catch {
      response = await openAIRequest('/images/generations', apiKey, {
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
        response_format: 'url',
      });
    }

    const imageItem = response.data?.[0] || {};
    const imageUrl = imageItem.url || (imageItem.b64_json ? `data:image/png;base64,${imageItem.b64_json}` : '');

    return {
      url: imageUrl,
      revisedPrompt: response.data?.[0]?.revised_prompt || prompt,
    };
  }

  function buildLogoPrompt(businessName, industry, style, colors) {
    const styleGuides = {
      modern: 'clean, minimal, geometric, contemporary',
      professional: 'corporate, trustworthy, serif typography, navy and gold',
      bold: 'bold, high-contrast, strong typography, impactful',
      friendly: 'rounded, approachable, warm colors, welcoming',
      luxury: 'elegant, sophisticated, premium, gold accents, black',
    };

    return `Professional logo design for "${businessName}", a ${industry} business.
Style: ${styleGuides[style] || style}.
Color palette: ${colors}.
The logo should be: vector-style, white background, suitable for business use.
Include the business name "${businessName}" in a clean, readable font.
No photorealistic elements. Clean, scalable logo mark with text.
The design should convey trust and professionalism for the ${industry} industry.`;
  }

  // ─── Quick Headline Generator ─────────────────────────────────────────────

  /**
   * Generate 5 headline variations for a given niche and offer.
   */
  async function generateHeadlines(apiKey, niche, offer) {
    const response = await openAIRequest('/chat/completions', apiKey, {
      model: 'gpt-4o',
      max_tokens: 400,
      temperature: 0.9,
      messages: [
        {
          role: 'system',
          content: 'You are a direct-response copywriter. Write compelling landing page headlines. Return exactly 5 headlines, one per line, no numbering, no quotes.',
        },
        {
          role: 'user',
          content: `Write 5 high-converting landing page headlines for a ${niche} business offering: ${offer}

Use these proven formulas:
1. Benefit + Timeframe (e.g., "Lose 15 lbs in 30 Days")
2. Question that reveals pain (e.g., "Still Paying Too Much for Electricity?")
3. "How to" with specific result
4. Social proof + result (e.g., "Join 5,000+ homeowners who saved $1,200/yr")
5. Urgency/scarcity angle

Keep each under 12 words. Be specific with numbers.`,
        },
      ],
    });

    const content = response.choices?.[0]?.message?.content || '';
    return content.split('\n').filter(l => l.trim().length > 0).slice(0, 5);
  }

  // ─── Niche Context Profiles ───────────────────────────────────────────────

  const NICHE_PROFILES = {
    plumber: {
      audience: 'Homeowners with plumbing emergencies or service needs',
      painPoints: ['water damage fear', 'high repair costs', 'finding a trustworthy plumber quickly'],
      outcomes: ['fast fix', 'fair price', 'no more leaks', 'peace of mind'],
      tone: 'urgent, reassuring, professional',
      headlineAngle: 'Fast response + fair price + licensed',
      ctaAngle: 'Free estimate, same-day service',
      trustSignals: ['licensed & insured badge', 'years in business', 'review count'],
    },
    electrician: {
      audience: 'Homeowners and business owners needing electrical work',
      painPoints: ['electrical safety fears', 'permit issues', 'cost uncertainty'],
      outcomes: ['safe installation', 'code compliance', 'reliable service'],
      tone: 'professional, safety-focused, authoritative',
      headlineAngle: 'Safety + expertise + licensed',
      ctaAngle: 'Free estimate, same-day dispatch',
      trustSignals: ['license number', 'years of experience', 'service area'],
    },
    hvac: {
      audience: 'Homeowners with broken AC or heating systems',
      painPoints: ['uncomfortable home', 'high energy bills', 'system breakdowns in extreme weather'],
      outcomes: ['cool/warm home', 'lower bills', 'reliable system'],
      tone: 'urgent, helpful, expert',
      headlineAngle: 'Fast repair + same-day + comfort guarantee',
      ctaAngle: 'Dispatch a tech now, free diagnostic',
      trustSignals: ['certifications', 'brands serviced', 'service guarantee'],
    },
    real_estate: {
      audience: 'Homeowners considering selling or buyers looking to purchase',
      painPoints: ['uncertainty about home value', 'fear of leaving money on table', 'agent trust'],
      outcomes: ['accurate valuation', 'maximum sale price', 'fast sale'],
      tone: 'professional, data-driven, trustworthy',
      headlineAngle: 'Accurate valuation + maximum results',
      ctaAngle: 'Free home value report, no obligation',
      trustSignals: ['homes sold count', 'average days on market', 'client testimonials'],
    },
    gym: {
      audience: 'Adults wanting to get fit, lose weight, or build muscle',
      painPoints: ['lack of motivation', 'wasted gym memberships', 'no results', 'gym intimidation'],
      outcomes: ['visible results', 'accountability', 'community', 'expert guidance'],
      tone: 'energetic, motivational, inclusive',
      headlineAngle: 'Real results, zero excuses, start free',
      ctaAngle: 'Free trial, no contract, cancel anytime',
      trustSignals: ['member transformations', 'trainer credentials', 'class variety'],
    },
    solar: {
      audience: 'Homeowners paying high electric bills who own their home',
      painPoints: ['rising electricity costs', 'environmental concerns', 'complex installation process'],
      outcomes: ['lower bills', 'energy independence', 'tax credits', 'home value increase'],
      tone: 'educational, savings-focused, reassuring',
      headlineAngle: 'Exact monthly savings + federal tax credit',
      ctaAngle: 'Free savings calculation, no-pressure quote',
      trustSignals: ['installer certifications', 'panels installed count', 'savings guaranteed'],
    },
    dental: {
      audience: 'Adults looking for a new dentist or specific dental treatment',
      painPoints: ['dental anxiety', 'cost/insurance concerns', 'finding trusted dentist'],
      outcomes: ['healthy smile', 'pain-free experience', 'affordable care'],
      tone: 'warm, reassuring, professional',
      headlineAngle: 'Comfortable, affordable, accepting new patients',
      ctaAngle: 'Free new patient exam, flexible payment plans',
      trustSignals: ['patient reviews', 'years in practice', 'insurance accepted'],
    },
    coaching: {
      audience: 'Established business owners and entrepreneurs seeking growth',
      painPoints: ['plateaued revenue', 'working too many hours', 'no clear growth strategy'],
      outcomes: ['revenue growth', 'time freedom', 'systemized business', 'clear roadmap'],
      tone: 'authoritative, results-focused, premium',
      headlineAngle: 'Specific revenue result + timeframe + unique mechanism',
      ctaAngle: 'Apply now, limited spots, free strategy call',
      trustSignals: ['client results', 'revenue generated', 'methodology credentials'],
    },
    insurance: {
      audience: 'Homeowners and vehicle owners looking to save on insurance',
      painPoints: ['overpaying', 'confusing policies', 'poor claims service'],
      outcomes: ['lower premiums', 'better coverage', 'easy claims', 'peace of mind'],
      tone: 'friendly, money-saving focused, simple',
      headlineAngle: 'How much you could save + multiple carriers',
      ctaAngle: 'Free quote, compare multiple carriers, no SSN',
      trustSignals: ['carrier logos', 'average savings amount', 'licensed agents'],
    },
    cleaning: {
      audience: 'Homeowners and property managers needing cleaning services',
      painPoints: ['busy schedule', 'cleaning quality', 'reliable service'],
      outcomes: ['clean home', 'time savings', 'peace of mind', 'consistent quality'],
      tone: 'friendly, reliable, professional',
      headlineAngle: 'Clean home + reliable + affordable',
      ctaAngle: 'Free estimate, book online, same-week availability',
      trustSignals: ['bonded & insured', 'background-checked staff', 'satisfaction guarantee'],
    },
    roofing: {
      audience: 'Homeowners with roof damage, especially storm-related',
      painPoints: ['hidden damage', 'insurance claim complexity', 'unreliable contractors'],
      outcomes: ['protected home', 'insurance claim help', 'quality installation', 'warranty'],
      tone: 'urgent, authoritative, helpful',
      headlineAngle: 'Free inspection + insurance help + licensed',
      ctaAngle: 'Free roof inspection, insurance claim assistance',
      trustSignals: ['license number', 'manufacturer certifications', 'warranty terms'],
    },
    legal: {
      audience: 'Individuals seeking legal representation for injury or disputes',
      painPoints: ['uncertainty about rights', 'attorney cost fears', 'complex legal process'],
      outcomes: ['fair compensation', 'expert representation', 'no upfront cost', 'justice'],
      tone: 'authoritative, empathetic, results-focused',
      headlineAngle: 'No win no fee + specific settlement amounts',
      ctaAngle: 'Free case evaluation, no obligation, confidential',
      trustSignals: ['settlement amounts won', 'bar association membership', 'years of experience'],
    },
    weight_loss: {
      audience: 'Adults wanting to lose weight without extreme dieting',
      painPoints: ['failed diets', 'no sustainable results', 'lack of accountability'],
      outcomes: ['sustainable weight loss', 'energy boost', 'confidence', 'health improvement'],
      tone: 'empathetic, motivational, scientific',
      headlineAngle: 'Specific lbs lost + timeframe + without restriction',
      ctaAngle: 'Free challenge, quick results, no judgment',
      trustSignals: ['transformation photos', 'participant count', 'clinical backing'],
    },
    landscaping: {
      audience: 'Homeowners wanting a beautiful yard without the work',
      painPoints: ['time to maintain lawn', 'inconsistent service', 'lawn appearance concerns'],
      outcomes: ['beautiful yard', 'reliable weekly service', 'curb appeal', 'time savings'],
      tone: 'friendly, reliable, quality-focused',
      headlineAngle: 'Beautiful lawn + no effort + affordable',
      ctaAngle: 'Free estimate, flexible scheduling, seasonal deals',
      trustSignals: ['years in service', 'neighborhoods served', 'satisfaction guarantee'],
    },
    marketing_agency: {
      audience: 'Business owners and marketing managers seeking ROI-driven growth',
      painPoints: ['wasted ad spend', 'no clear attribution', 'agency overpromises'],
      outcomes: ['measurable ROI', 'qualified leads', 'revenue growth', 'transparency'],
      tone: 'data-driven, results-focused, direct',
      headlineAngle: 'Specific ROI result + proven method + no long contract',
      ctaAngle: 'Free audit, no obligation, results in 30 days',
      trustSignals: ['client revenue generated', 'case studies', 'certifications'],
    },
  };

  function getNicheContext(niche) {
    return NICHE_PROFILES[niche] || NICHE_PROFILES['general'] || {
      audience: 'Local business customers',
      painPoints: ['finding reliable service', 'pricing concerns', 'quality uncertainty'],
      outcomes: ['professional service', 'fair pricing', 'peace of mind'],
      tone: 'professional, helpful, trustworthy',
      headlineAngle: 'Quality service + fair price + reliable',
      ctaAngle: 'Free estimate, quick response',
      trustSignals: ['reviews', 'license', 'experience'],
    };
  }

  /**
   * Generate a local template-based email nurture sequence.
   * Falls back gracefully when no backend is available.
   *
   * @param {string} niche
   * @param {string} offer
   * @param {string} tone  — 'professional' | 'friendly' | 'urgent' | 'story'
   * @param {number} count — 3, 5, or 7
   * @returns {Array<{ emailNumber, type, subject, body }>}
   */
  function generateEmailSequenceLocal(niche, offer, tone, count) {
    const p = getNicheContext(niche);
    const offerText = offer || `${niche} service`;

    const TONES = {
      professional: { g: 'Hello',              s: 'Best regards,',  u: 'I encourage you to take action' },
      friendly:     { g: 'Hey there',          s: 'Talk soon,',     u: "don't miss this" },
      urgent:       { g: 'Quick heads up',     s: 'Act fast,',      u: 'this offer expires soon' },
      story:        { g: 'Let me share something', s: 'Here for you,', u: 'this chapter ends here' },
    };
    const t = TONES[tone] || TONES.professional;

    const EMAILS = [
      {
        emailNumber: 1,
        type: 'Problem Awareness',
        subject: `Still dealing with ${p.painPoints[0]}?`,
        body: `${t.g},\n\nIf you're struggling with ${p.painPoints[0]}, you're not alone.\n\nMost ${p.audience} tell us: they want ${p.outcomes[0]} but can't find a reliable solution.\n\nThat's exactly why we created ${offerText}.\n\nIn the next few days I'll share exactly how it works.\n\n${t.s}\n[Your Name]`,
      },
      {
        emailNumber: 2,
        type: 'Value / Education',
        subject: `How to get ${p.outcomes[0]} (the simple way)`,
        body: `${t.g},\n\nHere's what most people get wrong: ${p.painPoints[1] || 'they wait too long'}.\n\nA simple 3-step framework:\n1. Identify the real problem\n2. Match it to the right solution\n3. Start before costs compound\n\n${offerText} handles all three.\n\nReply with questions — I read every one.\n\n${t.s}\n[Your Name]`,
      },
      {
        emailNumber: 3,
        type: 'Social Proof',
        subject: `What customers say about ${offerText}`,
        body: `${t.g},\n\n"${offerText} delivered exactly what they promised." — A recent customer\n\nHere's what sets us apart:\n✓ ${p.trustSignals[0]}\n✓ ${p.trustSignals[1] || 'Years of proven experience'}\n✓ ${p.outcomes[0]}\n\nWe've helped hundreds of ${p.audience.toLowerCase()} get the results they needed.\n\nWant to be next?\n\n${t.s}\n[Your Name]`,
      },
      {
        emailNumber: 4,
        type: 'Offer / CTA',
        subject: `Here's exactly what you get`,
        body: `${t.g},\n\nHere's what ${offerText} includes:\n\n✓ ${p.outcomes[0]}\n✓ ${p.outcomes[1] || 'Professional results'}\n✓ ${p.outcomes[2] || 'Guaranteed peace of mind'}\n\nBonus: ${p.ctaAngle}\n\n[CLAIM YOUR OFFER]\n\n${t.s}\n[Your Name]`,
      },
      {
        emailNumber: 5,
        type: 'Urgency / Last Chance',
        subject: `Last chance — ${offerText} offer closing`,
        body: `${t.g},\n\nI don't want you to miss this.\n\nIf ${p.painPoints[0]} is still on your mind — ${t.u}.\n\n${offerText} closes [DATE]. After that, prices go up.\n\n1. Click the link below\n2. Book your spot (limited availability)\n3. Get ${p.outcomes[0]} within [TIMEFRAME]\n\n[FINAL CTA]\n\n${t.s}\n[Your Name]`,
      },
      {
        emailNumber: 6,
        type: 'Re-engagement',
        subject: `Still on the fence? Let me help you decide`,
        body: `${t.g},\n\nI noticed you haven't taken action yet.\n\nFair enough — big decisions take time.\n\nHere's one thing that might help: our ${p.trustSignals[0]}. If you're not satisfied, we make it right.\n\nNo risk. No long contracts. Just ${p.outcomes[0]}.\n\nReply with your biggest concern — I'll personally answer.\n\n${t.s}\n[Your Name]`,
      },
      {
        emailNumber: 7,
        type: 'Referral / Long-term',
        subject: `You're going to love this (and so will your friends)`,
        body: `${t.g},\n\nCustomers who get ${p.outcomes[0]} with ${offerText} often tell their friends.\n\nIf you know anyone dealing with ${p.painPoints[0]}, send them our way — we'll take great care of them.\n\nAnd if you haven't started yet — there's still time.\n\n[REFERRAL / FINAL CTA]\n\n${t.s}\n[Your Name]`,
      },
    ];

    return EMAILS.slice(0, Math.min(count, EMAILS.length));
  }

  /** Test if an OpenAI API key is valid */
  async function validateApiKey(apiKey) {
    if (!apiKey || !apiKey.startsWith('sk-')) {
      return { valid: false, error: 'API key must start with "sk-"' };
    }
    try {
      const resp = await fetch(`${OPENAI_BASE}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (resp.status === 401) return { valid: false, error: 'Invalid API key.' };
      if (resp.ok) return { valid: true, error: null };
      return { valid: false, error: `HTTP ${resp.status}` };
    } catch {
      return { valid: false, error: 'Network error — check your connection.' };
    }
  }

  return {
    optimizeCopy,
    generateIntelligenceReport,
    generateLogo,
    generateHeadlines,
    generateEmailSequenceLocal,
    validateApiKey,
    NICHE_PROFILES,
    getNicheContext,
  };
})();

if (typeof module !== 'undefined') module.exports = AiOptimizer;
