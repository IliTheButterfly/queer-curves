// Pure SPA: no SSR, no prerendering. The Matrix-based E2EE design means the
// server can't render content meaningfully — see STACK.md §3.
export const ssr = false;
export const prerender = false;
