const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendEmail } = require('../utils/email');

// Helper to compute expiry date
function getExpiryHours(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d;
}

async function sendAccountEmail(to, name, template, subject) {
  const siteUrl = (process.env.PUBLIC_SITE_URL
    || process.env.FRONTEND_URL?.split(',')[0].trim()
    || 'http://localhost:3000').replace(/\/+$/, '');
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.EMAIL_USER || '';
  const accountUrl = `${siteUrl}/login`;
  await sendEmail(to, subject, template, {
    name,
    year: new Date().getFullYear(),
    storeUrl: `${siteUrl}/`,
    shopUrl: `${siteUrl}/shop`,
    menCategoryUrl: `${siteUrl}/shop`,
    womenCategoryUrl: `${siteUrl}/shop`,
    newArrivalsUrl: `${siteUrl}/shop`,
    accountUrl,
    profileUrl: accountUrl,
    supportUrl: `${siteUrl}/contact`,
    supportEmail,
    returnPolicyUrl: `${siteUrl}/returns-exchanges`,
    privacyPolicyUrl: `${siteUrl}/privacy`,
    termsUrl: `${siteUrl}/terms`,
    instagramUrl: process.env.INSTAGRAM_URL || '#',
    loginDateTime: new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' }),
    device: 'Not collected',
    browser: 'Not collected',
    location: 'Not collected',
    securityUrl: `${siteUrl}/contact`,
  });
}

async function sendEmailNotification(to, name, template, subject) {
  try {
    await sendAccountEmail(to, name, template, subject);
    return true;
  } catch (error) {
    const errorCode = error.code || 'EMAIL_ERROR';
    const smtpStatus = error.responseCode ? `, SMTP ${error.responseCode}` : '';
    const reason = error.message ? `: ${error.message.slice(0, 240)}` : '';
    const authHint = errorCode === 'EAUTH' || error.responseCode === 535
      ? ' Gmail SMTP authentication failed; use a valid Gmail App Password.'
      : '';
    console.error(`${template} email failed (${errorCode}${smtpStatus})${reason}.${authHint}`);
    return false;
  }
}

exports.signup = async (req, res) => {
  try {
    const { name, password, phone, address } = req.body;
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!name || !email || !password) {
      return res.status(400).json({ msg: 'Name, email and password are required.' });
    }
    if (await User.findOne({ email })) return res.status(400).json({ msg: 'User already exists' });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({
      name,
      email,
      password: hashed,
      phone,
      address,
      expiresAt: getExpiryHours(58)
    });
    await user.save();
    const emailSent = await sendEmailNotification(
      email,
      name,
      'welcome',
      'Welcome to Vexora!'
    );
    res.json({
      message: emailSent
        ? 'Account created successfully. A welcome email has been sent.'
        : 'Account created successfully, but the welcome email could not be sent.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
};

exports.login = async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ msg: 'Email and password are required.' });
    }
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });
    if (user.isActive === false) return res.status(403).json({ msg: 'This account is inactive. Contact support for assistance.' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ msg: 'Invalid credentials' });
    user.expiresAt = getExpiryHours(58);
    await user.save();
    const emailSent = await sendEmailNotification(
      email,
      user.name,
      'loginThankYou',
      'Thank you for logging in to Vexora!'
    );
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      message: emailSent
        ? 'Login successful. A thank-you email has been sent.'
        : 'Login successful, but the thank-you email could not be sent.'
    });
  } catch (e) {
    console.error(e);
    res.status(500).send('Server error');
  }
};
