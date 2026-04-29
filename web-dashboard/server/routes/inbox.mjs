// routes/inbox.mjs - POST /api/inbox/add { url }
//
// Single-URL inbox: lets the user (Cmd+J in the dashboard) drop a URL into
// data/pipeline.md as a Pending row without spinning up a full /faber scan.
// Bypasses title_filter — if the user typed it, they want it.
//
// Returns 200 with the appended row, 400 on bad input, 409 on duplicates.

import { appendInboxUrl } from '../writers/pipeline-inbox.mjs';

export function registerInboxRoutes(app, { careerOpsRoot }) {
  app.post('/api/inbox/add', async (req, reply) => {
    const { url } = req.body ?? {};
    const result = await appendInboxUrl(careerOpsRoot, url);
    if (!result.ok) {
      return reply.code(result.code ?? 500).send({ error: result.error });
    }
    return reply.send({ ok: true, row: result.row });
  });
}
