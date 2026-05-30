/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * Licensed under the Business Source License 1.1. See LICENSE file for details.
 */
/**
 * Deep linking routes for iOS and Android universal links
 * GET /.well-known/apple-app-site-association - iOS Universal Links
 * GET /.well-known/assetlinks.json - Android App Links
 */

import { Router } from 'express';

export default function createDeepLinkRoutes(deps: any) {
  const { config } = deps;
  const router = Router();

  // Apple App Site Association for universal links (iOS deep linking)
  // NOTE: iOS configuration incomplete — APPLE_TEAM_ID must be set to a real value
  // once an iOS build is created. To set up:
  //   1. Build iOS app in Xcode with bundle ID matching appIDs below
  //   2. Extract Team ID from Apple Developer account
  //   3. Set environment variable: APPLE_TEAM_ID=10ABCDEFGH
  //   4. Verify universal links work on iOS device: Settings > Developer > App Links
  router.get('/apple-app-site-association', (req: any, res: any) => {
    // SECURITY: Validate that APPLE_TEAM_ID is configured (not placeholder/default)
    if (!config.APPLE_TEAM_ID || config.APPLE_TEAM_ID === 'TEAMID' || config.APPLE_TEAM_ID.trim() === '') {
      res.status(503);
      return res.json({ error: 'Apple Team ID not configured' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.json({
      applinks: {
        apps: [],
        details: [{
          appIDs: [
            `${config.APPLE_TEAM_ID}.us.festie.app`,
          ],
          paths: ['/set/*'],
          components: [
            { '/': '/set/*' },
          ],
        }],
      },
      webcredentials: {
        apps: [`${config.APPLE_TEAM_ID}.us.festie.app`],
      },
    });
  });

  // Android App Links for the Festie app (us.festie.app). Fingerprints come
  // from ANDROID_CERT_FINGERPRINTS (comma-separated SHA-256 in colon-hex) when
  // set, otherwise fall back to the known EAS signing-cert fingerprint so links
  // verify out of the box. The fingerprint is public (it's in every signed APK),
  // not a secret. Add the Play App Signing fingerprint here once on the Play Store.
  router.get('/assetlinks.json', (req: any, res: any) => {
    const FALLBACK_SHA256 =
      '0C:49:FB:87:94:C5:D4:39:F8:BE:BD:D1:D3:78:B9:CD:B8:40:7E:4E:4C:A3:73:96:73:57:13:79:B8:92:6D:01';
    const raw =
      config.ANDROID_CERT_FINGERPRINTS && config.ANDROID_CERT_FINGERPRINTS.trim() !== ''
        ? config.ANDROID_CERT_FINGERPRINTS
        : FALLBACK_SHA256;
    const fingerprints = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'us.festie.app',
        sha256_cert_fingerprints: fingerprints,
      },
    }]);
  });

  return router;
}
