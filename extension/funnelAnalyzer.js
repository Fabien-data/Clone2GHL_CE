/**
 * funnelAnalyzer.js
 * Funnel Intelligence Engine — analyzes page structure to explain WHY a funnel converts.
 * Returns a structured report with score, insights, and recommendations.
 */

const FunnelAnalyzer = (() => {

  const HEADLINE_PATTERNS = {
    curiosity: [/secret/i, /nobody tells/i, /they don't want/i, /hidden/i, /warning/i, /truth about/i, /stop/i],
    benefit: [/save/i, /get free/i, /lose/i, /earn/i, /increase/i, /boost/i, /grow/i, /discover/i, /how to/i],
    urgency: [/today/i, /now/i, /last chance/i, /limited/i, /expires/i, /ending soon/i, /only \d+/i, /hurry/i],
    social_proof: [/\d+\+?\s*(clients|customers|people|members|reviews|students)/i, /trusted by/i, /join \d+/i],
    problem_aware: [/tired of/i, /sick of/i, /struggling with/i, /stop wasting/i, /still paying/i, /can't afford/i],
    number: [/\d+\s*(ways|steps|secrets|tips|reasons|mistakes)/i],
  };

  const TRUST_SIGNALS = [
    { pattern: /\d+[\+,]?\s*(reviews|ratings|testimonials)/i, label: 'Customer reviews count', weight: 8 },
    { pattern: /★|⭐|\d\.\d\s*(stars?|\/5|out of)/i, label: 'Star rating displayed', weight: 7 },
    { pattern: /licensed|insured|certified|accredited/i, label: 'Professional credentials', weight: 8 },
    { pattern: /guarantee|refund|money.back/i, label: 'Money-back guarantee', weight: 9 },
    { pattern: /ssl|secure|encrypted|\uD83D\uDD12/i, label: 'Security trust badge', weight: 6 },
    { pattern: /bbb|better business|a\+ rated/i, label: 'BBB / industry accreditation', weight: 7 },
    { pattern: /no\s*(contract|commitment|obligation)/i, label: 'Risk-reversal language', weight: 8 },
    { pattern: /as seen|featured in|press/i, label: 'Media/press mention', weight: 7 },
    { pattern: /\d+\s*years?\s*(experience|in business)/i, label: 'Years in business', weight: 6 },
    { pattern: /privacy|never share|confidential/i, label: 'Privacy assurance', weight: 5 },
  ];

  const URGENCY_PATTERNS = [
    { pattern: /limited\s*(time|spots?|offer|availability)/i, label: 'Limited availability claim' },
    { pattern: /only\s*\d+\s*(left|remaining|spots?)/i, label: 'Scarcity counter' },
    { pattern: /expires?|expiring|ends?\s*(tonight|today|soon)/i, label: 'Deadline/expiry' },
    { pattern: /today only|24.hour|this\s*week only/i, label: 'Time-bound offer' },
    { pattern: /\d+\s*people\s*(viewing|looking|bought)/i, label: 'Social proof urgency' },
    { pattern: /act now|don't (miss|wait|delay)/i, label: 'Direct urgency command' },
  ];

  function detectHeadlineTypes(headlines) {
    const types = [];
    for (const h of headlines) {
      const text = h.text;
      for (const [type, patterns] of Object.entries(HEADLINE_PATTERNS)) {
        if (patterns.some(p => p.test(text))) {
          types.push({ type, text: text.slice(0, 80) });
          break;
        }
      }
    }
    return types;
  }

  function detectTrustSignals(bodyText) {
    const found = [];
    for (const signal of TRUST_SIGNALS) {
      if (signal.pattern.test(bodyText)) {
        found.push({ label: signal.label, weight: signal.weight });
      }
    }
    return found;
  }

  function detectUrgency(bodyText) {
    const found = [];
    for (const u of URGENCY_PATTERNS) {
      if (u.pattern.test(bodyText)) found.push(u.label);
    }
    return found;
  }

  function analyzeCTAPlacement(ctaButtons, bodyText) {
    const insights = [];
    const ctaCount = ctaButtons.length;

    if (ctaCount === 0) {
      insights.push({ type: 'warning', text: 'No clear CTA button found. Add a prominent call-to-action.' });
    } else if (ctaCount === 1) {
      insights.push({ type: 'good', text: 'Single focused CTA — reduces decision fatigue.' });
    } else if (ctaCount >= 2 && ctaCount <= 4) {
      insights.push({ type: 'good', text: `${ctaCount} CTAs present — good for above-the-fold + mid-page reinforcement.` });
    } else {
      insights.push({ type: 'warning', text: `${ctaCount} CTAs may overwhelm. Consider consolidating to 2–3 maximum.` });
    }

    const ctaTexts = ctaButtons.map(b => b.text.toLowerCase());
    const hasActionVerb = ctaTexts.some(t => /get|start|claim|book|try|join|download|access|unlock|discover/.test(t));
    if (hasActionVerb) {
      insights.push({ type: 'good', text: 'CTA uses action-oriented verb (get, claim, book, etc.).' });
    } else {
      insights.push({ type: 'tip', text: 'Consider stronger action verbs in CTA: "Claim", "Get", "Start", "Book".' });
    }

    const hasFreeInCta = ctaTexts.some(t => /free/.test(t));
    if (hasFreeInCta) insights.push({ type: 'good', text: 'CTA mentions "FREE" — lowers resistance significantly.' });

    const hasArrow = ctaTexts.some(t => /→|>>|»/.test(t));
    if (hasArrow) insights.push({ type: 'good', text: 'CTA has directional arrow — signals forward momentum.' });

    return insights;
  }

  function analyzeFormFriction(forms) {
    const insights = [];
    if (forms.length === 0) {
      insights.push({ type: 'neutral', text: 'No form detected on page.' });
      return insights;
    }

    for (const form of forms) {
      const fieldCount = form.fields.length;
      if (fieldCount <= 2) {
        insights.push({ type: 'good', text: `Low-friction form (${fieldCount} fields) — maximizes completion rate.` });
      } else if (fieldCount <= 4) {
        insights.push({ type: 'good', text: `Moderate form length (${fieldCount} fields) — acceptable for lead gen.` });
      } else {
        insights.push({ type: 'warning', text: `High-friction form (${fieldCount} fields) — consider reducing to 3–4 max.` });
      }

      const hasPhone = form.fields.some(f => f.type === 'tel' || /phone|mobile/i.test(f.name));
      if (hasPhone) insights.push({ type: 'tip', text: 'Phone field present — great for high-intent lead capture, but can reduce volume.' });

      const hasCreditCard = form.fields.some(f => /credit|card|payment/i.test(f.name));
      if (hasCreditCard) insights.push({ type: 'neutral', text: 'Credit card field detected — this is a direct sales page, not pure lead gen.' });
    }

    return insights;
  }

  function analyzeSocialProof(testimonials, trustSignals, bodyText) {
    const insights = [];

    if (testimonials.length > 0) {
      insights.push({ type: 'good', text: `${testimonials.length} testimonial(s) found — social proof above the fold increases trust.` });
    } else {
      insights.push({ type: 'tip', text: 'No testimonials detected. Adding 2–3 customer quotes can increase conversions by 15–34%.' });
    }

    const foundSignals = detectTrustSignals(bodyText);
    const totalTrustWeight = foundSignals.reduce((sum, s) => sum + s.weight, 0);

    if (foundSignals.length >= 3) {
      insights.push({ type: 'good', text: `Strong trust stack: ${foundSignals.map(s => s.label).join(', ')}.` });
    } else if (foundSignals.length > 0) {
      insights.push({ type: 'good', text: `Trust signals present: ${foundSignals.map(s => s.label).join(', ')}.` });
    } else {
      insights.push({ type: 'warning', text: 'No trust signals found. Add badges, reviews, or credentials.' });
    }

    return { insights, foundSignals, totalTrustWeight };
  }

  function detectNiche(bodyText, headlines) {
    const text = bodyText.toLowerCase();
    const headlineText = headlines.map(h => h.text).join(' ').toLowerCase();
    const combined = text + ' ' + headlineText;

    const niches = {
      plumber: /plumb|pipe|drain|leak|faucet/,
      electrician: /electric|wiring|panel|outlet|circuit/,
      hvac: /hvac|ac repair|air condition|heating|furnace|cooling/,
      roofing: /roof|shingle|gutter|storm damage/,
      cleaning: /carpet|cleaning|maid|janitorial/,
      landscaping: /lawn|landscap|mowing|garden/,
      solar: /solar|energy|utility bill|electricity|panel/,
      real_estate: /home value|real estate|property|listing|mortgage|buyer|seller/,
      gym: /gym|fitness|workout|weight loss|muscle|training/,
      dental: /dental|dentist|teeth|smile|cavity|orthodont/,
      coaching: /coaching|mentor|consultant|business growth|revenue/,
      insurance: /insurance|coverage|premium|policy|claim/,
      legal: /attorney|lawyer|legal|lawsuit|injury|settlement/,
      marketing_agency: /marketing|ads|facebook|google ads|lead generation|agency/,
      weight_loss: /weight loss|diet|slim|fat|transform|pounds/,
    };

    for (const [niche, pattern] of Object.entries(niches)) {
      if (pattern.test(combined)) return niche;
    }
    return 'general';
  }

  function scoreFunnel(analysis) {
    let score = 0;
    const maxScore = 100;

    // Headlines (20 pts)
    if (analysis.headlineTypes.length > 0) score += 10;
    if (analysis.headlineTypes.some(h => h.type === 'benefit' || h.type === 'urgency')) score += 10;

    // CTAs (20 pts)
    const goodCtas = analysis.ctaInsights.filter(i => i.type === 'good').length;
    const warnCtas = analysis.ctaInsights.filter(i => i.type === 'warning').length;
    score += Math.min(20, goodCtas * 5 - warnCtas * 5);

    // Forms (15 pts)
    const goodForms = analysis.formInsights.filter(i => i.type === 'good').length;
    score += Math.min(15, goodForms * 7);

    // Trust (25 pts)
    score += Math.min(25, analysis.trustScore.totalTrustWeight);

    // Urgency (10 pts)
    if (analysis.urgencyElements.length > 0) score += Math.min(10, analysis.urgencyElements.length * 4);

    // Social proof (10 pts)
    if (analysis.trustScore.insights.some(i => i.type === 'good')) score += 10;

    return Math.max(0, Math.min(maxScore, score));
  }

  function generateRecommendations(analysis) {
    const recs = [];

    if (analysis.headlineTypes.length === 0) {
      recs.push({ priority: 'high', action: 'Add a powerful H1 headline using benefit or urgency framing.' });
    }
    if (!analysis.headlineTypes.some(h => h.type === 'benefit')) {
      recs.push({ priority: 'high', action: 'Rewrite headline to lead with a clear, specific benefit.' });
    }
    if (analysis.urgencyElements.length === 0) {
      recs.push({ priority: 'medium', action: 'Add urgency: limited spots, countdown timer, or time-bound offer.' });
    }
    if (analysis.trustScore.foundSignals.length < 2) {
      recs.push({ priority: 'high', action: 'Add at least 2 trust signals: star rating, license badge, or guarantee.' });
    }
    if (analysis.forms.length > 0 && analysis.forms[0].fields.length > 4) {
      recs.push({ priority: 'medium', action: `Reduce form fields from ${analysis.forms[0].fields.length} to 3–4 max to reduce friction.` });
    }
    if (analysis.testimonials.length === 0) {
      recs.push({ priority: 'medium', action: 'Add 2–3 customer testimonials with specific results.' });
    }

    return recs;
  }

  /**
   * Main analysis entry point.
   * @param {Object} structure - Output from DomExtractor.extractStructure()
   * @returns {Object} Full analysis report
   */
  function analyze(structure) {
    const { headlines, ctaButtons, forms, testimonials, bodyText, sections, trustSignals } = structure;

    const headlineTypes = detectHeadlineTypes(headlines);
    const urgencyElements = detectUrgency(bodyText);
    const ctaInsights = analyzeCTAPlacement(ctaButtons, bodyText);
    const formInsights = analyzeFormFriction(forms);
    const trustScore = analyzeSocialProof(testimonials, trustSignals, bodyText);
    const detectedNiche = detectNiche(bodyText, headlines);

    const analysis = {
      detectedNiche,
      headlineTypes,
      urgencyElements,
      ctaInsights,
      formInsights,
      trustScore,
      forms,
      testimonials,
      sections: sections.length,
    };

    const score = scoreFunnel(analysis);
    const recommendations = generateRecommendations(analysis);

    const summary = buildSummary(analysis, score);

    return {
      score,
      grade: score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F',
      detectedNiche,
      summary,
      headlineTypes,
      urgencyElements,
      ctaInsights,
      formInsights,
      trustSignals: trustScore.foundSignals,
      testimonialCount: testimonials.length,
      sectionCount: sections.length,
      recommendations,
      analyzedAt: new Date().toISOString(),
    };
  }

  function buildSummary(analysis, score) {
    const lines = [];

    if (score >= 70) {
      lines.push('This funnel is well-structured and likely converting above average.');
    } else if (score >= 50) {
      lines.push('This funnel has a solid foundation with room for improvement.');
    } else {
      lines.push('This funnel needs significant optimization before deployment.');
    }

    if (analysis.headlineTypes.some(h => h.type === 'benefit')) {
      lines.push('✓ Benefit-driven headline draws attention to the value offered.');
    }
    if (analysis.urgencyElements.length > 0) {
      lines.push(`✓ Urgency elements present (${analysis.urgencyElements[0]}).`);
    }
    if (analysis.trustScore.foundSignals.length >= 2) {
      lines.push('✓ Strong trust stack with multiple credibility signals.');
    }
    if (analysis.ctaInsights.filter(i => i.type === 'good').length >= 2) {
      lines.push('✓ CTA is action-oriented and friction-reducing.');
    }
    if (analysis.forms.length > 0 && analysis.forms[0].fields.length <= 3) {
      lines.push('✓ Low-friction form optimized for high completion rate.');
    }

    return lines.join(' ');
  }

  return { analyze, detectNiche };
})();

if (typeof module !== 'undefined') module.exports = FunnelAnalyzer;
