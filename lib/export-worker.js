'use strict';

const { parentPort } = require('worker_threads');
const { buildExportHtml } = require('./helpers');

parentPort.on('message', (msg) => {
  try {
    if (typeof msg.template !== 'string' || msg.template.length === 0) {
      throw new Error('Export template is missing or invalid');
    }
    const html = buildExportHtml(msg.template, msg.festival, msg.profile, msg.allProfiles, msg.exportedAt);
    parentPort.postMessage({ html });
  } catch (err) {
    parentPort.postMessage({ error: true, message: String(err && err.message || 'Unknown export error').slice(0, 200) });
  }
});
