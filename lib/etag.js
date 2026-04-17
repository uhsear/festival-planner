'use strict';

const crypto = require('crypto');

/**
 * Create ETag from response data using MD5 hash.
 * @param {*} data - Data to hash (will be JSON stringified)
 * @returns {string} ETag value (e.g., '"abc123def456"')
 */
function createETag(data) {
  const hash = crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  return `"${hash}"`;
}

/**
 * Check if client-provided ETag matches current data.
 * @param {string} clientETag - ETag from If-None-Match header
 * @param {string} currentETag - ETag of current data
 * @returns {boolean} true if ETags match (304 eligible)
 */
function etagMatches(clientETag, currentETag) {
  if (!clientETag) return false;
  // Support weak ETags: parse and compare the hash part
  const normalize = (tag) => tag.replace(/^W\//, '').replace(/"/g, '');
  return normalize(clientETag) === normalize(currentETag);
}

/**
 * Create ETag middleware/response helper.
 * @param {object} [config={}] - Configuration
 * @param {number} [config.maxAge] - Cache-Control max-age in seconds
 * @returns {object} Helper functions
 */
function createETagMiddleware(config = {}) {
  const { maxAge = 60 } = config;

  /**
   * Send a response with ETag support.
   * Checks If-None-Match header and returns 304 if ETag matches.
   * Otherwise sets ETag and Cache-Control headers and sends data.
   * @param {object} req - Express request
   * @param {object} res - Express response
   * @param {*} data - Response payload
   * @param {object} [options={}] - Response options
   * @param {boolean} [options.etag=true] - Enable ETag generation
   * @param {number} [options.maxAge] - Override default maxAge (seconds)
   * @param {boolean} [options.private=false] - Set Cache-Control to private
   */
  function etagResponse(req, res, data, options = {}) {
    const {
      etag: enableETag = true,
      maxAge: optionsMaxAge,
      private: isPrivate = false,
    } = options;

    if (!enableETag) {
      return res.json({ data, error: null });
    }

    const currentETag = createETag(data);
    const clientETag = req.get('If-None-Match');

    // 304 Not Modified if ETag matches
    if (etagMatches(clientETag, currentETag)) {
      res.set('ETag', currentETag);
      res.set('Cache-Control', buildCacheControl(optionsMaxAge || maxAge, isPrivate));
      return res.status(304).end();
    }

    // Set cache headers
    res.set('ETag', currentETag);
    res.set('Cache-Control', buildCacheControl(optionsMaxAge || maxAge, isPrivate));

    // Send response
    return res.json({ data, error: null });
  }

  return { etagResponse, createETag, etagMatches };
}

/**
 * Build Cache-Control header value.
 * @param {number} maxAge - Max age in seconds
 * @param {boolean} isPrivate - Whether cache is private
 * @returns {string} Cache-Control header value
 */
function buildCacheControl(maxAge, isPrivate = false) {
  const scope = isPrivate ? 'private' : 'public';
  return `${scope}, max-age=${maxAge}`;
}

module.exports = {
  createETagMiddleware,
  createETag,
  etagMatches,
  buildCacheControl,
};
