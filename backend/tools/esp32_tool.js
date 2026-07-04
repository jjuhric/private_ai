// Use global fetch

/**
 * Sends a command to an ESP32 node via HTTP.
 * This can be used for GPIO writes or reads.
 */
async function handleEsp32Tool(nodeIp, nodePort, action, params, bridgeSecret) {
  try {
    const url = `http://${nodeIp}:${nodePort}/api/gpio/${action}`;
    const headers = { 'Content-Type': 'application/json' };
    if (bridgeSecret) {
      headers['Authorization'] = `Bearer ${bridgeSecret}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params)
    });

    if (!res.ok) {
      throw new Error(`ESP32 responded with status: ${res.status}`);
    }

    const data = await res.json();
    return JSON.stringify(data);
  } catch (err) {
    return `Failed to communicate with ESP32 at ${nodeIp}: ${err.message}`;
  }
}

module.exports = {
  handleEsp32Tool
};
