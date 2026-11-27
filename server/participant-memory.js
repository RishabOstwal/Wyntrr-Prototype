import { createHmac } from 'node:crypto';

const PARTICIPANT_TAG_PATTERN = /^wyn_[A-Za-z0-9_-]{43}$/;

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

export function resolveParticipantIdentity(loginPayload, email) {
  const user = loginPayload?.user && typeof loginPayload.user === 'object'
    ? loginPayload.user
    : {};

  return firstNonEmptyString(
    loginPayload?.participantId,
    loginPayload?.participant_id,
    loginPayload?.userId,
    loginPayload?.user_id,
    loginPayload?.accountId,
    loginPayload?.account_id,
    loginPayload?.memberId,
    loginPayload?.member_id,
    loginPayload?.sub,
    user.participantId,
    user.participant_id,
    user.userId,
    user.user_id,
    user.accountId,
    user.account_id,
    user.memberId,
    user.member_id,
    user.id,
  ) || (typeof email === 'string' ? email.trim().toLowerCase() : '');
}

export function getParticipantMemorySecret(environment = process.env) {
  return firstNonEmptyString(
    environment.TAVUS_MEMORY_TAG_SECRET,
    environment.TAVUS_API_KEY,
  );
}

export function createParticipantTag({ loginPayload, email, secret = '' }) {
  const existingTag = normalizeParticipantTag(
    loginPayload?.participantTag ?? loginPayload?.participant_tag,
  );
  if (existingTag) return existingTag;

  const identity = resolveParticipantIdentity(loginPayload, email);
  const memorySecret = typeof secret === 'string' ? secret.trim() : '';
  if (!identity || !memorySecret) return '';

  const digest = createHmac('sha256', memorySecret)
    .update(`wyntrr-participant:v1:${identity}`)
    .digest('base64url');

  return `wyn_${digest}`;
}

export function normalizeParticipantTag(value) {
  if (typeof value !== 'string') return '';
  const tag = value.trim();
  return PARTICIPANT_TAG_PATTERN.test(tag) ? tag : '';
}

export function addParticipantMemory(body, participantTag) {
  if (participantTag === undefined || participantTag === null || participantTag === '') {
    return body;
  }

  const normalizedTag = normalizeParticipantTag(participantTag);
  if (!normalizedTag) {
    throw new TypeError('Invalid participant tag.');
  }

  return {
    ...body,
    participant_tags: [normalizedTag],
  };
}
