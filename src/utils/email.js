const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const emailPort = Number.parseInt(process.env.EMAIL_PORT, 10) || 465;

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: emailPort,
  secure: emailPort === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

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

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  };

  return transporter.sendMail(mailOptions);
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

module.exports = { sendEmail, transporter };
