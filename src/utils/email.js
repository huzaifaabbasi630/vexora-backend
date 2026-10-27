const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const configuredEmailPort = Number.parseInt(process.env.EMAIL_PORT, 10);
const emailPort = [465, 587].includes(configuredEmailPort) ? configuredEmailPort : 587;

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: emailPort,
  secure: emailPort === 465,
  pool: true,
  maxConnections: 1,
  rateDelta: 20000,
  connectionTimeout: 30000,
  greetingTimeout: 30000,
  socketTimeout: 60000,
  tls: {
    minVersion: 'TLSv1.2',
  },
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function getEmailConfigStatus() {
  const resendConfigured = Boolean(process.env.RESEND_API_KEY);
  return {
    provider: resendConfigured ? 'resend-api' : 'smtp',
    resendApiKeyConfigured: resendConfigured,
    senderConfigured: Boolean(process.env.EMAIL_FROM || process.env.EMAIL_USER),
    hostConfigured: Boolean(process.env.EMAIL_HOST),
    portConfigured: Boolean(process.env.EMAIL_PORT),
    userConfigured: Boolean(process.env.EMAIL_USER),
    passwordConfigured: Boolean(process.env.EMAIL_PASS),
  };
}

/**
 * Send an email with an HTML template.
 * @param {string} to Recipient email address
 * @param {string} subject Email subject
 * @param {string} templateName Name of the template file (without .html)
 * @param {object} variables Key/value pairs to replace in the template
 */
async function sendEmail(to, subject, templateName, variables = {}) {
  let html = variables.html;
  if (typeof html !== 'string') {
    if (!templateName) {
      throw new Error('Email requires a template name or HTML content.');
    }

    const templatePath = path.resolve(__dirname, '..', 'templates', `${templateName}.html`);
    html = fs.readFileSync(templatePath, 'utf8');
    const missingVariables = new Set(
      Array.from(html.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g), (match) => match[1])
        .filter((key) => !Object.prototype.hasOwnProperty.call(variables, key))
    );
    if (missingVariables.size > 0) {
      throw new Error(`Email template "${templateName}" is missing values for: ${[...missingVariables].join(', ')}.`);
    }

    Object.entries(variables).forEach(([key, value]) => {
      if (key === 'html') return;
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      // Keys ending with 'Html' are injected as raw HTML (not escaped)
      const safe = key.endsWith('Html') ? String(value) : escapeHtml(value);
      html = html.replace(placeholder, () => safe);
    });
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  if (!from) {
    throw new Error('Email sender is not configured. Set EMAIL_FROM.');
  }

  if (process.env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(result.message || `Resend email request failed with status ${response.status}.`);
      error.code = result.name || 'RESEND_API_ERROR';
      error.responseCode = response.status;
      throw error;
    }

    return { accepted: [to], rejected: [], messageId: result.id };
  }

  return transporter.sendMail({ from, to, subject, html });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

module.exports = { sendEmail, transporter, getEmailConfigStatus };
