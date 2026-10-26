const express = require('express');
const router = express.Router();
const {
  createReview,
  getProductReviews,
  getAdminReviews,
  updateReviewStatus,
  deleteReview,
} = require('../controllers/reviewController');
const authenticate = require('../middleware/auth');

// Public routes
router.get('/product/:productId', getProductReviews);

// Customer routes (require authentication)
router.post('/', authenticate, createReview);

// Admin routes
router.get('/admin', authenticate, getAdminReviews);
router.patch('/:reviewId/status', authenticate, updateReviewStatus);
router.delete('/:reviewId', authenticate, deleteReview);

module.exports = router;
