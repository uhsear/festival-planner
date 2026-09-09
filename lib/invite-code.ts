import crypto from 'crypto';

// Invite code generation. This lives in lib/, not in routes/crew-invites.ts,
// because routes/crews.ts needs it too: a helper shared by two route modules is
// exactly the "extract shared logic to lib/" case the no-routes-importing-routes
// rule in .dependency-cruiser.cjs exists to catch. It went unnoticed for as long
// as that gate was resolving nothing.

const INVITE_CODE_LENGTH = 6;
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1

export function generateInviteCode() {
  // Use rejection sampling to avoid modulo bias (charset length 31 doesn't divide 256 evenly)
  const limit = 256 - (256 % INVITE_CODE_CHARS.length); // largest multiple of 31 <= 256
  let code = '';
  while (code.length < INVITE_CODE_LENGTH) {
    const bytes = crypto.randomBytes(INVITE_CODE_LENGTH * 2); // over-request to reduce loops
    for (let i = 0; i < bytes.length && code.length < INVITE_CODE_LENGTH; i++) {
      if (bytes[i]! < limit) code += INVITE_CODE_CHARS[bytes[i]! % INVITE_CODE_CHARS.length];
    }
  }
  return code;
}

export async function generateUniqueInviteCode(stores: any) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInviteCode();
    if (!(await stores.crews.getByInviteCode(code))) return code;
  }
  throw new Error('Failed to generate unique invite code');
}
