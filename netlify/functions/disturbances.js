// netlify/functions/disturbances.js
//
// HTTP endpoint for the front-end.
//   GET /.netlify/functions/disturbances            -> { dates: [...] } (available days)
//   GET /.netlify/functions/disturbances?date=YYYY-MM-DD -> [ ...records ]

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const store = getStore({ name: 'disturbances', consistency: 'strong' });
  const date = event.queryStringParameters && event.queryStringParameters.date;

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  try {
    if (!date) {
      // List available dates (blob keys), newest first.
      const { blobs } = await store.list();
      const dates = blobs
        .map((b) => b.key)
        .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
        .sort()
        .reverse();
      return { statusCode: 200, headers, body: JSON.stringify({ dates }) };
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid date format, expected YYYY-MM-DD' }) };
    }

    const records = await store.get(date, { type: 'json' });
    return { statusCode: 200, headers, body: JSON.stringify(records || []) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};