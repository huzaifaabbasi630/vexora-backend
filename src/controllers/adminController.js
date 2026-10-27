const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const User = require('../models/User');
const Order = require('../models/Order');
const AdminChallenge = require('../models/AdminChallenge');
const AdminAuditLog = require('../models/AdminAuditLog');
const ContactMessage = require('../models/ContactMessage');
const CmsPage = require('../models/CmsPage');
const Product = require('../models/Product');
const { sendEmail } = require('../utils/email');

const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'vexora055@gmail.com').trim().toLowerCase();
const OTP_WINDOW_MS = 5 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = (Number(process.env.ADMIN_SESSION_TTL_HOURS) || 8) * 60 * 60 * 1000;
const authRateLimits = new Map();

const getMaskedEmail = (email = '') => {
  const [local, domain] = String(email).split('@');
  if (!domain) return '****';
  const visibleLocal = local.length <= 2 ? local : `${local.slice(0, 2)}***`;
  return `${visibleLocal}@${domain}`;
};

const getClientIp = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

const consumeRateLimit = (req, action, maxRequests, windowMs) => {
  const ip = getClientIp(req);
  const now = Date.now();
  for (const [key, value] of authRateLimits) {
    if (value.resetAt <= now) authRateLimits.delete(key);
  }
  if (authRateLimits.size >= 10000 && !authRateLimits.has(`${action}:${ip}`)) {
    return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
  }
  const key = `${action}:${ip}`;
  const state = authRateLimits.get(key);

  if (!state) {
    authRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (state.resetAt <= now) {
    authRateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true };
  }

  if (state.count >= maxRequests) {
    return { allowed: false, retryAfter: Math.ceil((state.resetAt - now) / 1000) };
  }

  state.count += 1;
  authRateLimits.set(key, state);
  return { allowed: true };
};

const invalidatePendingChallenges = async (email) => {
  await AdminChallenge.updateMany(
    { ownerEmail: email, status: 'pending', expiresAt: { $gt: new Date() } },
    { $set: { status: 'expired', used: true } }
  );
};

const createAdminSessionToken = (user) => jwt.sign(
  {
    id: user._id,
    email: user.email,
    role: user.role || 'owner',
    name: user.name,
  },
  process.env.ADMIN_SESSION_SECRET || process.env.JWT_SECRET,
  { expiresIn: `${Math.round(ADMIN_SESSION_TTL_MS / 60000)}m` }
);

const logAuditAction = async (actor, action, metadata = {}, req) => {
  if (!actor || !actor._id) return;

  await AdminAuditLog.create({
    actorId: actor._id,
    actorEmail: actor.email,
    action,
    targetType: metadata.targetType || 'system',
    targetId: metadata.targetId || '',
    metadata: metadata.payload || {},
    ipAddress: getClientIp(req),
  });
};

const ensureOwnerExists = async () => {
  const owner = await User.findOne({ email: OWNER_EMAIL });

  if (owner && owner.role === 'owner' && owner.isOwner === true && owner.isActive !== false) {
    return owner;
  }

  return null;
};

const loginOwner = async (req, res) => {
  try {
    console.log('🔐 Admin login request received.');
    const { email = '', password = '' } = req.body || {};
    const normalizedEmail = String(email).trim().toLowerCase();
    const rateLimit = consumeRateLimit(req, 'login', 5, 15 * 60 * 1000);

    if (!rateLimit.allowed) {
      return res.status(429).json({ message: 'Too many attempts. Please try again later.', retryAfter: rateLimit.retryAfter });
    }

    if (!normalizedEmail || !String(password).trim()) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const owner = await ensureOwnerExists();

    if (!owner || owner.role !== 'owner' || owner.isOwner !== true || owner.isActive === false || normalizedEmail !== OWNER_EMAIL) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(String(password), owner.password || '');
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    console.log('🔎 Admin login credentials accepted; creating OTP challenge.');
    await invalidatePendingChallenges(owner.email);

    const otp = crypto.randomInt(100000, 1000000).toString().padStart(6, '0');
    const challengeId = crypto.randomUUID();
    const otpHash = await bcrypt.hash(otp, 10);

    await AdminChallenge.create({
      ownerEmail: owner.email,
      challengeId,
      otpHash,
      expiresAt: new Date(Date.now() + OTP_WINDOW_MS),
      lastResentAt: new Date(),
      attempts: 0,
      used: false,
      status: 'pending',
    });

    try {
      const emailResult = await sendEmail(
        owner.email,
        'VEXORA Owner Admin Login Code',
        'ownerOtp',
        {
          name: owner.name || 'Owner',
          code: otp,
          expiresIn: '5 minutes',
        }
      );
      const emailAccepted = Array.isArray(emailResult?.accepted)
        && emailResult.accepted.some((recipient) => String(recipient).toLowerCase() === owner.email.toLowerCase());
      if (!emailAccepted) {
        throw new Error('SMTP did not accept the admin OTP recipient.');
      }
      console.log('✅ Admin OTP email accepted by SMTP.');
    } catch (err) {
      await AdminChallenge.updateOne(
        { challengeId },
        { $set: { status: 'expired', used: true } }
      );
      console.error('❌ Admin Login Error:', {
        message: err.message,
        code: err.code,
        command: err.command,
        responseCode: err.responseCode,
        response: err.response,
      });
      return res.status(503).json({ message: 'Unable to send the OTP right now. Please try again later.' });
    }

    await logAuditAction(owner, 'owner_login_requested', { targetType: 'owner_auth', payload: { challengeId, requestIp: getClientIp(req) } }, req);
    console.log('✅ Admin login OTP challenge created successfully.');

    return res.status(200).json({
      message: 'Check your email for the verification code.',
      challengeId,
      maskedEmail: getMaskedEmail(owner.email),
    });
  } catch (err) {
    console.error('❌ Admin Login Error:', err);
    if (res.headersSent) return;
    return res.status(500).json({ message: 'Unable to process admin login right now. Please try again later.' });
  }
};

const resendOtp = async (req, res) => {
  const rateLimit = consumeRateLimit(req, 'resend', 3, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return res.status(429).json({ message: 'Too many resend requests. Please try again later.', retryAfter: rateLimit.retryAfter });
  }

  const { challengeId = '' } = req.body || {};
  const previous = await AdminChallenge.findOne({ challengeId });
  if (!previous || previous.ownerEmail !== OWNER_EMAIL || previous.used || previous.status !== 'pending' || previous.expiresAt <= new Date()) {
    return res.status(401).json({ message: 'This verification request is invalid or expired. Please sign in again.' });
  }

  if ((previous.resendCount || 0) >= 3) {
    return res.status(429).json({ message: 'You have reached the OTP resend limit. Please sign in again later.' });
  }

  const cooldownMs = 60 * 1000;
  if (previous.lastResentAt && Date.now() - previous.lastResentAt.getTime() < cooldownMs) {
    const retryAfter = Math.ceil((cooldownMs - (Date.now() - previous.lastResentAt.getTime())) / 1000);
    return res.status(429).json({ message: 'Please wait before requesting another code.', retryAfter });
  }

  previous.status = 'expired';
  previous.used = true;
  await previous.save();

  const otp = crypto.randomInt(100000, 1000000).toString().padStart(6, '0');
  const nextChallengeId = crypto.randomUUID();
  const nextChallenge = await AdminChallenge.create({
    ownerEmail: OWNER_EMAIL,
    challengeId: nextChallengeId,
    otpHash: await bcrypt.hash(otp, 10),
    expiresAt: new Date(Date.now() + OTP_WINDOW_MS),
    attempts: 0,
    resendCount: (previous.resendCount || 0) + 1,
    lastResentAt: new Date(),
    used: false,
    status: 'pending',
  });

  try {
    const owner = await User.findOne({ email: OWNER_EMAIL, role: 'owner', isOwner: true, isActive: { $ne: false } });
    if (!owner) {
      await AdminChallenge.updateOne({ _id: nextChallenge._id }, { $set: { status: 'expired', used: true } });
      return res.status(401).json({ message: 'Owner account is unavailable. Please sign in again.' });
    }
    await sendEmail(owner.email, 'VEXORA Owner Admin Login Code', 'ownerOtp', {
      name: owner.name || 'Owner',
      code: otp,
      expiresIn: '5 minutes',
    });
  } catch (error) {
    await AdminChallenge.updateOne({ _id: nextChallenge._id }, { $set: { status: 'expired', used: true } });
    console.error('Owner OTP resend email failed:', error.message);
    return res.status(503).json({ message: 'Unable to resend the OTP right now. Please try again later.' });
  }

  return res.status(200).json({
    message: 'A new verification code has been sent.',
    challengeId: nextChallengeId,
    maskedEmail: getMaskedEmail(OWNER_EMAIL),
  });
};

const verifyOtp = async (req, res) => {
  const rateLimit = consumeRateLimit(req, 'verify', 10, 15 * 60 * 1000);
  if (!rateLimit.allowed) {
    return res.status(429).json({ message: 'Too many verification attempts. Please try again later.', retryAfter: rateLimit.retryAfter });
  }

  const { challengeId = '', otp = '' } = req.body || {};
  const code = String(otp).trim();

  if (!challengeId || !code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ message: 'Enter the valid six-digit verification code.' });
  }

  const challenge = await AdminChallenge.findOne({ challengeId });
  if (!challenge) {
    return res.status(401).json({ message: 'The verification request is invalid or expired.' });
  }

  if (challenge.ownerEmail !== OWNER_EMAIL) {
    return res.status(401).json({ message: 'Owner account mismatch.' });
  }

  if (challenge.used || challenge.status === 'used' || challenge.expiresAt <= new Date()) {
    challenge.status = 'expired';
    challenge.used = true;
    await challenge.save();
    return res.status(401).json({ message: 'This verification code has expired. Please request a new one.' });
  }

  const matches = await bcrypt.compare(code, challenge.otpHash);
  if (!matches) {
    const failedChallenge = await AdminChallenge.findOneAndUpdate(
      { _id: challenge._id, used: false, status: 'pending', expiresAt: { $gt: new Date() } },
      { $inc: { attempts: 1 } },
      { new: true }
    );

    if (!failedChallenge || failedChallenge.attempts >= 5) {
      await AdminChallenge.updateOne(
        { _id: challenge._id, used: false },
        { $set: { used: true, status: 'expired' } }
      );
      return res.status(429).json({ message: 'Too many failed attempts. Please request a new code.' });
    }

    return res.status(401).json({ message: 'The verification code is invalid.' });
  }

  const consumedChallenge = await AdminChallenge.findOneAndUpdate(
    { _id: challenge._id, used: false, status: 'pending', expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
    { $set: { used: true, status: 'used' } },
    { new: true }
  );
  if (!consumedChallenge) {
    return res.status(401).json({ message: 'This verification code has expired or was already used.' });
  }

  const owner = await User.findOne({ email: OWNER_EMAIL, role: 'owner', isOwner: true, isActive: { $ne: false } });
  if (!owner) {
    return res.status(500).json({ message: 'Owner account is unavailable.' });
  }

  await logAuditAction(owner, 'owner_login_verified', { targetType: 'owner_auth', payload: { challengeId } }, req);

  const token = createAdminSessionToken(owner);
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('vexora_admin_session', token, {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    maxAge: ADMIN_SESSION_TTL_MS,
    path: '/',
  });

  return res.status(200).json({
    message: 'Owner access verified successfully.',
    owner: {
      name: owner.name,
      email: owner.email,
      role: owner.role || 'owner',
    },
  });
};

const logoutOwner = async (req, res) => {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie('vexora_admin_session', {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    secure: isProduction,
    path: '/',
  });
  return res.status(200).json({ message: 'Logged out successfully.' });
};

const getCurrentOwner = async (req, res) => {
  const owner = await User.findById(req.user.id).select('name email role isActive isOwner createdAt');
  if (!owner || owner.role !== 'owner' || owner.isOwner !== true || owner.isActive === false || owner.email !== OWNER_EMAIL) {
    return res.status(403).json({ message: 'Owner access required.' });
  }

  return res.json({
    id: owner._id,
    name: owner.name,
    email: owner.email,
    role: owner.role,
    isActive: owner.isActive,
  });
};

const getAdminOverview = async (req, res) => {
  const range = String(req.query.range || '30d');
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  let from;
  let to;

  if (range === 'today') {
    from = todayStart;
    to = tomorrowStart;
  } else if (range === '7d' || range === '30d') {
    const days = range === '7d' ? 7 : 30;
    from = new Date(todayStart.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
    to = tomorrowStart;
  } else if (range === 'thisMonth') {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    to = tomorrowStart;
  } else if (range === 'previousMonth') {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  } else if (range === 'custom') {
    const { from: fromParam, to: toParam } = req.query;
    const isDateOnly = (value) => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!isDateOnly(fromParam) || !isDateOnly(toParam)) {
      return res.status(400).json({ message: 'Custom ranges require valid from and to dates in YYYY-MM-DD format.' });
    }
    from = new Date(`${fromParam}T00:00:00.000Z`);
    to = new Date(new Date(`${toParam}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000);
    if (from >= to || to > tomorrowStart || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      return res.status(400).json({ message: 'Select a valid range ending no later than today and spanning at most 366 days.' });
    }
  } else {
    return res.status(400).json({ message: 'Range must be today, 7d, 30d, thisMonth, previousMonth, or custom.' });
  }

  const customerQuery = { role: { $ne: 'owner' }, isOwner: { $ne: true } };
  const orderDateQuery = { createdAt: { $gte: from, $lt: to } };
  const eligibleStatuses = ['Confirmed', 'Dispatched', 'On The Way', 'Delivered'];
  const [totalCustomers, newCustomers, ordersInRange, statusDistribution, orderSeries, recentCustomers, recentOrders,
    publishedProducts, inventoryStats, awaitingConfirmation, unreadMessages, recentActivity, ordersToday] = await Promise.all([
    User.countDocuments(customerQuery),
    User.countDocuments({ ...customerQuery, createdAt: orderDateQuery.createdAt }),
    Order.countDocuments(orderDateQuery),
    Order.aggregate([
      { $match: orderDateQuery },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    Order.aggregate([
      { $match: orderDateQuery },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
          orders: { $sum: 1 },
          eligibleOrderCount: { $sum: { $cond: [{ $in: ['$status', eligibleStatuses] }, 1, 0] } },
          eligibleOrderValue: {
            $sum: { $cond: [{ $in: ['$status', eligibleStatuses] }, '$total', 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    User.find(customerQuery).sort({ createdAt: -1, _id: -1 }).limit(5).select('name email createdAt isActive').lean(),
    Order.find({}).sort({ createdAt: -1, _id: -1 }).limit(5).select('customerInfo.name total status createdAt').lean(),
    Product.countDocuments({ status: 'published' }),
    Product.aggregate([
      { $match: { status: 'published', trackInventory: true } },
      {
        $project: {
          availableUnits: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$variants', []] } }, 0] },
              { $sum: '$variants.stock' },
              '$stock',
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          trackedProducts: { $sum: 1 },
          outOfStockProducts: { $sum: { $cond: [{ $lte: ['$availableUnits', 0] }, 1, 0] } },
        },
      },
    ]),
    Order.countDocuments({ ...orderDateQuery, status: 'Pending Confirmation' }),
    ContactMessage.countDocuments({ status: 'New' }),
    AdminAuditLog.find({}).sort({ createdAt: -1, _id: -1 }).limit(5)
      .select('actorEmail action targetType targetId createdAt').lean(),
    Order.countDocuments({ createdAt: { $gte: todayStart, $lt: tomorrowStart } }),
  ]);

  const eligibleOrderValue = orderSeries.reduce((sum, item) => sum + item.eligibleOrderValue, 0);
  const eligibleOrderCount = orderSeries.reduce((sum, item) => sum + item.eligibleOrderCount, 0);
  const statusCounts = Object.fromEntries(statusDistribution.map(({ _id, count }) => [_id, count]));
  const trackedInventory = inventoryStats[0]?.trackedProducts || 0;

  return res.json({
    range: { preset: range, from, to, timezone: 'UTC' },
    summary: {
      totalCustomers,
      newCustomers,
      totalOrders: ordersInRange,
      pendingOrders: statusCounts['Pending Confirmation'] || 0,
      confirmingOrders: statusCounts.Confirming || 0,
      confirmedOrders: statusCounts.Confirmed || 0,
      shippedOrders: statusCounts.Dispatched || 0,
      onWayOrders: statusCounts['On The Way'] || 0,
      deliveredOrders: statusCounts.Delivered || 0,
      ordersToday,
      eligibleOrderValue,
      eligibleOrderCount,
      averageOrderValue: eligibleOrderCount ? eligibleOrderValue / eligibleOrderCount : 0,
      collectedRevenue: null,
      paymentTrackingAvailable: false,
      publishedProducts,
      trackedProducts: trackedInventory,
      outOfStockProducts: inventoryStats[0]?.outOfStockProducts || 0,
      lowStockThresholdConfigured: false,
      awaitingConfirmation: awaitingConfirmation + (statusCounts.Confirming || 0),
      unreadMessages,
    },
    metricDefinitions: {
      eligibleOrderValue: `Sum of order totals for statuses ${eligibleStatuses.join(', ')} with createdAt in the selected UTC range. This is order value, not collected revenue.`,
      averageOrderValue: 'Eligible order value divided by eligible order count for the selected UTC range.',
      collectedRevenue: 'Unavailable: the application does not store verified payment or refund records.',
      inventory: trackedInventory ? 'Inventory counts include published products with inventory tracking enabled; variant quantities are summed per product.' : 'No published products currently have inventory tracking enabled.',
      lowStock: 'Unavailable: no low-stock threshold is configured.',
    },
    statusDistribution,
    orderSeries,
    recentCustomers,
    recentOrders,
    recentActivity,
    updatedAt: new Date(),
  });
};

const getAdminCustomers = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const search = String(req.query.search || '').trim().slice(0, 80);
  const status = String(req.query.status || '').trim();

  const query = { role: { $ne: 'owner' } };
  if (status === 'active') query.isActive = { $ne: false };
  if (status === 'inactive') query.isActive = false;
  if (search) {
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [{ name: { $regex: safeSearch, $options: 'i' } }, { email: { $regex: safeSearch, $options: 'i' } }];
    if (/^[a-f\d]{24}$/i.test(search)) query.$or.push({ _id: search });
  }

  const [total, customers] = await Promise.all([
    User.countDocuments(query),
    User.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('name email phone createdAt isActive'),
  ]);
  const emails = customers.map(({ email }) => email);
  const orders = emails.length ? await Order.aggregate([
    { $match: { 'customerInfo.email': { $in: emails } } },
    { $sort: { createdAt: -1 } },
    { $group: {
      _id: '$customerInfo.email',
      orderCount: { $sum: 1 },
      eligibleSpending: { $sum: { $cond: [{ $ne: ['$status', 'Pending Confirmation'] }, '$total', 0] } },
      latestOrder: { $first: '$createdAt' },
    } },
  ]) : [];
  const orderStats = new Map(orders.map((order) => [order._id, order]));
  const rows = customers.map((customer) => ({
    ...customer.toObject(),
    ...(orderStats.get(customer.email) || { orderCount: 0, eligibleSpending: 0, latestOrder: null }),
  }));

  return res.json({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    rows,
  });
};

const exportAdminCustomers = async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 80);
  const status = String(req.query.status || '').trim();
  const query = { role: { $ne: 'owner' } };
  if (status === 'active') query.isActive = { $ne: false };
  if (status === 'inactive') query.isActive = false;
  if (search) {
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [{ name: { $regex: safeSearch, $options: 'i' } }, { email: { $regex: safeSearch, $options: 'i' } }];
    if (/^[a-f\d]{24}$/i.test(search)) query.$or.push({ _id: search });
  }
  const csvCell = (value) => {
    const text = String(value ?? '');
    return `"${/^[=+\-@]/.test(text) ? `'${text}` : text.replace(/"/g, '""')}"`;
  };

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="vexora-customers.csv"');
  res.write('customer_id,name,email,phone,registered_at,status\r\n');
  const cursor = User.find(query).select('name email phone createdAt isActive').sort({ createdAt: -1 }).lean().cursor();
  for await (const customer of cursor) {
    const cells = [
      customer._id,
      customer.name,
      customer.email,
      customer.phone || '',
      customer.createdAt?.toISOString() || '',
      customer.isActive === false ? 'Inactive' : 'Active',
    ];
    if (!res.write(`${cells.map(csvCell).join(',')}\r\n`)) {
      await new Promise((resolve) => res.once('drain', resolve));
    }
  }
  return res.end();
};

const getCustomerDetail = async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.customerId)) {
    return res.status(400).json({ message: 'Invalid customer ID.' });
  }
  const customer = await User.findOne({ _id: req.params.customerId, role: { $ne: 'owner' } })
    .select('name email phone address createdAt isActive');
  if (!customer) return res.status(404).json({ message: 'Customer not found.' });

  const [orderHistory, totals] = await Promise.all([
    Order.find({ 'customerInfo.email': customer.email }).sort({ createdAt: -1 }).limit(50).lean(),
    Order.aggregate([
      { $match: { 'customerInfo.email': customer.email, status: { $ne: 'Pending Confirmation' } } },
      { $group: { _id: null, count: { $sum: 1 }, spending: { $sum: '$total' }, latestOrder: { $max: '$createdAt' } } },
    ]),
  ]);

  return res.json({
    customer,
    orderHistory,
    orderCount: totals[0]?.count || 0,
    eligibleSpending: totals[0]?.spending || 0,
    latestOrder: totals[0]?.latestOrder || null,
  });
};

const updateCustomerStatus = async (req, res) => {
  const { isActive } = req.body || {};
  if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be a boolean.' });
  if (!/^[a-f\d]{24}$/i.test(req.params.customerId)) return res.status(400).json({ message: 'Invalid customer ID.' });

  const customer = await User.findOneAndUpdate(
    { _id: req.params.customerId, role: { $ne: 'owner' } },
    { $set: { isActive } },
    { new: true, runValidators: true }
  ).select('name email isActive');
  if (!customer) return res.status(404).json({ message: 'Customer not found.' });
  await logAuditAction(req.owner, isActive ? 'customer_activated' : 'customer_deactivated', {
    targetType: 'customer',
    targetId: String(customer._id),
  }, req);
  return res.json({ message: `Customer ${isActive ? 'reactivated' : 'deactivated'}.`, customer });
};

const anonymizeCustomer = async (req, res) => {
  if (req.body?.confirmation !== 'ANONYMIZE') {
    return res.status(400).json({ message: 'Explicit confirmation is required.' });
  }
  if (!/^[a-f\d]{24}$/i.test(req.params.customerId)) {
    return res.status(400).json({ message: 'Invalid customer ID.' });
  }

  const customer = await User.findOne({ _id: req.params.customerId, role: { $ne: 'owner' } });
  if (!customer) return res.status(404).json({ message: 'Customer not found.' });
  const id = String(customer._id);
  const anonymizedEmail = `deleted-${id}@anonymized.invalid`;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Order.updateMany(
        { 'customerInfo.email': customer.email },
        {
          $set: {
            'customerInfo.name': 'Deleted customer',
            'customerInfo.email': anonymizedEmail,
            'customerInfo.phone': '',
            'customerInfo.address': 'Removed',
          },
        },
        { session }
      );
      customer.name = 'Deleted customer';
      customer.email = anonymizedEmail;
      customer.password = crypto.randomBytes(48).toString('hex');
      customer.phone = '';
      customer.address = '';
      customer.isActive = false;
      await customer.save({ session });
      await AdminAuditLog.create([{
        actorId: req.owner._id,
        actorEmail: req.owner.email,
        action: 'customer_anonymized',
        targetType: 'customer',
        targetId: id,
        metadata: { ordersRetained: true },
        ipAddress: getClientIp(req),
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  return res.json({ message: 'Customer profile and linked order contact details were anonymized. Order records were retained.' });
};

const deleteAdminCustomer = async (req, res) => {
  if (req.body?.confirmation !== 'DELETE') {
    return res.status(400).json({ message: 'Type DELETE to confirm permanent customer account deletion.' });
  }
  if (!/^[a-f\d]{24}$/i.test(req.params.customerId)) {
    return res.status(400).json({ message: 'Invalid customer ID.' });
  }

  const session = await mongoose.startSession();
  let deleted = false;
  try {
    await session.withTransaction(async () => {
      const result = await User.deleteOne({
        _id: req.params.customerId,
        role: { $ne: 'owner' },
        isOwner: { $ne: true },
      }, { session });
      deleted = result.deletedCount === 1;
      if (!deleted) return;
      await AdminAuditLog.create([{
        actorId: req.owner._id,
        actorEmail: req.owner.email,
        action: 'customer_deleted',
        targetType: 'customer',
        targetId: req.params.customerId,
        metadata: { ordersRetained: true },
        ipAddress: getClientIp(req),
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  if (!deleted) return res.status(404).json({ message: 'Customer not found.' });
  return res.json({ message: 'Customer account and profile permanently deleted. Order records were retained.' });
};

const getAdminOrders = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();

  const query = {};
  const allowedStatuses = ['Pending Confirmation', 'Confirming', 'Confirmed', 'Dispatched', 'On The Way', 'Delivered'];
  if (status && allowedStatuses.includes(status)) query.status = status;
  if (search) {
    const safeSearch = search.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchOr = [
      { 'customerInfo.name': { $regex: safeSearch, $options: 'i' } },
      { 'customerInfo.email': { $regex: safeSearch, $options: 'i' } },
    ];
    if (/^[a-f\d]{24}$/i.test(search)) searchOr.unshift({ _id: search });
    query.$or = searchOr;
  }

  const [total, rows] = await Promise.all([
    Order.countDocuments(query),
    Order.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return res.json({
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    rows,
  });
};

const updateAdminOrderStatus = async (req, res) => {
  const { status } = req.body || {};
  const transitions = {
    Confirmed: ['Dispatched'],
    Dispatched: ['On The Way'],
    'On The Way': ['Delivered'],
  };
  if (!/^[a-f\d]{24}$/i.test(req.params.orderId)) return res.status(400).json({ message: 'Invalid order ID.' });
  if (!Object.keys(transitions).some((key) => transitions[key].includes(status))) {
    return res.status(400).json({ message: 'Unsupported order status transition.' });
  }

  const order = await Order.findById(req.params.orderId);
  if (!order) return res.status(404).json({ message: 'Order not found.' });
  if (!transitions[order.status]?.includes(status)) {
    return res.status(409).json({ message: `Cannot move an order from ${order.status} to ${status}.` });
  }
  const previousStatus = order.status;
  order.status = status;
  await order.save();
  await logAuditAction(req.owner, 'order_status_updated', {
    targetType: 'order',
    targetId: String(order._id),
    payload: { from: previousStatus, to: status },
  }, req);

  let notification = 'not sent';
  if (['Dispatched', 'On The Way'].includes(status) && order.customerInfo?.email) {
    try {
      const { sendOrderStatusEmail } = require('../utils/orderStatusEmail');
      await sendOrderStatusEmail(order, status);
      notification = 'sent';
    } catch (error) {
      console.error(`Order status email failed (${error.code || 'EMAIL_ERROR'}).`);
      notification = 'failed';
    }
  }
  const notificationMessage = notification === 'failed'
    ? 'Order status was saved, but the customer email could not be sent.'
    : notification === 'not sent'
      ? 'Order status was saved. No customer notification was sent.'
      : 'Order status was saved and the customer email was sent.';
  return res.json({ message: 'Order status updated.', notification, notificationMessage, order });
};

const deleteAdminOrder = async (req, res) => {
  if (req.body?.confirmation !== 'DELETE') {
    return res.status(400).json({ message: 'Type DELETE to confirm permanent order deletion.' });
  }
  if (!/^[a-f\d]{24}$/i.test(req.params.orderId)) {
    return res.status(400).json({ message: 'Invalid order ID.' });
  }

  const session = await mongoose.startSession();
  let deleted = false;
  try {
    await session.withTransaction(async () => {
      const result = await Order.deleteOne({ _id: req.params.orderId }, { session });
      deleted = result.deletedCount === 1;
      if (!deleted) return;
      await AdminAuditLog.create([{
        actorId: req.owner._id,
        actorEmail: req.owner.email,
        action: 'order_deleted',
        targetType: 'order',
        targetId: req.params.orderId,
        ipAddress: getClientIp(req),
      }], { session });
    });
  } finally {
    await session.endSession();
  }
  if (!deleted) return res.status(404).json({ message: 'Order not found.' });
  return res.json({ message: 'Order permanently deleted.' });
};

const getAdminMessages = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const status = String(req.query.status || '').trim();
  const search = String(req.query.search || '').trim().slice(0, 80);
  const query = {};
  if (['New', 'In Progress', 'Resolved', 'Archived'].includes(status)) query.status = status;
  if (search) {
    const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.$or = [
      { name: { $regex: safeSearch, $options: 'i' } },
      { email: { $regex: safeSearch, $options: 'i' } },
      { subject: { $regex: safeSearch, $options: 'i' } },
    ];
  }
  const [total, rows] = await Promise.all([
    ContactMessage.countDocuments(query),
    ContactMessage.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return res.json({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), rows });
};

const updateAdminMessageStatus = async (req, res) => {
  const { status } = req.body || {};
  if (!['New', 'In Progress', 'Resolved', 'Archived'].includes(status)) {
    return res.status(400).json({ message: 'Invalid contact message status.' });
  }
  if (!/^[a-f\d]{24}$/i.test(req.params.messageId)) return res.status(400).json({ message: 'Invalid message ID.' });
  const message = await ContactMessage.findByIdAndUpdate(
    req.params.messageId,
    { $set: { status } },
    { new: true, runValidators: true }
  ).select('-message');
  if (!message) return res.status(404).json({ message: 'Contact message not found.' });
  await logAuditAction(req.owner, 'contact_message_status_updated', {
    targetType: 'contact_message',
    targetId: String(message._id),
    payload: { status },
  }, req);
  return res.json({ message: 'Contact message updated.', item: message });
};

const getAdminCmsPage = async (req, res) => {
  const allowedSlugs = new Set(['home', 'shop', 'about', 'contact', 'faq', 'shipping', 'returns', 'privacy', 'terms', 'size-guide']);
  if (!allowedSlugs.has(req.params.slug)) return res.status(404).json({ message: 'CMS page not found.' });
  const page = await CmsPage.findOne({ slug: req.params.slug }).lean();
  return res.json({
    slug: req.params.slug,
    draft: page?.draft || page?.publishedContent || {},
    publishedContent: page?.publishedContent || null,
    updatedAt: page?.updatedAt || null,
    versions: (page?.versions || []).slice(-10).reverse().map(({ savedAt, published }) => ({ savedAt, published })),
  });
};

const saveAdminCmsPage = async (req, res) => {
  const { content, publish = false } = req.body || {};
  const slug = req.params.slug;
  const allowedSlugs = new Set(['home', 'shop', 'about', 'contact', 'faq', 'shipping', 'returns', 'privacy', 'terms', 'size-guide']);
  if (!allowedSlugs.has(slug)) return res.status(404).json({ message: 'CMS page not found.' });
  if (!content || typeof content !== 'object' || Array.isArray(content) || typeof publish !== 'boolean') {
    return res.status(400).json({ message: 'Provide a content object and a boolean publish value.' });
  }
  const validImageSource = (value) => typeof value === 'string'
    && value.length <= 2048
    && /^(https?:\/\/|\/(?!\/))/i.test(value.trim())
    && !/[\u0000-\u001f]/.test(value);
  if (slug === 'home') {
    if (!Array.isArray(content.heroImages) || content.heroImages.length !== 4
      || !content.heroImages.every(validImageSource)
      || !Array.isArray(content.trendingCategoryImages) || content.trendingCategoryImages.length !== 4
      || !content.trendingCategoryImages.every(validImageSource)) {
      return res.status(400).json({ message: 'Homepage requires four valid hero image sources and four valid trending category image sources.' });
    }
  }
  if (slug === 'shop' && !validImageSource(content.heroImage)) {
    return res.status(400).json({ message: 'Shop requires a valid header image source.' });
  }
  const serialized = JSON.stringify(content);
  if (serialized.length > 30000) return res.status(413).json({ message: 'CMS content is too large.' });
  if (/(<script\b|javascript:|onerror\s*=|onload\s*=)/i.test(serialized)) {
    return res.status(400).json({ message: 'Scripts and executable content are not allowed.' });
  }

  const page = await CmsPage.findOneAndUpdate(
    { slug },
    {
      $set: {
        draft: content,
        ...(publish ? { publishedContent: content } : {}),
        updatedBy: req.owner.email,
      },
      $push: {
        versions: { $each: [{ content, published: publish, savedAt: new Date() }], $slice: -20 },
      },
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  await logAuditAction(req.owner, publish ? 'cms_page_published' : 'cms_page_draft_saved', {
    targetType: 'cms_page',
    targetId: slug,
  }, req);
  return res.json({
    message: publish ? 'Page draft saved and published.' : 'Draft saved.',
    slug,
    draft: page.draft,
    publishedContent: page.publishedContent,
  });
};

const getPublishedCmsPage = async (req, res) => {
  const allowedSlugs = new Set(['home', 'shop', 'about', 'contact', 'faq', 'shipping', 'returns', 'privacy', 'terms', 'size-guide']);
  if (!allowedSlugs.has(req.params.slug)) return res.status(404).json({ message: 'Page not found.' });
  const page = await CmsPage.findOne({ slug: req.params.slug }).select('slug publishedContent updatedAt').lean();
  if (!page?.publishedContent) {
    if (['home', 'shop'].includes(req.params.slug)) {
      return res.json({ slug: req.params.slug, content: null, updatedAt: page?.updatedAt || null });
    }
    return res.status(404).json({ message: 'No published CMS content for this page.' });
  }
  return res.json({ slug: page.slug, content: page.publishedContent, updatedAt: page.updatedAt });
};

const getAdminReports = async (req, res) => {
  const now = new Date();
  const from = req.query.from ? new Date(req.query.from) : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = req.query.to ? new Date(req.query.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return res.status(400).json({ message: 'Provide a valid date range of no more than one year.' });
  }
  const [statusDistribution, sales, newCustomers] = await Promise.all([
    Order.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Order.aggregate([
      { $match: { createdAt: { $gte: from, $lte: to }, status: { $ne: 'Pending Confirmation' } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, orders: { $sum: 1 }, eligibleOrderValue: { $sum: '$total' } } },
      { $sort: { _id: 1 } },
    ]),
    User.countDocuments({ role: { $ne: 'owner' }, createdAt: { $gte: from, $lte: to } }),
  ]);
  const eligibleOrderValue = sales.reduce((sum, item) => sum + item.eligibleOrderValue, 0);
  const orderCount = sales.reduce((sum, item) => sum + item.orders, 0);
  return res.json({
    range: { from, to },
    metricDefinitions: { eligibleOrderValue: 'Sum of non-pending order totals. Not a payment collection or profit measure.' },
    eligibleOrderValue,
    completedOrConfirmedOrders: orderCount,
    averageOrderValue: orderCount ? eligibleOrderValue / orderCount : 0,
    newCustomers,
    statusDistribution,
    sales,
  });
};

const getAdminAuditLogs = async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const [total, rows] = await Promise.all([
    AdminAuditLog.countDocuments(),
    AdminAuditLog.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
  ]);
  return res.json({ page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), rows });
};

module.exports = {
  ensureOwnerExists,
  loginOwner,
  verifyOtp,
  logoutOwner,
  getCurrentOwner,
  getAdminOverview,
  getAdminCustomers,
  getAdminOrders,
  resendOtp,
  getCustomerDetail,
  exportAdminCustomers,
  updateCustomerStatus,
  anonymizeCustomer,
  deleteAdminCustomer,
  updateAdminOrderStatus,
  deleteAdminOrder,
  getAdminMessages,
  updateAdminMessageStatus,
  getAdminCmsPage,
  saveAdminCmsPage,
  getPublishedCmsPage,
  getAdminReports,
  getAdminAuditLogs,
};
