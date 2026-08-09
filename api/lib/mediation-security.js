import crypto from 'crypto';

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hashToken(token) {
  if (!token) throw new Error('Token is required');
  return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');
}

function timingSafeHashEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function addHours(date, hours) {
  return new Date(date.getTime() + (hours * 60 * 60 * 1000));
}

export { randomToken, hashToken, timingSafeHashEqual, addHours };
