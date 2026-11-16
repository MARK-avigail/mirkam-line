// Authentication/HTTP-upgrade diagnostic only: never sends session.start or audio.
const https = require('node:https');
const { randomBytes, createHash } = require('node:crypto');

function check({ request = https.request, env = process.env, timeoutMs = 10000 } = {}) {
  return new Promise(resolve => {
    if (!env.OPENAI_API_KEY || !env.MIRKAM_LIVE_PROJECT_ID) {
      resolve({ result: 'CONFIGURATION_MISSING', session_start_sent: false });
      return;
    }
    let done = false, timer, req;
    const finish = result => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ...result, session_start_sent: false });
    };
    try {
      const websocketKey = randomBytes(16).toString('base64');
      const expectedAccept = createHash('sha1')
        .update(websocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      req = request('https://api.openai.com/v1/live/sessions', {
        method: 'GET', headers: {
          Authorization: 'Bearer ' + env.OPENAI_API_KEY,
          'OpenAI-Project': env.MIRKAM_LIVE_PROJECT_ID,
          Connection: 'Upgrade', Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': websocketKey,
        },
      });
      req.once('upgrade', (response, socket) => {
        // Close transport immediately; no WebSocket application frames are sent.
        const headers = response.headers || {};
        const valid = response.statusCode === 101
          && String(headers.upgrade || '').toLowerCase() === 'websocket'
          && String(headers.connection || '').toLowerCase().split(',').map(x => x.trim()).includes('upgrade')
          && headers['sec-websocket-accept'] === expectedAccept;
        finish({ result: valid ? 'HTTP_UPGRADE_ACCEPTED' : 'INVALID_WEBSOCKET_HANDSHAKE', http_status: response.statusCode });
        socket.destroy();
      });
      req.once('response', response => {
        const result = { result: 'HTTP_UPGRADE_REJECTED', http_status: response.statusCode };
        const retry = response.headers?.['retry-after'];
        if (typeof retry === 'string' && /^\d{1,8}$/.test(retry)) result.retry_after_seconds = Number(retry);
        finish(result);
        response.destroy(); // no redirects, response bodies or provider messages logged
      });
      req.once('error', error => {
        const safe = ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'ETIMEDOUT',
          'EAI_AGAIN', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
        finish({ result: 'NETWORK_ERROR', code: safe.includes(error.code) ? error.code : 'UNCLASSIFIED' });
      });
      timer = setTimeout(() => {
        finish({ result: 'NETWORK_TIMEOUT' });
        req.destroy();
      }, timeoutMs);
      req.end();
    } catch {
      finish({ result: 'LOCAL_REQUEST_ERROR' });
      req?.destroy();
    }
  });
}

module.exports = { check };
if (require.main === module || module.id === '[stdin]') {
  check().then(result => {
    console.log('VOICE_HANDSHAKE: ' + JSON.stringify(result));
    process.exitCode = result.result === 'HTTP_UPGRADE_ACCEPTED' ? 0 : 2;
  });
}
