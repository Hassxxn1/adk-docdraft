// Small shared helpers for request handlers.
class HttpError extends Error {
  constructor(status, message, problems) { super(message); this.status = status; this.problems = problems; }
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const clean = (v, max = 8000) => String(v ?? '').slice(0, max).trim();

module.exports = { HttpError, wrap, clean };
