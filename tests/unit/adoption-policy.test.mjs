import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_ADOPTION_BASELINE_DATE,
  classifyRepositoryOwnership,
  isExternalRepositoryKey,
  isInternalRepositoryKey,
} from '../../tools/adoption/policy.mjs';

describe('external adoption policy', () => {
  it('defines the approved baseline and exact internal owner namespaces', () => {
    expect(EXTERNAL_ADOPTION_BASELINE_DATE).toBe('2026-09-21');

    for (const repository of [
      'marcel-tuinstra/garmin-connect-sdk',
      'MARCEL-TUINSTRA/private-tool',
      'Tuinstra-DEV/wodiq',
      'tuinstra-dev/another-project',
    ]) {
      expect(classifyRepositoryOwnership(repository)).toBe('internal');
      expect(isInternalRepositoryKey(repository)).toBe(true);
      expect(isExternalRepositoryKey(repository)).toBe(false);
    }
  });

  it('keeps similarly named and unrelated owners external', () => {
    for (const repository of [
      'marcel-tuinstra-labs/app',
      'tuinstra-dev-tools/app',
      'cezarsmpio/apple-to-garmin',
    ]) {
      expect(classifyRepositoryOwnership(repository)).toBe('external');
      expect(isExternalRepositoryKey(repository)).toBe(true);
    }
  });

  it.each([
    '',
    'owner',
    '/repo',
    'owner/',
    'owner/repo/extra',
    ' owner/repo',
    'owner/repo ',
    'owner/*',
    null,
    undefined,
  ])('classifies malformed repository identity %j as unknown', (repository) => {
    expect(classifyRepositoryOwnership(repository)).toBe('unknown');
    expect(isInternalRepositoryKey(repository)).toBe(false);
    expect(isExternalRepositoryKey(repository)).toBe(false);
  });
});
