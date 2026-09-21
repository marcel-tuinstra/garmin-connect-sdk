export const EXTERNAL_ADOPTION_BASELINE_DATE = '2026-09-21';

const SAFE_REPOSITORY_PART = /^[A-Za-z0-9_.-]{1,100}$/;
const INTERNAL_OWNER_KEYS = new Set(['marcel-tuinstra', 'tuinstra-dev']);

export function classifyRepositoryOwnership(repositoryKey) {
  if (typeof repositoryKey !== 'string') return 'unknown';
  const [owner, repository, extra] = repositoryKey.split('/');
  if (
    extra !== undefined ||
    !SAFE_REPOSITORY_PART.test(owner ?? '') ||
    !SAFE_REPOSITORY_PART.test(repository ?? '')
  ) {
    return 'unknown';
  }

  return INTERNAL_OWNER_KEYS.has(owner.toLowerCase()) ? 'internal' : 'external';
}

export function isInternalRepositoryKey(repositoryKey) {
  return classifyRepositoryOwnership(repositoryKey) === 'internal';
}

export function isExternalRepositoryKey(repositoryKey) {
  return classifyRepositoryOwnership(repositoryKey) === 'external';
}
