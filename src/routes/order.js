const express = require('express');
const { checkout, confirmOrder, confirmOrderFromPage, updateOrderStatus } = require('../controllers/orderController');
const router = express.Router();

// POST /api/checkout – save an order pending customer confirmation
router.post('/checkout', checkout);

// GET /api/orders/confirm/:orderId – customer clicks email link to confirm order
router.get('/orders/confirm/:orderId', confirmOrder);
router.post('/orders/confirm/:orderId', confirmOrderFromPage);

// GET /api/orders/:orderId/status/:status – owner clicks status link (Dispatched / On The Way)
router.get('/orders/:orderId/status/:status', updateOrderStatus);

module.exports = router;
