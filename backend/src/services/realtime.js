const clients = new Set();

function writeEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function sseHandler(req, res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const client = { res };
  clients.add(client);
  writeEvent(res, 'connected', { ok: true, at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      clients.delete(client);
      return;
    }

    writeEvent(res, 'ping', { at: new Date().toISOString() });
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(client);
  });
}

export function broadcastDataChange(resource, detail = {}) {
  const payload = {
    resource,
    ...detail,
    at: new Date().toISOString()
  };

  for (const client of clients) {
    try {
      if (client.res.writableEnded) {
        clients.delete(client);
        continue;
      }

      writeEvent(client.res, 'data-change', payload);
    } catch {
      clients.delete(client);
    }
  }
}