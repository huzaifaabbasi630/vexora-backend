const express = require('express');
const router = express.Router();
const { verifyWebhook, handleWebhook } = require('../controllers/webhookController');

// GET /webhook  – Meta hub verification
router.get('/', verifyWebhook);

// POST /webhook – Incoming events (button presses, etc.)
router.post('/', handleWebhook);

module.exports = router;
