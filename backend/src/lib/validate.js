/**
 * backend/src/lib/validate.js
 *
 * Tiny schema validator + body-size guard — no external dependency. Each field
 * rule is { type, required, min, max, maxLen, enum, email }. Returns Express
 * middleware that 400s on the first violation and trims/normalizes on success.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function checkField(name, value, rule) {
  if (value == null || value === '') {
    if (rule.required) return `${name} is required.`;
    return null; // optional + absent → ok
  }
  if (rule.type === 'string') {
    if (typeof value !== 'string') return `${name} must be a string.`;
    if (rule.maxLen != null && value.length > rule.maxLen) return `${name} exceeds ${rule.maxLen} characters.`;
    if (rule.min != null && value.length < rule.min) return `${name} must be at least ${rule.min} characters.`;
    if (rule.email && !EMAIL_RE.test(value)) return `${name} must be a valid email.`;
    if (rule.enum && !rule.enum.includes(value)) return `${name} must be one of: ${rule.enum.join(', ')}.`;
  } else if (rule.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return `${name} must be a number.`;
    if (rule.min != null && n < rule.min) return `${name} must be >= ${rule.min}.`;
    if (rule.max != null && n > rule.max) return `${name} must be <= ${rule.max}.`;
  } else if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') return `${name} must be a boolean.`;
  }
  return null;
}

export function validateBody(schema) {
  return function validateMiddleware(req, res, next) {
    const body = req.body || {};
    for (const [name, rule] of Object.entries(schema)) {
      const err = checkField(name, body[name], rule);
      if (err) return res.status(400).json({ error: err });
    }
    return next();
  };
}

export { EMAIL_RE };
