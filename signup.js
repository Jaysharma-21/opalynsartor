const { cmd, configured } = require('../lib/redis');

const s = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);

async function notify(rec, count) {
  const text =
    'New OS waitlist signup (' + count + ')\n' +
    'Name: ' + rec.name + '\nEmail: ' + rec.email + '\nPhone: ' + rec.phone + '\n' +
    'Location: ' + [rec.city, rec.state, rec.country].join(', ') + '\nSize: ' + rec.size +
    (rec.notes ? '\nNotes: ' + rec.notes : '');
  const jobs = [];

  // Optional email to you (free key from resend.com). Set RESEND_API_KEY + OWNER_EMAIL.
  if (process.env.RESEND_API_KEY && process.env.OWNER_EMAIL) {
    jobs.push(fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'OS Waitlist <onboarding@resend.dev>',
        to: [process.env.OWNER_EMAIL],
        subject: 'New waitlist signup: ' + rec.name + ' (' + count + ')',
        text,
      }),
    }));
  }
  // Optional WhatsApp alert to YOUR number via CallMeBot. Set WA_PHONE + WA_APIKEY.
  if (process.env.WA_PHONE && process.env.WA_APIKEY) {
    jobs.push(fetch(
      'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(process.env.WA_PHONE) +
      '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(process.env.WA_APIKEY)
    ));
  }
  await Promise.allSettled(jobs);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  let d = req.body;
  try { if (typeof d === 'string') d = JSON.parse(d || '{}'); } catch (e) { d = {}; }
  d = d || {};
  if (d.hp) return res.status(200).json({ ok: true, status: 'ignored' }); // bot trap

  const rec = {
    name: s(d.name), email: s(d.email).toLowerCase(), phone: s(d.phone, 30),
    country: s(d.country), state: s(d.state), city: s(d.city),
    size: s(d.size, 5), notes: s(d.notes, 500), at: Date.now(),
  };
  if (!rec.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email) || rec.phone.replace(/\D/g, '').length < 7 ||
      !rec.country || !rec.state || !rec.city || !['XS', 'S', 'M'].includes(rec.size)) { // everything except notes is required
    return res.status(400).json({ ok: false, error: 'invalid' });
  }
  if (!configured()) return res.status(500).json({ ok: false, error: 'storage_not_configured' });

  try {
    const isNew = await cmd('SADD', 'waitlist:emails', rec.email);
    if (isNew === 1) {
      await cmd('RPUSH', 'waitlist:list', JSON.stringify(rec));
      const count = await cmd('LLEN', 'waitlist:list');
      await notify(rec, count);
    }
    return res.status(200).json({ ok: true, status: isNew === 1 ? 'saved' : 'duplicate' });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'save_failed' });
  }
};
