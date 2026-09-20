export function renderAdoptionReport(snapshot) {
  const npmDaily = snapshot.measurements.filter(
    ({ source, metric }) => source === 'npm' && metric === 'package_downloads',
  );
  const npmVersions = snapshot.measurements.filter(
    ({ source, metric }) => source === 'npm' && metric === 'version_downloads_last_week',
  );
  const traffic = snapshot.measurements.filter(({ source }) => source === 'github');
  const voluntary = snapshot.measurements.filter(
    ({ source }) => source === 'private_opt_in_self_report',
  );
  const adopters = snapshot.adopters ?? [];
  const latestRetrieval = [...(snapshot.retrievals ?? [])]
    .sort((left, right) => left.retrievedAt.localeCompare(right.retrievedAt))
    .at(-1);

  return `# SDK adoption evidence

Generated from the ${inline(snapshot.metricDate)} snapshot at ${inline(latestRetrieval?.retrievedAt ?? 'not yet collected')}.

These signals are deliberately separate. npm downloads are package retrievals, GitHub traffic describes this repository, public repository evidence is static evidence found in indexed public code, and voluntary private/unindexed registrations are unverified self-reports. Active installations: not measured. None of these signals identifies an individual SDK user or proves commercial use.

## Collection status

${statusTable(latestRetrieval?.sourceStatuses ?? [])}

## npm downloads

Daily package downloads:

${table(
  ['Date', 'Downloads', 'Status'],
  npmDaily.map((item) => [item.metricDate, displayValue(item), item.status]),
)}

Rolling version-level downloads, where npm exposes them:

${table(
  ['Retrieved', 'Version', 'Downloads', 'Status'],
  npmVersions.map((item) => [
    item.metricDate,
    item.dimension ?? '—',
    displayValue(item),
    item.status,
  ]),
)}

## GitHub repository traffic

Traffic is available only for GitHub's rolling window. Missing observations stay missing; they are never converted to zero.

${table(
  ['Metric', 'Date', 'Value', 'Status'],
  traffic.map((item) => [item.metric, item.metricDate, displayValue(item), item.status]),
)}

## Voluntary private/unindexed registrations

These are pseudonymous, time-limited and unverified self-reports. They are not repository discoveries, identifiable people, active installations, usage-frequency measurements, or license evidence. Counts are suppressed below five and released only in rounded groups of five by the intake service.

${table(
  ['Metric', 'Dimension', 'Date', 'Value', 'Status'],
  voluntary.map((item) => [
    item.metric,
    item.dimension ?? '—',
    item.metricDate,
    displayValue(item),
    item.status,
  ]),
)}

## Public repository evidence

This index contains public repository identifiers and evidence URLs only. Archived and forked repositories remain visible but are excluded from the adopter count. Static active-use evidence is not runtime proof.

${table(
  ['Repository', 'State', 'Declared', 'Resolved', 'Evidence', 'Confidence', 'Counted'],
  adopters.map((item) => [
    item.repositoryKey,
    item.repositoryState,
    item.declaredVersionRange ?? '—',
    item.resolvedVersion ?? '—',
    item.evidenceTypes.join(', '),
    item.confidence,
    item.countsAsAdopter ? 'yes' : 'no',
  ]),
)}

## Limitations

- npm downloads can include caches, CI and repeat downloads.
- GitHub traffic is repository-level and its rolling history cannot be backfilled after the source window expires.
- GitHub public code search can be delayed, incomplete, rate-limited or truncated and does not include private or unindexed repositories.
- Voluntary registrations may be stale, duplicated across projects or omitted entirely; they are unverified and expire unless deliberately renewed.
- A dependency, lockfile, import or static callsite is evidence with a stated confidence level, not proof of a running installation or license violation.
`;
}

function statusTable(statuses) {
  return table(
    ['Source', 'Status', 'HTTP', 'Reason'],
    statuses.map((status) => [
      status.source,
      status.status,
      status.httpStatus ?? '—',
      status.reasonCode ?? '—',
    ]),
  );
}

function table(headers, rows) {
  const safeHeaders = headers.map(cell);
  const body = rows.length > 0 ? rows : [headers.map(() => '—')];
  return [
    `| ${safeHeaders.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

function displayValue(measurement) {
  return measurement.status === 'observed' ? String(measurement.value) : '—';
}

function cell(value) {
  const raw = stripControlCharacters(String(value ?? '—'));
  const formulaSafe = /^[=+@-]/.test(raw) && raw !== '—' ? `'${raw}` : raw;
  return formulaSafe
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/([\\`*_[\]{}()#+.!])/g, '\\$1')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ')
    .slice(0, 500);
}

function stripControlCharacters(value) {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint < 32 || codePoint === 127 ? ' ' : character;
    })
    .join('');
}

function inline(value) {
  return `\`${String(value).replaceAll('`', '')}\``;
}
