import { escapeHtml } from "./http";

export interface LegendEntry {
  zoneTypeId: string;
  name: string;
  color: string;
  description: string;
  tripNote: string;
}

function layout(env: Env, title: string, bodyHtml: string): string {
  const app = escapeHtml(env.APP_NAME);
  return `<!doctype html><html><body style="margin:0;background:#f4f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2420">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:#14532d;color:#ffffff;padding:16px 24px;font-weight:700;font-size:18px">${app}</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr></table>
<p style="font-size:12px;color:#6b7280;margin:16px 0 0">${app} &middot; driving for dollars made easier</p>
</td></tr></table></body></html>`;
}

async function send(env: Env, to: string, subject: string, html: string, text: string): Promise<void> {
  await env.EMAIL.send({
    from: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || env.APP_NAME },
    to,
    subject,
    html,
    text,
  });
}

export async function sendLoginCode(env: Env, to: string, code: string, origin: string): Promise<void> {
  const link = `${origin}/#/verify?email=${encodeURIComponent(to)}&code=${code}`;
  const html = layout(
    env,
    "Your sign-in code",
    `<p style="margin:0 0 16px">Enter this code to sign in. It expires in 10 minutes.</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:0 0 24px;font-family:Menlo,Consolas,monospace">${code}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Sign in on this device</a></p>
<p style="font-size:13px;color:#6b7280;margin:0">If you didn't ask for this, you can ignore this email.</p>`,
  );
  const text = `Your ${env.APP_NAME} sign-in code is ${code}. It expires in 10 minutes.\n\nOr open: ${link}\n\nIf you didn't ask for this, you can ignore this email.`;
  await send(env, to, `${code} is your ${env.APP_NAME} sign-in code`, html, text);
}

export async function sendWelcome(env: Env, to: string, origin: string): Promise<void> {
  const html = layout(
    env,
    "Welcome! Let's paint some streets.",
    `<p style="margin:0 0 12px">Here's how a drive works:</p>
<ol style="margin:0 0 16px;padding-left:20px;line-height:1.6">
<li>Tap <b>Start drive</b> and allow location.</li>
<li>Tap <b style="color:#16a34a">Green</b>, <b style="color:#ca8a04">Yellow</b> or <b style="color:#dc2626">Red</b>. The street you're on is painted that color as you drive.</li>
<li>Tap a different color whenever the neighborhood changes, or <b>Pause</b> to stop painting.</li>
<li>Tap <b>Finish</b> to name the trip, write notes and fill in the key.</li>
</ol>
<p style="margin:0 0 24px"><a href="${escapeHtml(origin)}" style="background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open ${escapeHtml(env.APP_NAME)}</a></p>
<p style="font-size:13px;color:#6b7280;margin:0">Safety first: let a passenger tap the buttons, or pull over before you do.</p>`,
  );
  const text = `Welcome to ${env.APP_NAME}!\n\n1. Tap Start drive and allow location.\n2. Tap Green, Yellow or Red. The street you're on is painted that color as you drive.\n3. Switch colors when the neighborhood changes, or Pause to stop painting.\n4. Tap Finish to name the trip, write notes and fill in the key.\n\nOpen the app: ${origin}\n\nSafety first: let a passenger tap the buttons, or pull over before you do.`;
  await send(env, to, `Welcome to ${env.APP_NAME}`, html, text);
}

function miles(meters: number): string {
  return (meters / 1609.344).toFixed(1);
}

export async function sendTripSummary(
  env: Env,
  to: string,
  origin: string,
  trip: { id: string; name: string; notes: string; distanceM: number; startedAt: number; endedAt: number },
  legend: LegendEntry[],
  metersByZone: Map<string, number>,
  pinCount: number,
): Promise<void> {
  const minutes = Math.max(1, Math.round((trip.endedAt - trip.startedAt) / 60000));
  const link = `${origin}/#/trips/${trip.id}`;
  const rows = legend
    .map((entry) => {
      const meters = metersByZone.get(entry.zoneTypeId) || 0;
      const tripNote = entry.tripNote
        ? `<br><span style="font-size:14px">This trip: ${escapeHtml(entry.tripNote)}</span>`
        : "";
      return `<tr>
<td style="padding:8px 8px 8px 0;vertical-align:top"><span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${escapeHtml(entry.color)}"></span></td>
<td style="padding:8px 0;vertical-align:top"><b>${escapeHtml(entry.name)}</b> &middot; ${miles(meters)} mi<br><span style="color:#4b5563;font-size:14px">${escapeHtml(entry.description)}</span>${tripNote}</td>
</tr>`;
    })
    .join("");
  const notesHtml = trip.notes
    ? `<h2 style="font-size:16px;margin:20px 0 8px">Notes</h2><p style="margin:0;white-space:pre-wrap">${escapeHtml(trip.notes)}</p>`
    : "";
  const html = layout(
    env,
    trip.name,
    `<p style="margin:0 0 16px;color:#4b5563">${miles(trip.distanceM)} mi painted &middot; ${minutes} min &middot; ${pinCount} note${pinCount === 1 ? "" : "s"} dropped</p>
<h2 style="font-size:16px;margin:0 0 4px">Key</h2>
<table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
${notesHtml}
<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="background:#16a34a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">View the map</a></p>`,
  );
  const textRows = legend
    .map(
      (e) =>
        `- ${e.name} (${miles(metersByZone.get(e.zoneTypeId) || 0)} mi): ${e.description}${e.tripNote ? `\n  This trip: ${e.tripNote}` : ""}`,
    )
    .join("\n");
  const text = `${trip.name}\n${miles(trip.distanceM)} mi painted, ${minutes} min, ${pinCount} note${pinCount === 1 ? "" : "s"}\n\nKey:\n${textRows}\n\n${trip.notes ? `Notes:\n${trip.notes}\n\n` : ""}View the map: ${link}`;
  await send(env, to, `Trip summary: ${trip.name}`, html, text);
}
