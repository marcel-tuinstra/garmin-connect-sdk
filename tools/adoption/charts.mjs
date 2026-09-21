import { buildAdoptionReportModel } from './report.mjs';

const WIDTH = 960;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function renderAdoptionCharts(snapshot) {
  const model = buildAdoptionReportModel(snapshot);
  return {
    'npm-downloads.svg': renderNpmDownloads(model),
    'github-traffic.svg': renderGitHubTraffic(model),
    'version-downloads.svg': renderVersionDownloads(model),
  };
}

function renderNpmDownloads(model) {
  const rows = model.npmDaily;
  const observed = rows.filter(({ status }) => status === 'observed');
  const latest = observed.at(-1);
  const max = Math.max(1, ...observed.map(({ value }) => value));
  const plot = { x: 76, y: 72, width: 824, height: 174 };
  const step = plot.width / rows.length;
  const barWidth = Math.min(40, step * 0.64);
  const grid = gridLines(plot, max, 4);
  const bars = rows
    .map((row, index) => {
      const x = plot.x + index * step + (step - barWidth) / 2;
      if (row.status !== 'observed') {
        return `<path class="missing-mark" d="M ${number(x + barWidth / 2 - 4)} ${plot.y + plot.height - 4} l 8 8 m -8 0 l 8 -8"><title>${xml(row.metricDate)}: missing</title></path>`;
      }
      const height = row.value === 0 ? 1 : (row.value / max) * plot.height;
      const y = plot.y + plot.height - height;
      const current = row === latest;
      return `<rect class="${current ? 'current-bar' : 'bar'}" x="${number(x)}" y="${number(y)}" width="${number(barWidth)}" height="${number(height)}" rx="3"><title>${xml(row.metricDate)}: ${formatNumber(row.value)} downloads${current ? ' (latest)' : ''}</title></rect>`;
    })
    .join('');
  const dateLabels = rows
    .map((row, index) => {
      if (index % 2 !== 0 && index !== rows.length - 1) return '';
      const x = plot.x + index * step + step / 2;
      return `<text class="label muted" x="${number(x)}" y="272" text-anchor="middle">${xml(shortDate(row.metricDate))}</text>`;
    })
    .join('');
  const latestLabel = latest
    ? (() => {
        const index = rows.indexOf(latest);
        const x = plot.x + index * step + step / 2;
        const height = latest.value === 0 ? 1 : (latest.value / max) * plot.height;
        const y = Math.max(67, plot.y + plot.height - height - 9);
        return `<text class="value ink" x="${number(x)}" y="${number(y)}" text-anchor="middle">${formatNumber(latest.value)}</text><text class="current-label" x="${number(x)}" y="296" text-anchor="middle">Latest</text>`;
      })()
    : '';
  const empty =
    observed.length === 0
      ? '<text class="empty ink" x="480" y="166" text-anchor="middle">No observed npm download data</text>'
      : '';
  const description =
    observed.length === 0
      ? 'No observed npm download data is available for the 14-day period. Missing days are gaps.'
      : `The 14-day period contains ${observed.length} observed days and ${rows.length - observed.length} missing days. Latest observed day is ${latest.metricDate} with ${formatNumber(latest.value)} downloads. Missing days are gaps.`;

  return svg({
    height: 320,
    title: 'Daily npm downloads',
    description,
    extraStyles:
      '.bar{fill:#2563EB}.current-bar{fill:#FFD83D;stroke:#171717;stroke-width:1.5}.current-label{fill:#171717;font:700 12px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.missing-mark{fill:none;stroke:#85857D;stroke-width:1.5}@media(prefers-color-scheme:dark){.bar{fill:#58A6FF}.current-bar{fill:#FFD83D;stroke:#F3F3F3}.current-label{fill:#F3F3F3}.missing-mark{stroke:#858585}}',
    body: `<text class="heading ink" x="28" y="34">Daily npm downloads</text>
<text class="label muted" x="28" y="54">14 days · ${observed.length}/${rows.length} observed · Missing days are gaps</text>
${grid}${bars}${empty}${latestLabel}${dateLabels}`,
  });
}

function renderGitHubTraffic(model) {
  const rows = model.githubDaily;
  const clones = rows.map((row) => (row.clones.status === 'observed' ? row.clones.value : null));
  const views = rows.map((row) => (row.views.status === 'observed' ? row.views.value : null));
  const cloneCount = clones.filter(Number.isFinite).length;
  const viewCount = views.filter(Number.isFinite).length;
  const max = Math.max(1, ...clones.filter(Number.isFinite), ...views.filter(Number.isFinite));
  const plot = { x: 76, y: 72, width: 704, height: 174 };
  const coordinates = (values) =>
    values.map((value, index) => ({
      value,
      x: plot.x + (index * plot.width) / Math.max(1, rows.length - 1),
      y: Number.isFinite(value) ? plot.y + plot.height - (value / max) * plot.height : null,
    }));
  const clonePoints = coordinates(clones);
  const viewPoints = coordinates(views);
  const cloneSegments = lineSegments(clonePoints, 'clones-line');
  const viewSegments = lineSegments(viewPoints, 'views-line');
  const cloneMarkers = clonePoints
    .filter(({ value }) => Number.isFinite(value))
    .map(
      ({ x, y, value }) =>
        `<circle class="clone-marker" cx="${number(x)}" cy="${number(y)}" r="4"><title>${xml(rows[clonePoints.findIndex((point) => point.x === x)].metricDate)}: ${formatNumber(value)} clones</title></circle>`,
    )
    .join('');
  const viewMarkers = viewPoints
    .filter(({ value }) => Number.isFinite(value))
    .map(({ x, y, value }) => {
      const rowIndex = viewPoints.findIndex((point) => point.x === x);
      return `<rect class="view-marker" x="${number(x - 4)}" y="${number(y - 4)}" width="8" height="8"><title>${xml(rows[rowIndex].metricDate)}: ${formatNumber(value)} views</title></rect>`;
    })
    .join('');
  const labels = trafficEndpointLabels([
    { points: clonePoints, noun: 'clones' },
    { points: viewPoints, noun: 'views' },
  ]);
  const dateLabels = rows
    .map((row, index) => {
      if (index % 2 !== 0 && index !== rows.length - 1) return '';
      const x = plot.x + (index * plot.width) / Math.max(1, rows.length - 1);
      return `<text class="label muted" x="${number(x)}" y="272" text-anchor="middle">${xml(shortDate(row.metricDate))}</text>`;
    })
    .join('');
  const empty =
    cloneCount + viewCount === 0
      ? '<text class="empty ink" x="480" y="166" text-anchor="middle">No observed GitHub traffic data</text>'
      : '';
  const notes = [
    cloneCount === 0
      ? 'No observed clone data'
      : `${cloneCount} observed clone ${cloneCount === 1 ? 'point' : 'points'}`,
    viewCount === 0
      ? 'No observed view data'
      : `${viewCount} observed view ${viewCount === 1 ? 'point' : 'points'}`,
  ].join(' · ');

  return svg({
    height: 320,
    title: 'Daily GitHub activity',
    description: `${notes}. Missing days break the lines and are not converted to zero.`,
    extraStyles:
      '.clones-line{fill:none;stroke:#2563EB;stroke-width:3}.views-line{fill:none;stroke:#61615C;stroke-width:3;stroke-dasharray:7 5}.clone-marker{fill:#2563EB}.view-marker{fill:#FAFAF8;stroke:#61615C;stroke-width:2}.endpoint-leader{fill:none;stroke:#85857D;stroke-width:1}.series-label{font:700 12px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}@media(prefers-color-scheme:dark){.clones-line{stroke:#58A6FF}.views-line{stroke:#AEAEAE}.clone-marker{fill:#58A6FF}.view-marker{fill:#1A1A1A;stroke:#AEAEAE}.endpoint-leader{stroke:#858585}}',
    body: `<text class="heading ink" x="28" y="34">Daily GitHub activity</text>
<text class="label muted" x="28" y="54">${xml(notes)} · Missing days break each line</text>
<line class="clones-line" x1="666" y1="31" x2="694" y2="31"/><circle class="clone-marker" cx="680" cy="31" r="4"/><text class="series-label ink" x="704" y="35">Clones</text>
<line class="views-line" x1="790" y1="31" x2="818" y2="31"/><rect class="view-marker" x="800" y="27" width="8" height="8"/><text class="series-label ink" x="828" y="35">Views</text>
${gridLines(plot, max, 4)}${cloneSegments}${viewSegments}${cloneMarkers}${viewMarkers}${labels}${empty}${dateLabels}`,
  });
}

function renderVersionDownloads(model) {
  const observed = model.versionSnapshot
    .filter(
      ({ status, value, dimension }) =>
        status === 'observed' && Number.isFinite(value) && dimension,
    )
    .sort(
      (left, right) =>
        right.value - left.value || String(left.dimension).localeCompare(String(right.dimension)),
    );
  const highestStableVersion = newestStableVersion(observed.map(({ dimension }) => dimension));
  const visible = observed.slice(0, 5).map((item) => ({
    label: item.dimension,
    value: item.value,
    current: item.dimension === highestStableVersion,
  }));
  const overflow = observed.slice(5);
  if (overflow.length > 0) {
    visible.push({
      label: 'Other versions',
      value: overflow.reduce((total, { value }) => total + value, 0),
      current: false,
    });
  }
  const max = Math.max(1, ...visible.map(({ value }) => value));
  const rowHeight = 42;
  const height = Math.max(300, 112 + Math.max(1, visible.length) * rowHeight);
  const trackX = 230;
  const trackWidth = 570;
  const rows = visible
    .map((item, index) => {
      const y = 78 + index * rowHeight;
      const width = item.value === 0 ? 1 : (item.value / max) * trackWidth;
      const label = boundedLabel(item.label, 24);
      const current = item.current;
      return `<text class="version-label ink" x="36" y="${y + 17}">${xml(label)}</text><rect class="track" x="${trackX}" y="${y}" width="${trackWidth}" height="24" rx="5"/><rect class="${current ? 'current-bar' : 'bar'}" x="${trackX}" y="${y}" width="${number(width)}" height="24" rx="5"><title>${xml(item.label)}: ${formatNumber(item.value)} downloads${current ? ' (highest stable version observed)' : ''}</title></rect><text class="value ink" x="${number(Math.min(892, trackX + width + 14))}" y="${y + 17}">${formatNumber(item.value)}</text>`;
    })
    .join('');
  const empty =
    visible.length === 0
      ? '<text class="empty ink" x="480" y="166" text-anchor="middle">No observed version download data</text>'
      : '';
  const overflowNote =
    overflow.length > 0
      ? 'Top 5 versions by downloads plus Other versions'
      : 'All observed versions';
  const currentBadge = highestStableVersion
    ? `<rect class="current-badge" x="674" y="18" width="258" height="28" rx="5"/><text class="current-badge-label" x="803" y="36" text-anchor="middle">Highest stable version observed · ${xml(boundedLabel(highestStableVersion, 14))}</text>`
    : '';

  return svg({
    height,
    title: 'Downloads by released version',
    description:
      visible.length === 0
        ? `No observed version download data is available for the snapshot on ${model.versionDate ?? 'an unavailable date'}.`
        : `${overflowNote} from the snapshot on ${model.versionDate}. Exact per-version values remain in the Markdown table. ${highestStableVersion ? `Highest stable version observed is ${boundedLabel(highestStableVersion, 42)}.` : 'No stable version was observed.'}`,
    extraStyles:
      '.track{fill:#DDDDD7}.bar{fill:#2563EB}.current-bar,.current-badge{fill:#FFD83D;stroke:#171717;stroke-width:1.5}.current-badge-label{fill:#171717;font:700 11px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.version-label{font:600 13px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}@media(prefers-color-scheme:dark){.track{fill:#3A3A3A}.bar{fill:#58A6FF}.current-bar,.current-badge{fill:#FFD83D;stroke:#F3F3F3}}',
    body: `<text class="heading ink" x="28" y="34">Downloads by released version</text>
<text class="label muted" x="28" y="54">${xml(overflowNote)} · snapshot ${xml(model.versionDate ?? 'not available')}</text>
${currentBadge}${rows}${empty}<text class="label muted" x="230" y="${height - 20}">Bars start at zero · exact values remain in the table below</text>`,
  });
}

function svg({ height, title, description, extraStyles, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="chart-title chart-desc">
  <title id="chart-title">${xml(title)}</title>
  <desc id="chart-desc">${xml(description)}</desc>
  <style>
    .surface{fill:#FAFAF8}.grid{stroke:#DDDDD7;stroke-width:1}.axis{stroke:#85857D;stroke-width:1.2}.ink{fill:#171717}.muted{fill:#61615C}.heading{font:700 18px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.label{font:12px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.value{font:700 12px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.empty{font:600 15px ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}${extraStyles}
    @media(prefers-color-scheme:dark){.surface{fill:#1A1A1A}.grid{stroke:#3A3A3A}.axis{stroke:#858585}.ink{fill:#F3F3F3}.muted{fill:#AEAEAE}}
  </style>
  <rect class="surface" x="0" y="0" width="${WIDTH}" height="${height}" rx="10"/>
  ${body}
</svg>
`;
}

function gridLines(plot, max, divisions) {
  const lines = [];
  const effectiveDivisions = Math.min(divisions, Math.max(1, Math.floor(max)));
  for (let index = 0; index <= effectiveDivisions; index += 1) {
    const ratio = index / effectiveDivisions;
    const y = plot.y + ratio * plot.height;
    const value = Math.round(max * (1 - ratio));
    lines.push(
      `<line class="${index === effectiveDivisions ? 'axis' : 'grid'}" x1="${plot.x}" y1="${number(y)}" x2="${plot.x + plot.width}" y2="${number(y)}"/><text class="label muted" x="${plot.x - 12}" y="${number(y + 4)}" text-anchor="end">${formatNumber(value)}</text>`,
    );
  }
  return lines.join('');
}

function lineSegments(points, className) {
  const segments = [];
  let current = [];
  const flush = () => {
    if (current.length >= 2) {
      segments.push(
        `<polyline class="${className}" points="${current.map(({ x, y }) => `${number(x)},${number(y)}`).join(' ')}"/>`,
      );
    }
    current = [];
  };
  for (const point of points) {
    if (Number.isFinite(point.value)) current.push(point);
    else flush();
  }
  flush();
  return segments.join('');
}

function trafficEndpointLabels(series) {
  return series
    .map(({ points, noun }) => ({
      noun,
      point: points.filter(({ value }) => Number.isFinite(value)).at(-1),
    }))
    .filter(({ point }) => point)
    .sort((left, right) => left.point.y - right.point.y || left.noun.localeCompare(right.noun))
    .map(({ point, noun }, index) => endpointLabel(point, noun, 103 + index * 26))
    .join('');
}

function endpointLabel(point, noun, labelY) {
  const leaderEndX = 800;
  return `<path class="endpoint-leader" d="M ${number(point.x + 6)} ${number(point.y)} L ${leaderEndX - 8} ${labelY - 4}"/><text class="series-label ink" data-endpoint="${noun}" x="${leaderEndX}" y="${labelY}">${formatNumber(point.value)} ${noun}</text>`;
}

function newestStableVersion(versions) {
  return versions
    .map((version) => ({ version, parsed: parseStableVersion(version) }))
    .filter(({ parsed }) => parsed)
    .sort((left, right) => compareVersion(left.parsed, right.parsed))
    .at(-1)?.version;
}

function parseStableVersion(value) {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)$/.exec(String(value));
  return match ? match.slice(1).map(Number) : null;
}

function compareVersion(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function boundedLabel(value, maximum) {
  const clean = stripControls(String(value));
  return clean.length <= maximum ? clean : `${clean.slice(0, maximum - 1)}…`;
}

function stripControls(value) {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('');
}

function xml(value) {
  return boundedLabel(value, 500)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function shortDate(value) {
  const [, month, day] = value.split('-').map(Number);
  return `${day} ${MONTHS[month - 1] ?? ''}`.trim();
}

function formatNumber(value) {
  return Number(value).toLocaleString('en-US');
}

function number(value) {
  return Number(value.toFixed(2));
}
