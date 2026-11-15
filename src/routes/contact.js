const express = require('express');
const { rateLimitContact, sendContactMessage } = require('../controllers/contactController');

const router = express.Router();

router.post('/', rateLimitContact, sendContactMessage);

module.exports = router;
