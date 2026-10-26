const express = require('express');
const { requireAuth, requireOwner } = require('../middleware/adminAuth');
const { isAllowedOrigin } = require('../config/allowedOrigins');
const {
  loginOwner,
  resendOtp,
  verifyOtp,
  logoutOwner,
  getCurrentOwner,
  getAdminOverview,
  getAdminCustomers,
  exportAdminCustomers,
  getAdminOrders,
  getCustomerDetail,
  updateCustomerStatus,
  anonymizeCustomer,
  deleteAdminCustomer,
  updateAdminOrderStatus,
  deleteAdminOrder,
  getAdminMessages,
  updateAdminMessageStatus,
  getAdminCmsPage,
  saveAdminCmsPage,
  getAdminReports,
  getAdminAuditLogs,
} = require('../controllers/adminController');
const {
  listAdminProducts,
  getAdminProduct,
  createAdminProduct,
  updateAdminProduct,
  archiveAdminProduct,
  setProductStatus,
} = require('../controllers/productController');

const router = express.Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
router.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ message: 'Request origin is not allowed.' });
  }
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    && req.headers.cookie?.includes('vexora_admin_session=')
    && !origin) {
    return res.status(403).json({ message: 'Origin validation is required.' });
  }
  return next();
});

router.post('/login', asyncHandler(loginOwner));
router.post('/resend-otp', asyncHandler(resendOtp));
router.post('/verify-otp', asyncHandler(verifyOtp));
router.post('/logout', asyncHandler(logoutOwner));
router.get('/me', requireAuth, requireOwner, asyncHandler(getCurrentOwner));
router.get('/overview', requireAuth, requireOwner, asyncHandler(getAdminOverview));
router.get('/customers', requireAuth, requireOwner, asyncHandler(getAdminCustomers));
router.get('/customers/export.csv', requireAuth, requireOwner, asyncHandler(exportAdminCustomers));
router.get('/customers/:customerId', requireAuth, requireOwner, asyncHandler(getCustomerDetail));
router.patch('/customers/:customerId/status', requireAuth, requireOwner, asyncHandler(updateCustomerStatus));
router.delete('/customers/:customerId/anonymize', requireAuth, requireOwner, asyncHandler(anonymizeCustomer));
router.delete('/customers/:customerId', requireAuth, requireOwner, asyncHandler(deleteAdminCustomer));
router.get('/orders', requireAuth, requireOwner, asyncHandler(getAdminOrders));
router.patch('/orders/:orderId/status', requireAuth, requireOwner, asyncHandler(updateAdminOrderStatus));
router.delete('/orders/:orderId', requireAuth, requireOwner, asyncHandler(deleteAdminOrder));
router.get('/messages', requireAuth, requireOwner, asyncHandler(getAdminMessages));
router.patch('/messages/:messageId/status', requireAuth, requireOwner, asyncHandler(updateAdminMessageStatus));
router.get('/cms/:slug', requireAuth, requireOwner, asyncHandler(getAdminCmsPage));
router.put('/cms/:slug', requireAuth, requireOwner, asyncHandler(saveAdminCmsPage));
router.get('/reports', requireAuth, requireOwner, asyncHandler(getAdminReports));
router.get('/audit-logs', requireAuth, requireOwner, asyncHandler(getAdminAuditLogs));
router.get('/products', requireAuth, requireOwner, asyncHandler(listAdminProducts));
router.get('/products/:productId', requireAuth, requireOwner, asyncHandler(getAdminProduct));
router.post('/products', requireAuth, requireOwner, asyncHandler(createAdminProduct));
router.patch('/products/:productId', requireAuth, requireOwner, asyncHandler(updateAdminProduct));
router.patch('/products/:productId/status', requireAuth, requireOwner, asyncHandler(setProductStatus));
router.delete('/products/:productId', requireAuth, requireOwner, asyncHandler(archiveAdminProduct));

module.exports = router;
