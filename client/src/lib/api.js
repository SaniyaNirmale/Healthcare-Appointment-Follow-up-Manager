// Reads from VITE_API_URL if configured, otherwise automatically
// uses localhost:5000 in local dev mode, and relative URL path in production.
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000' : '');

export default API_BASE;
