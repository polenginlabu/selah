// Pure helpers shared by the consolidation data layer and the DiscipleTree UI.
// Kept free of any imports so they're unit-testable with node --test.

// The de-identified ref the AI agent uses for a person is the first 8 chars of
// the disciple id (see 20260915b_discipleship_signals.sql: left(id::text, 8)).
// Matching ids to refs happens client-side so real names never go to the model
// provider — the agent only ever sees refs.
export function refOf(id) {
  return String(id ?? '').slice(0, 8).toLowerCase()
}

/** A map ref -> person for any flat list of tree nodes that carry `id`/`name`. */
export function buildRefIndex(nodes) {
  const index = {}
  for (const node of nodes ?? []) index[refOf(node.id)] = node
  return index
}

// Normalise whatever the agent returned into a stable shape the UI can render,
// so a missing field never crashes the panel.
export function normalizeReport(report) {
  if (!report || typeof report !== 'object') return null
  const tree = report.tree && typeof report.tree === 'object' ? report.tree : {}
  return {
    generatedAt: typeof report.generated_at === 'string' ? report.generated_at : null,
    tree: {
      summary: typeof tree.summary === 'string' ? tree.summary : '',
      flags: Array.isArray(tree.flags) ? tree.flags : [],
    },
    people: Array.isArray(report.people) ? report.people : [],
  }
}