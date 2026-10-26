const express = require('express');
const { listPublicProducts, getPublicProduct } = require('../controllers/productController');

const router = express.Router();
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/', asyncHandler(listPublicProducts));
router.get('/:slug', asyncHandler(getPublicProduct));

module.exports = router;
