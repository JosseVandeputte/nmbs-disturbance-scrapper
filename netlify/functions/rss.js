// netlify/functions/rss.js
//
// RSS 2.0 feed of today's disturbances, newest first.
//   GET /.netlify/functions/rss
//
// Lets people follow disturbances passively (feed reader, automation) instead
// of checking the page.

import { getStore } from '@netlify/blobs';

function escXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default async (req) => {
  const store = getStore({ name: 'disturbances', consistency: 'strong' });
  const today = new Date().toISOString().slice(0, 10);
  const site = new URL(req.url).origin;

  let records = [];
  try {
    const data = await store.get(today, { type: 'json' });
    if (Array.isArray(data)) records = data;
  } catch (err) {
    console.error('rss: could not read blob ' + today + ':', err.message);
  }

  const items = records
    .slice()
    .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)))
    .map((r) =>
      '    <item>\n' +
      '      <title>' + escXml(r.title) + (r.active ? '' : ' [opgelost]') + '</title>\n' +
      '      <description>' + escXml(r.description) + '</description>\n' +
      '      <link>' + escXml(site + '/?date=' + today) + '</link>\n' +
      '      <guid isPermaLink="false">' + escXml(r.id + '-' + today) + '</guid>\n' +
      '      <pubDate>' + new Date(r.firstSeen).toUTCString() + '</pubDate>\n' +
      '    </item>'
    )
    .join('\n');

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0">\n' +
    '  <channel>\n' +
    '    <title>NMBS Storingenlog — vandaag</title>\n' +
    '    <link>' + escXml(site + '/') + '</link>\n' +
    '    <description>Onverwachte storingen op het NMBS-net (bron: api.irail.be).</description>\n' +
    '    <language>nl-be</language>\n' +
    '    <lastBuildDate>' + new Date().toUTCString() + '</lastBuildDate>\n' +
    items + '\n' +
    '  </channel>\n' +
    '</rss>\n';

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
};
