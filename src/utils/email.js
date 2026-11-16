const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const configuredEmailPort = Number.parseInt(process.env.EMAIL_PORT, 10);
const emailPort = [465, 587].includes(configuredEmailPort) ? configuredEmailPort : 587;
const getEmailProvider = () => 'smtp';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp-relay.brevo.com',
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
  const provider = getEmailProvider();
  return {
    provider,
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
    const error = new Error('SMTP sender is not configured. Set EMAIL_FROM or EMAIL_USER.');
    error.code = 'EMAIL_SMTP_NOT_CONFIGURED';
    throw error;
  }
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    const error = new Error('SMTP credentials are not configured. Set EMAIL_USER and EMAIL_PASS.');
    error.code = 'EMAIL_SMTP_NOT_CONFIGURED';
    throw error;
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
