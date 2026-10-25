// Envoi d'e-mails via Resend (API REST, sans dépendance). Sans clé : le lien est écrit dans les logs (dev).
export async function sendMail({ to, subject, html, text }, env = process.env) {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail:dev] à=${to} sujet="${subject}"\n${text || html}`);
    return { dev: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || 'Tendra <no-reply@example.com>', to: [to], subject, html, text }),
  });
  if (!r.ok) throw new Error(`mail_failed_${r.status}`);
  return r.json();
}
