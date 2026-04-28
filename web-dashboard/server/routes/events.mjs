// routes/events.mjs - SSE endpoint, fan-out for file-change and job events.
//
// Event payload shape on the wire (SSE `data: <json>`):
//   { type: 'file',  kind, path }
//   { type: 'job',   event: 'update' | 'remove', job? , id? }
//   { type: 'hello', ts }    (sent immediately on connect)
//
// Clients reconnect automatically (native EventSource behavior). We do not
// try to maintain a replay buffer; the UI does a full refetch on reconnect.

export function registerEventsRoute(app, { fileEmitter, jobs }) {
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders?.();

    const write = (payload) => {
      try {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch {
        // client gone
      }
    };

    write({ type: 'hello', ts: Date.now() });

    const onFile = (ev) => write({ type: 'file', kind: ev.kind, path: ev.path });
    const onJobUpdate = (job) => write({ type: 'job', event: 'update', job });
    const onJobRemove = ({ id }) => write({ type: 'job', event: 'remove', id });

    fileEmitter.on('change', onFile);
    jobs.on('update', onJobUpdate);
    jobs.on('remove', onJobRemove);

    const keepalive = setInterval(() => {
      try {
        reply.raw.write(': keepalive\n\n');
      } catch {
        // dead; the 'close' handler below will clean up
      }
    }, 15_000);

    req.raw.on('close', () => {
      clearInterval(keepalive);
      fileEmitter.off('change', onFile);
      jobs.off('update', onJobUpdate);
      jobs.off('remove', onJobRemove);
    });
  });
}
