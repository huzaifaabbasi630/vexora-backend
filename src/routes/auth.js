const express = require('express');
const router = express.Router();
const { signup, login } = require('../controllers/authController');

// @route   POST /api/auth/signup
// @desc    Register a new user and send welcome email
router.post('/signup', signup);

// @route   POST /api/auth/login
// @desc    Authenticate user and send thank‑you email
router.post('/login', login);

module.exports = router;
