/**
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 * All Rights Reserved. See the LICENSE file.
 */
/**
 * Deep linking routes for iOS and Android universal links
 * GET /.well-known/apple-app-site-association - iOS Universal Links
 * GET /.well-known/assetlinks.json - Android App Links
 */

import { Router } from 'express';

export default function createDeepLinkRoutes(deps: any) {
  const { config, sendError, ErrorCodes } = deps;
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
      // Use the shared error envelope so the code is machine-readable and
      // retryable-classified, matching every other route (see lib/response.ts).
      return sendError(res, 503, 'Apple Team ID not configured', ErrorCodes.SERVICE_UNAVAILABLE);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.json({
      applinks: {
        apps: [],
        details: [
          {
            appIDs: [`${config.APPLE_TEAM_ID}.us.festie.app`],
            paths: ['/set/*', '/reset-password'],
            components: [{ '/': '/set/*' }, { '/': '/reset-password' }],
          },
        ],
      },
      webcredentials: {
        apps: [`${config.APPLE_TEAM_ID}.us.festie.app`],
      },
    });
  });

  // Android App Links for the Festie app (us.festie.app). Fingerprints come from
  // ANDROID_CERT_FINGERPRINTS (comma-separated SHA-256 in colon-hex). The
  // fingerprint is public (it's in every signed APK), not a secret. Prod's .env
  // lists the EAS signing cert; add the Play App Signing fingerprint here once on
  // the Play Store. 503 when unconfigured so we never serve an empty allowlist.
  router.get('/assetlinks.json', (req: any, res: any) => {
    if (!config.ANDROID_CERT_FINGERPRINTS || config.ANDROID_CERT_FINGERPRINTS.trim() === '') {
      return sendError(res, 503, 'Android certificate fingerprints not configured', ErrorCodes.SERVICE_UNAVAILABLE);
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.json([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'us.festie.app',
          sha256_cert_fingerprints: config.ANDROID_CERT_FINGERPRINTS.split(',')
            .map((s: string) => s.trim())
            .filter(Boolean),
        },
      },
    ]);
  });

  return router;
}
