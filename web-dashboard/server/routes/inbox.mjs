// routes/inbox.mjs - queue-mutating operations.
//
//   POST /api/inbox/add     { url }   — append a URL as a Pending row
//   POST /api/inbox/remove  { url }   — hard-remove a URL (pending OR evaluated)
//
// Cmd+J in the dashboard hits add. The per-row × in the queue hits remove.
// Both operations write a `data/pipeline.md.bak` snapshot before mutating.
// Using POST for remove keeps method+body semantics consistent across the
// pair and avoids DELETE-with-body weirdness in some HTTP stacks.

import { appendInboxUrl } from '../writers/pipeline-inbox.mjs';
import { removePipelineUrl } from '../writers/pipeline-remove.mjs';

export function registerInboxRoutes(app, { careerOpsRoot }) {
  app.post('/api/inbox/add', async (req, reply) => {
    const { url } = req.body ?? {};
    const result = await appendInboxUrl(careerOpsRoot, url);
    if (!result.ok) {
      return reply.code(result.code ?? 500).send({ error: result.error });
    }
    return reply.send({ ok: true, row: result.row });
  });

  app.post('/api/inbox/remove', async (req, reply) => {
    const { url } = req.body ?? {};
    if (!url || typeof url !== 'string') {
      return reply.code(400).send({ error: 'url required' });
    }
    const result = await removePipelineUrl(careerOpsRoot, url);
    if (!result.ok) {
      // 404 when the URL wasn't in pipeline.md — could be a race with another
      // tab. Frontend treats this the same as success (the row is gone).
      const code = result.reason === 'url not found in pipeline.md' ? 404 : 500;
      return reply.code(code).send({ error: result.reason });
    }
    return reply.send({ ok: true });
  });
}
