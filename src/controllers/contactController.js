const nodemailer = require('nodemailer');
const ContactMessage = require('../models/ContactMessage');

const MAX_REQUESTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const requestWindows = new Map();
const allowedSubjects = new Set([
  'Product question',
  'Sizing help',
  'Order support',
  'Shipping',
  'Returns and exchanges',
  'Other',
]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function rateLimitContact(req, res, next) {
  const now = Date.now();
  for (const [ip, window] of requestWindows) {
    if (window.resetAt <= now) requestWindows.delete(ip);
  }

  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const current = requestWindows.get(key);
  if (!current || current.resetAt <= now) {
    if (requestWindows.size >= 5000) {
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }
    requestWindows.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (current.count >= MAX_REQUESTS) {
    res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Too many messages. Please try again later.' });
  }

  current.count += 1;
  return next();
}

async function sendContactMessage(req, res) {
  const { name, email, subject, orderNumber = '', message, website = '' } = req.body || {};

  if (typeof website === 'string' && website.trim()) {
    return res.status(400).json({ message: 'Please check your form and try again.' });
  }

  const cleanName = typeof name === 'string' ? name.trim() : '';
  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanSubject = typeof subject === 'string' ? subject.trim() : '';
  const cleanOrderNumber = typeof orderNumber === 'string' ? orderNumber.trim() : '';
  const cleanMessage = typeof message === 'string' ? message.trim() : '';
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ message: 'Name must be between 2 and 100 characters.' });
  }
  if (cleanEmail.length > 254 || !emailPattern.test(cleanEmail)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }
  if (!allowedSubjects.has(cleanSubject)) {
    return res.status(400).json({ message: 'Choose a valid message subject.' });
  }
  if (cleanOrderNumber.length > 80) {
    return res.status(400).json({ message: 'Order number must be 80 characters or fewer.' });
  }
  if (cleanMessage.length < 10 || cleanMessage.length > 3000) {
    return res.status(400).json({ message: 'Message must be between 10 and 3000 characters.' });
  }

  try {
    await ContactMessage.create({
      name: cleanName,
      email: cleanEmail,
      subject: cleanSubject,
      orderNumber: cleanOrderNumber,
      message: cleanMessage,
    });
  } catch (error) {
    console.error(`Contact message persistence failed (${error.code || 'DATABASE_ERROR'}).`);
    return res.status(503).json({ message: 'We could not save your message right now. Please try again later.' });
  }

  const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL_USER;
  if (!supportEmail || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error('Contact email is not configured. Check SUPPORT_EMAIL, EMAIL_USER and EMAIL_PASS.');
    return res.status(503).json({ message: 'Your message was saved, but email delivery is not configured. Please use WhatsApp or try again later.' });
  }

  const text = [
    'New VEXORA contact message',
    `Name: ${cleanName}`,
    `Email: ${cleanEmail}`,
    `Subject: ${cleanSubject}`,
    `Order number: ${cleanOrderNumber || 'Not provided'}`,
    '',
    cleanMessage,
  ].join('\n');
  const html = `
    <h2>New VEXORA contact message</h2>
    <p><strong>Name:</strong> ${escapeHtml(cleanName)}</p>
    <p><strong>Email:</strong> ${escapeHtml(cleanEmail)}</p>
    <p><strong>Subject:</strong> ${escapeHtml(cleanSubject)}</p>
    <p><strong>Order number:</strong> ${escapeHtml(cleanOrderNumber || 'Not provided')}</p>
    <p>${escapeHtml(cleanMessage).replace(/\r?\n/g, '<br>')}</p>`;

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: Number.parseInt(process.env.EMAIL_PORT, 10) || 465,
      secure: (Number.parseInt(process.env.EMAIL_PORT, 10) || 465) === 465,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: supportEmail,
      replyTo: cleanEmail,
      subject: `VEXORA contact: ${cleanSubject}`,
      text,
      html,
    });
    return res.status(200).json({ message: 'Thanks for reaching out. Your message was sent successfully.' });
  } catch (error) {
    console.error(`Contact email failed (${error.code || 'EMAIL_ERROR'}${error.responseCode ? `, SMTP ${error.responseCode}` : ''}).`);
    return res.status(502).json({ message: 'Your message was saved, but email delivery failed. Please contact us by email or WhatsApp if urgent.' });
  }
}

module.exports = { rateLimitContact, sendContactMessage };
