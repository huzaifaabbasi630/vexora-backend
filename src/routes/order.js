const express = require('express');
const { checkout, confirmOrder, updateOrderStatus } = require('../controllers/orderController');
const router = express.Router();

// POST /api/checkout – receive order, save to DB, send confirmation email
router.post('/checkout', checkout);

// GET /api/orders/confirm/:orderId – customer clicks email link to confirm order
router.get('/orders/confirm/:orderId', confirmOrder);

// GET /api/orders/:orderId/status/:status – owner clicks status link (Dispatched / On The Way)
router.get('/orders/:orderId/status/:status', updateOrderStatus);

module.exports = router;
