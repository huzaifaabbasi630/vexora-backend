const jwt = require('jsonwebtoken');
const User = require('../models/User');

const getCookieValue = (cookieHeader, name) => {
  if (!cookieHeader) return '';
  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!match) return '';
  try {
    return decodeURIComponent(match.slice(name.length + 1));
  } catch (error) {
    return '';
  }
};

const getTokenFromRequest = (req) => {
  const cookieToken = getCookieValue(req.headers.cookie, 'vexora_admin_session');
  if (cookieToken) return cookieToken;

  const headerToken = req.headers.authorization || '';
  if (headerToken.startsWith('Bearer ')) {
    return headerToken.replace('Bearer ', '').trim();
  }

  return '';
};

const requireAuth = (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ message: 'Session expired or missing.' });
  }

  try {
    const decoded = jwt.verify(token, process.env.ADMIN_SESSION_SECRET || process.env.JWT_SECRET);
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired session.' });
  }
};

const requireOwner = async (req, res, next) => {
  try {
    if (!req.user || req.user.role !== 'owner') {
      return res.status(403).json({ message: 'Owner access required.' });
    }

    const ownerEmail = (process.env.OWNER_EMAIL || 'vexora055@gmail.com').trim().toLowerCase();
    const owner = await User.findOne({
      _id: req.user.id,
      email: ownerEmail,
      role: 'owner',
      isOwner: true,
      isActive: { $ne: false },
    }).select('_id email');

    if (!owner) {
      return res.status(403).json({ message: 'Owner access required.' });
    }

    req.owner = owner;
    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Unable to verify owner access.' });
  }
};

module.exports = { requireAuth, requireOwner };
