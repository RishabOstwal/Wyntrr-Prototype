import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addParticipantMemory,
  createParticipantTag,
  normalizeParticipantTag,
  resolveParticipantIdentity,
} from '../server/participant-memory.js';
import { createConversation } from '../server/tavus.js';

test('participant tag is stable for the same normalized email', () => {
  const first = createParticipantTag({
    loginPayload: {},
    email: '  Person@Example.com ',
    secret: 'test-memory-secret',
  });
  const second = createParticipantTag({
    loginPayload: {},
    email: 'person@example.com',
    secret: 'test-memory-secret',
  });

  assert.equal(first, second);
  assert.match(first, /^wyn_[A-Za-z0-9_-]{43}$/);
});

test('an authenticated user ID is preferred over the email fallback', () => {
  const loginPayload = { user: { id: 'user-123' } };

  assert.equal(resolveParticipantIdentity(loginPayload, 'person@example.com'), 'user-123');
  assert.equal(
    createParticipantTag({
      loginPayload,
      email: 'person@example.com',
      secret: 'test-memory-secret',
    }),
    createParticipantTag({
      loginPayload,
      email: 'other@example.com',
      secret: 'test-memory-secret',
    }),
  );
});

test('different identities and secrets produce different participant tags', () => {
  const first = createParticipantTag({
    loginPayload: { userId: 'user-1' },
    email: 'ignored@example.com',
    secret: 'test-memory-secret',
  });
  const otherIdentity = createParticipantTag({
    loginPayload: { userId: 'user-2' },
    email: 'ignored@example.com',
    secret: 'test-memory-secret',
  });
  const otherSecret = createParticipantTag({
    loginPayload: { userId: 'user-1' },
    email: 'ignored@example.com',
    secret: 'different-memory-secret',
  });

  assert.notEqual(first, otherIdentity);
  assert.notEqual(first, otherSecret);
});

test('participant memory is omitted without a tag and added as one Tavus tag', () => {
  const body = { pal_id: 'p123', audio_only: false };
  const tag = createParticipantTag({
    loginPayload: { userId: 'user-123' },
    email: 'person@example.com',
    secret: 'test-memory-secret',
  });

  assert.deepEqual(addParticipantMemory(body, undefined), body);
  assert.deepEqual(addParticipantMemory(body, tag), {
    pal_id: 'p123',
    audio_only: false,
    participant_tags: [tag],
  });
});

test('invalid participant tags are rejected', () => {
  assert.equal(normalizeParticipantTag('plain-email@example.com'), '');
  assert.throws(
    () => addParticipantMemory({ pal_id: 'p123' }, 'plain-email@example.com'),
    /Invalid participant tag/,
  );
});

test('tag creation is disabled safely when identity or secret is unavailable', () => {
  assert.equal(createParticipantTag({
    loginPayload: {},
    email: '',
    secret: 'test-memory-secret',
  }), '');
  assert.equal(createParticipantTag({
    loginPayload: { userId: 'user-123' },
    email: 'person@example.com',
    secret: '',
  }), '');
});

test('Tavus conversation creation forwards one participant tag', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.TAVUS_API_KEY;
  const originalPalId = process.env.TAVUS_PAL_ID;
  let upstreamBody;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.TAVUS_API_KEY;
    else process.env.TAVUS_API_KEY = originalApiKey;
    if (originalPalId === undefined) delete process.env.TAVUS_PAL_ID;
    else process.env.TAVUS_PAL_ID = originalPalId;
  });

  process.env.TAVUS_API_KEY = 'test-api-key';
  process.env.TAVUS_PAL_ID = 'p123';
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://tavusapi.com/v2/conversations');
    upstreamBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ conversation_id: 'c123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const participantTag = createParticipantTag({
    loginPayload: { userId: 'user-123' },
    email: 'person@example.com',
    secret: 'test-memory-secret',
  });
  const response = {
    statusCode: 200,
    payload: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  await createConversation({
    body: {
      partner: 'wyntrr',
      participant_tag: participantTag,
    },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(upstreamBody.participant_tags, [participantTag]);
});
