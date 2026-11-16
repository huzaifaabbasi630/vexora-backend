const fs = require('fs');
const path = require('path');

const BREVO_EMAIL_API_URL = 'https://api.brevo.com/v3/smtp/email';

function getEmailConfigStatus() {
  return {
    provider: 'brevo-api',
    senderConfigured: Boolean(process.env.EMAIL_FROM || process.env.EMAIL_USER),
    apiKeyConfigured: Boolean(process.env.EMAIL_PASS),
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
      if (key === 'html' || key === 'textContent' || key === 'replyTo') return;
      const placeholder = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      // Keys ending with 'Html' are injected as raw HTML (not escaped)
      const safe = key.endsWith('Html') ? String(value) : escapeHtml(value);
      html = html.replace(placeholder, () => safe);
    });
  }

  const from = process.env.EMAIL_FROM || process.env.EMAIL_USER;
  if (!from) {
    const error = new Error('Email sender is not configured. Set EMAIL_FROM or EMAIL_USER.');
    error.code = 'EMAIL_BREVO_NOT_CONFIGURED';
    throw error;
  }
  if (!process.env.EMAIL_PASS) {
    const error = new Error('Brevo API key is not configured. Set EMAIL_PASS.');
    error.code = 'EMAIL_BREVO_NOT_CONFIGURED';
    throw error;
  }

  const payload = {
    sender: {
      name: process.env.EMAIL_FROM_NAME || 'VEXORA',
      email: from,
    },
    to: [{ email: to }],
    subject,
    htmlContent: html,
  };
  if (typeof variables.textContent === 'string') {
    payload.textContent = variables.textContent;
  }
  if (typeof variables.replyTo === 'string' && variables.replyTo) {
    payload.replyTo = { email: variables.replyTo };
  }

  try {
    const response = await fetch(BREVO_EMAIL_API_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': process.env.EMAIL_PASS,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    let responseData = null;
    if (responseText) {
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { message: responseText };
      }
    }

    if (!response.ok) {
      const detail = responseData?.message || responseData?.code || response.statusText || 'Unknown Brevo API error.';
      const error = new Error(`Brevo email API request failed (HTTP ${response.status}): ${String(detail).slice(0, 300)}`);
      error.code = responseData?.code || 'BREVO_API_ERROR';
      error.responseCode = response.status;
      throw error;
    }

    return responseData;
  } catch (error) {
    console.error('Brevo email API request failed:', {
      code: error.code || 'EMAIL_REQUEST_FAILED',
      responseCode: error.responseCode || null,
      message: error.message,
    });
    throw error;
  }
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

module.exports = { sendEmail, getEmailConfigStatus };
