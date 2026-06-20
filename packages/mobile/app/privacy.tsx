import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { makeStyles, typeStyle, useTokens } from '../hooks/useTokens';
import { useListBottomInset } from '../hooks/useListBottomInset';

/**
 * Privacy Policy screen — a self-contained native mirror of the canonical
 * static document served on web at /privacy.html.
 *
 * The web policy remains the single source of truth; this screen reproduces
 * its section content (effective May 31, 2026) as a typed data array so it
 * renders like the rest of the app and works offline. Emails open the mail
 * client and the Terms reference opens the web Terms of Service.
 */

const CONTACT_EMAIL = 'privacy@festie.us';
const SERVICE_URL = 'https://festie.us';
const TERMS_URL = 'https://festie.us/terms.html';

const openEmail = () => {
  void Linking.openURL(`mailto:${CONTACT_EMAIL}`);
};

const openService = () => {
  void Linking.openURL(SERVICE_URL);
};

const openTerms = () => {
  void Linking.openURL(TERMS_URL);
};

interface Subsection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

interface PolicySection {
  title: string;
  body?: string[];
  subsections?: Subsection[];
}

const SECTIONS: PolicySection[] = [
  {
    title: 'Data Controller & Contact Information',
    body: [
      'Festie is operated by Asir Khan, who serves as the data controller for personal data processed through the service. The service is self-hosted on-premise infrastructure.',
      'For privacy-related inquiries, requests to exercise data subject rights, or concerns about your personal data, please contact the email address below. We will respond to all requests within 30 days.',
    ],
  },
  {
    title: 'Categories of Personal Data Collected',
    body: ['Festie collects and processes the following categories of personal data:'],
    subsections: [
      {
        heading: 'Account Information',
        bullets: [
          'Username: User-selected identifier for account access and display within the platform',
          'Password Hash: Passwords are hashed using Scrypt before storage and are never accessible to us or stored in plaintext',
          'Avatar Image: Optional profile picture uploaded by the user in WebP format for display in the app',
          'Email Address: Optional email provided during registration, used for password recovery and account verification',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] Date of Birth: Collected at registration to enforce the minimum-age requirement (18+ gate). Counsel to confirm: lawful basis; whether DOB must be retained post-verification or deleted; CCPA classification; and whether self-declaration satisfies applicable standard in target markets.',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] Payment Handles: Optional peer-payment identifiers — Venmo handle, CashApp cashtag, and PayPal handle — that users may add to their profile. Visible to crew members. Used solely for peer payment coordination within crews. Festie does not transmit these to payment processors or initiate transactions. Counsel to confirm lawful basis and CCPA financial-information category applicability.',
        ],
      },
      {
        heading: 'Festival Coordination Data',
        bullets: [
          'Festival Picks: Musical acts, performances, or attractions selected and saved by the user',
          'Personal Notes: User-generated notes and scheduling information associated with selected acts',
          'Crew Memberships: Groups or crews the user is a member of and their associated role or permissions within those groups',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] Location / GPS Data: Festie stores two categories of geospatial coordinates. (1) Crew member location snapshot — your device\'s last-known latitude and longitude captured as a degraded-sync breadcrumb when you report status while offline; visible to all crew members. (2) Meeting point coordinates — latitude and longitude of crew meeting points you create. Both are precision geospatial data linked to your user ID and a capture timestamp. Purpose: crew safety and coordination. Counsel to confirm: lawful basis (LIA or consent); GDPR Recital 75 risk assessment; CCPA sensitive geolocation category; SOS opt-out scope; and deletion cascade on account removal.',
        ],
      },
      {
        heading: 'Communication Data',
        bullets: [
          'Device Tokens: Push notification tokens used exclusively for sending festival-related notifications and schedule updates',
        ],
      },
      // DRAFT: pending legal review
      {
        heading: '[DRAFT — pending legal review] Third-Party Account Linkage',
        bullets: [
          '[DRAFT — pending legal review] Spotify Account Linkage: If you connect your Spotify account, Festie stores your Spotify user ID, an AES-256-GCM encrypted OAuth refresh token, the OAuth scopes you granted, and linkage timestamps. Spotify access tokens are not persisted. Used to personalise artist and lineup content. Counsel to confirm: Spotify Developer Policy compliance; lawful basis (consent); whether Spotify is a controller or processor for the OAuth exchange.',
        ],
      },
      {
        heading: 'Technical Data',
        bullets: [
          'IP Address: Your IP address is collected for security purposes, rate limiting, and abuse prevention',
          'Session Data: Session identifiers and authentication tokens to maintain your logged-in state',
        ],
      },
    ],
  },
  {
    title: 'Legal Basis for Processing',
    body: ['We process your personal data under the following lawful bases:'],
    subsections: [
      {
        heading: 'Contract Performance',
        paragraphs: [
          'The collection and processing of account data, festival picks, notes, and crew memberships is necessary for the performance of the contract between you and us. These data are essential to provide the core festival coordination service you are using.',
        ],
      },
      {
        heading: 'Consent',
        paragraphs: [
          'We process device tokens for push notifications based on your explicit consent. You grant this consent when you authorize push notifications during account setup or in your device settings. You may withdraw this consent at any time through your account settings.',
        ],
      },
      {
        heading: 'Legitimate Interest',
        paragraphs: [
          'We process IP addresses and session data based on our legitimate interest in maintaining service security, preventing fraud and abuse, enforcing our terms of service, and monitoring and improving platform performance and reliability. We have balanced these interests against your privacy rights and have implemented appropriate safeguards.',
        ],
      },
    ],
  },
  {
    title: 'Data Retention Periods',
    body: [
      'We retain personal data only for as long as necessary to fulfill the purposes for which it was collected or as required by law:',
    ],
    subsections: [
      {
        heading: 'Account Data',
        bullets: [
          'Duration: Retained for the lifetime of your account',
          'Upon Deletion: Your account deletion request initiates a 30-day grace period during which your data is accessible for restoration. After 30 days, all account data (username, password hash, avatar) is permanently deleted',
        ],
      },
      {
        heading: 'Backups & Disaster Recovery',
        bullets: [
          'Duration: Automated backups are retained for a maximum of 28 days (4 weekly backup cycles)',
          'Purging Schedule: Backups older than 28 days are automatically purged and permanently deleted from backup systems',
        ],
      },
      {
        heading: 'Session Data & Authentication Tokens',
        bullets: [
          'Duration: Session data and authentication tokens are retained for 24 hours',
          'Automatic Expiration: Sessions automatically expire after 24 hours of inactivity for security purposes',
        ],
      },
      {
        heading: 'Avatar Images',
        bullets: [
          'Duration: Retained while your account is active',
          'Upon Deletion: Permanently deleted upon account deletion after the 30-day grace period',
        ],
      },
    ],
  },
  {
    title: 'Your Data Subject Rights',
    body: ['Under applicable data protection laws, you have the following rights regarding your personal data:'],
    subsections: [
      {
        heading: 'Right of Access',
        paragraphs: [
          'You have the right to access all personal data we hold about you. You can export a complete copy of your data in JSON format via the API endpoint GET /api/v1/account/export within your account settings. This export includes your account profile (username, avatar, preferences), festival picks and notes, crew memberships, registered device tokens, active sessions, and notification and topic-subscription preferences.',
        ],
      },
      {
        heading: 'Right of Rectification',
        paragraphs: [
          'You have the right to correct or update inaccurate personal data. You can modify your profile information, username, and avatar directly within your account settings at any time.',
        ],
      },
      {
        heading: 'Right to Erasure (Right to be Forgotten)',
        paragraphs: [
          'You have the right to request deletion of your personal data by initiating account deletion through your account settings. We will delete your account and associated data after a 30-day grace period. This grace period allows you to restore your account if deletion was accidental. After 30 days, all data is permanently deleted and cannot be recovered.',
        ],
      },
      {
        heading: 'Right to Data Portability',
        paragraphs: [
          'You have the right to receive your personal data in a structured, commonly-used, machine-readable format. You can export your data in JSON format using the API endpoint GET /api/v1/account/export, enabling you to transfer your data to another service or retain a copy.',
        ],
      },
      {
        heading: 'Right to Restrict Processing',
        paragraphs: [
          'You have the right to restrict our processing of your personal data in certain circumstances. You may disable push notifications, restrict data sharing within crew groups, or limit how your data is used by contacting us at the email below.',
        ],
      },
      {
        heading: 'Right to Object',
        paragraphs: [
          'You have the right to object to certain types of processing based on our legitimate interest. To exercise this right, contact us at the email address below.',
        ],
      },
      {
        heading: 'Exercising Your Rights',
        paragraphs: [
          'To exercise any of these rights, contact us at the email below with your request. We will respond within 30 days. Some requests may take up to 60 days depending on complexity. We will verify your identity before processing requests to ensure we are sharing information only with authorized individuals.',
        ],
      },
    ],
  },
  {
    title: 'Cookies & Session Management',
    body: ['Festie uses HTTP-only session cookies strictly for authentication and session management purposes only.'],
    subsections: [
      {
        heading: 'Cookie Usage',
        bullets: [
          'Session Cookies: HTTP-only cookies are used to maintain your authenticated session',
          'No Tracking Cookies: We do not use tracking cookies, analytics cookies, or third-party cookies for behavioral tracking',
          'No Analytics: We do not deploy cookies for analytics, advertising, or user behavior profiling',
        ],
      },
      {
        heading: 'Cookie Consent',
        paragraphs: [
          'No consent banner is required because our session cookies are exempt under ePrivacy Directive Article 5(3) as "strictly necessary" for the functioning of the service. These cookies are essential to authentication and do not require prior consent.',
        ],
      },
      {
        heading: 'Cookie Management',
        paragraphs: [
          'Session cookies are automatically deleted when you log out or after 24 hours of inactivity. You can clear cookies from your browser settings, though this will log you out of the service.',
        ],
      },
    ],
  },
  {
    title: 'Data Sub-Processors & Third Parties',
    body: ['Festie uses limited third-party services to provide specific functionality:'],
    subsections: [
      {
        heading: 'Cloudflare',
        bullets: [
          'Purpose: Content delivery network (CDN) and secure tunnel infrastructure for the application',
          'Data Processed: IP addresses, request metadata, security headers',
          'Privacy Policy: https://www.cloudflare.com/privacy/',
        ],
      },
      {
        heading: 'Firebase Cloud Messaging (FCM)',
        bullets: [
          'Purpose: Push notification delivery for festival schedule updates and crew sync alerts',
          'Data Processed: Device tokens and notification payloads',
          'Privacy Policy: https://firebase.google.com/support/privacy',
        ],
      },
      {
        heading: 'Sentry (Functional Software, Inc.)',
        bullets: [
          'Purpose: Application error tracking and performance monitoring to diagnose crashes and reliability issues',
          'Data Processed: Error and exception details, stack traces, and request metadata (sensitive headers such as cookies and authorization tokens are filtered out before transmission)',
          'Privacy Policy: https://sentry.io/privacy/',
        ],
      },
      // DRAFT: pending legal review
      {
        heading: '[DRAFT — pending legal review] Resend',
        bullets: [
          '[DRAFT — pending legal review] Purpose: Transactional and re-engagement email delivery — password reset, email verification, lineup-drop alerts, wrap-ready notifications, and crew-reform notifications',
          'Data Processed: Recipient email address, username, and notification content (festival name, crew name, invitation URLs)',
          'Privacy Policy: https://resend.com/legal/privacy-policy',
        ],
      },
      // DRAFT: pending legal review
      {
        heading: '[DRAFT — pending legal review] Apple Push Notification service (APNs)',
        bullets: [
          '[DRAFT — pending legal review] Purpose: Push notification delivery to iOS devices via a direct HTTP/2 connection to Apple\'s APNs gateway (api.push.apple.com), independently of Firebase Cloud Messaging',
          'Data Processed: APNs device token (iOS only), notification payload (title, body, category, badge count, sound)',
          'Privacy Policy: https://www.apple.com/legal/privacy/',
        ],
      },
      // DRAFT: pending legal review
      {
        heading: '[DRAFT — pending legal review] Spotify',
        bullets: [
          '[DRAFT — pending legal review] Purpose: Artist metadata retrieval for lineup display (server-side, no user data) and user OAuth account linkage to personalise content',
          'Data Processed: For lineup import: artist metadata only. For user OAuth: Spotify user ID and granted OAuth scopes exchanged during the OAuth flow; Festie retains an encrypted refresh token and Spotify user ID',
          'Privacy Policy: https://www.spotify.com/legal/privacy-policy/',
        ],
      },
      // DRAFT: pending legal review
      {
        heading: '[DRAFT — pending legal review] GitHub / Microsoft (encrypted off-site backup)',
        bullets: [
          '[DRAFT — pending legal review] Purpose: Off-site encrypted backup storage. Full PostgreSQL database dumps are encrypted with AES-256 (GPG symmetric encryption) before transmission and stored in a private GitHub repository. Up to 14 encrypted dumps are retained. GitHub is operated by GitHub, Inc., a subsidiary of Microsoft Corporation (United States)',
          'Data Processed: AES-256-encrypted database dump files. GitHub receives only ciphertext and cannot access plaintext personal data without the encryption key',
          'Privacy Policy: https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement',
        ],
      },
    ],
  },
  {
    title: 'International Data Transfers',
    body: [
      'Your personal data is primarily stored on self-hosted infrastructure operated by us. However, certain sub-processors may process your data internationally:',
    ],
    subsections: [
      {
        heading: 'Sub-Processors',
        bullets: [
          'Cloudflare: May process data in the United States and other countries',
          'Firebase Cloud Messaging: Operated by Google, may process data in the United States and other locations',
          'Sentry: Operated by Functional Software, Inc., may process error and performance data in the United States',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] Resend: Resend, Inc. may process email addresses and notification content in the United States',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] Apple Push Notification service: Apple Inc. may process iOS device tokens and notification payloads in the United States and other countries where Apple operates infrastructure',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] Spotify: Spotify AB (Sweden) and its group companies may process Spotify user IDs and OAuth scope data in the European Economic Area and the United States',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] GitHub / Microsoft (encrypted backup): Encrypted PostgreSQL backup dumps are stored on GitHub infrastructure (GitHub, Inc. / Microsoft Corporation, United States). All data is AES-256 encrypted before transmission; GitHub receives only ciphertext. Counsel to confirm: SCCs with Microsoft under GDPR Chapter V; whether encryption satisfies EDPB supplementary measure requirements',
        ],
      },
      {
        heading: 'Safeguards',
        paragraphs: [
          'Where data is transferred to countries outside your country of residence, including the United States, we rely on Standard Contractual Clauses (SCCs) to ensure adequate safeguards for your data protection rights. We have implemented appropriate technical and organizational measures to protect your data during international transfers.',
          // DRAFT: pending legal review
          '[DRAFT — pending legal review] Counsel to confirm SCCs / UK IDTA addenda are executed for Resend, Apple, Spotify, and GitHub/Microsoft before this section is finalised.',
        ],
      },
    ],
  },
  {
    title: 'Security Measures',
    body: ['We implement comprehensive technical and organizational security measures to protect your personal data:'],
    subsections: [
      {
        heading: 'Data in Transit',
        bullets: [
          'TLS 1.2+ Encryption: All data transmitted between your device and our servers is encrypted using TLS 1.2 or higher',
          'HTTPS Only: The entire application operates over secure HTTPS connections',
        ],
      },
      {
        heading: 'Data at Rest',
        bullets: [
          'Password Security: Passwords are hashed using Scrypt, a memory-hard key derivation function resistant to brute-force attacks',
          'Token Security: Authentication tokens are hashed using SHA-256 before storage',
          'Access Controls: Strict access controls limit internal access to personal data',
        ],
      },
      {
        heading: 'Application Security',
        bullets: [
          'Rate Limiting: API endpoints implement rate limiting to prevent brute-force attacks and abuse',
          'Input Validation: All user inputs are validated using Zod schemas to prevent injection attacks and malformed data',
          'Content Security Policy: CSP headers are implemented to prevent cross-site scripting (XSS) and other injection attacks',
          'CSRF Protection: Cross-site request forgery protection is implemented for state-changing operations',
        ],
      },
    ],
  },
  {
    title: "Children's Privacy",
    body: [
      'Festie is not directed to children under 13 years of age in the United States (per COPPA requirements) or under 16 years of age in certain European Union member states (per GDPR provisions).',
      'Age Requirements: By using the service, you confirm that you are at least 13 years old in the United States, or at least 16 years old in EU member states where such age restrictions apply.',
      "We do not knowingly collect personal data from children below these age thresholds. If we become aware that a child below the applicable age threshold has provided us with personal data, we will take steps to delete such information and terminate the child's account.",
      'If you believe a child has created an account in violation of these age requirements, please contact us at the email below.',
    ],
  },
  {
    title: 'Policy Changes & Updates',
    body: [
      'We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors.',
    ],
    subsections: [
      {
        heading: 'Material Changes',
        paragraphs: [
          "For material changes that affect your privacy rights or how we process your data, we will provide you with at least 30 days' notice via the Festie application interface. Your continued use of the service after the 30-day notice period constitutes your acceptance of the updated Privacy Policy.",
        ],
      },
      {
        heading: 'Minor Updates',
        paragraphs: [
          'We may update this policy for minor clarifications or non-substantive changes without notice. The effective date at the top of this document reflects the last major update.',
        ],
      },
    ],
  },
  {
    title: 'Additional Legal Documents',
    body: [
      'Please also review our Terms of Service, which govern your use of Festie and contain important limitations of liability and dispute resolution provisions.',
    ],
  },
  {
    title: 'Contact & Support',
    body: [
      'If you have questions, concerns, or requests regarding this Privacy Policy or our privacy practices, please contact us using the details below.',
      'We will respond to all privacy-related inquiries within 30 days. For data subject requests (access, deletion, portability), we will provide our response within 30 days, or up to 60 days for complex requests.',
    ],
  },
];

function Bullet({ text }: { text: string }) {
  const styles = useStyles();
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

function ContactCard() {
  const t = useTokens();
  const styles = useStyles();
  return (
    <View style={styles.contactCard}>
      <View style={styles.contactRow}>
        <Text style={styles.contactLabel}>Data Controller</Text>
        <Text style={styles.contactValue}>Asir Khan</Text>
      </View>
      <TouchableOpacity
        style={styles.contactRow}
        onPress={openEmail}
        activeOpacity={0.7}
        accessibilityRole="link"
        accessibilityLabel={`Email ${CONTACT_EMAIL}`}
      >
        <Text style={styles.contactLabel}>Email</Text>
        <View style={styles.contactLinkRow}>
          <Ionicons name="mail-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.contactLink}>{CONTACT_EMAIL}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.contactRow}
        onPress={openService}
        activeOpacity={0.7}
        accessibilityRole="link"
        accessibilityLabel={`Open ${SERVICE_URL}`}
      >
        <Text style={styles.contactLabel}>Service</Text>
        <View style={styles.contactLinkRow}>
          <Ionicons name="globe-outline" size={16} color={t.colors.accent.aqua} />
          <Text style={styles.contactLink}>{SERVICE_URL}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

export default function PrivacyScreen() {
  const t = useTokens();
  const styles = useStyles();
  const bottomPad = useListBottomInset({ base: t.spacing[10] });

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Privacy Policy', headerShown: true }} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {SECTIONS.map((section, index) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">
              {`${index + 1}. ${section.title}`}
            </Text>

            {section.body?.map((paragraph, i) => (
              <Text key={i} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}

            {/* The Data Controller box mirrors the web's bordered contact box. */}
            {index === 0 ? <ContactCard /> : null}

            {section.subsections?.map((sub) => (
              <View key={sub.heading} style={styles.subsection}>
                <Text style={styles.subHeading}>{sub.heading}</Text>
                {sub.paragraphs?.map((paragraph, i) => (
                  <Text key={i} style={styles.paragraph}>
                    {paragraph}
                  </Text>
                ))}
                {sub.bullets?.map((bullet, i) => (
                  <Bullet key={i} text={bullet} />
                ))}
              </View>
            ))}

            {/* Tappable Terms link for the Additional Legal Documents section. */}
            {section.title === 'Additional Legal Documents' ? (
              <TouchableOpacity
                style={styles.linkRow}
                onPress={openTerms}
                activeOpacity={0.7}
                accessibilityRole="link"
                accessibilityLabel="Open Terms of Service"
              >
                <Ionicons name="document-text-outline" size={18} color={t.colors.accent.aqua} />
                <Text style={styles.linkText}>Terms of Service</Text>
                <Ionicons name="open-outline" size={16} color={t.colors.accent.aqua} />
              </TouchableOpacity>
            ) : null}

            {/* Contact box for the final Contact & Support section. */}
            {section.title === 'Contact & Support' ? <ContactCard /> : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  container: {
    flex: 1,
    backgroundColor: t.colors.bg.primary,
  },
  scroll: {
    paddingHorizontal: t.spacing[4],
    gap: t.spacing[5],
  },
  section: {
    gap: t.spacing[3],
  },
  sectionTitle: {
    ...typeStyle('title'),
    color: t.colors.text.primary,
  },
  subsection: {
    gap: t.spacing[2],
    paddingTop: t.spacing[1],
  },
  subHeading: {
    ...typeStyle('label'),
    color: t.colors.text.secondary,
  },
  paragraph: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: t.spacing[3],
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: t.spacing[2],
    backgroundColor: t.colors.accent.aqua,
  },
  bulletText: {
    ...typeStyle('body'),
    color: t.colors.text.secondary,
    flex: 1,
  },
  contactCard: {
    backgroundColor: t.colors.bg.secondary,
    borderRadius: t.radii.default,
    borderWidth: 1,
    borderColor: t.colors.border.default,
    padding: t.spacing[4],
    gap: t.spacing[3],
  },
  contactRow: {
    gap: t.spacing[1],
  },
  contactLabel: {
    ...typeStyle('caption'),
    color: t.colors.text.muted,
  },
  contactValue: {
    ...typeStyle('body'),
    color: t.colors.text.primary,
  },
  contactLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
  },
  contactLink: {
    ...typeStyle('body'),
    color: t.colors.accent.aqua,
    flexShrink: 1,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: t.spacing[2],
    paddingVertical: t.spacing[2],
  },
  linkText: {
    ...typeStyle('body'),
    color: t.colors.accent.aqua,
    flex: 1,
  },
}));
