const Review = require('../models/Review');
const Product = require('../models/Product');

exports.createReview = async (req, res) => {
  try {
    const { productId, rating, title, comment } = req.body;
    const customerId = req.user?._id || req.owner?._id;
    const customerName = req.user?.name || req.owner?.name || 'Anonymous';

    if (!customerId) {
      return res.status(401).json({ message: 'You must be logged in to submit a review.' });
    }

    if (!productId || !rating || !comment) {
      return res.status(400).json({ message: 'Product ID, rating, and comment are required.' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5.' });
    }

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found.' });
    }

    // Check if user already reviewed this product
    const existingReview = await Review.findOne({ productId, customerId });
    if (existingReview) {
      return res.status(400).json({ message: 'You have already reviewed this product.' });
    }

    // Check if user has purchased this product (for verified purchase badge)
    // This would require checking Order model - for now, set to false

    const review = await Review.create({
      productId,
      customerId,
      customerName,
      rating,
      title: title || '',
      comment,
      verifiedPurchase: false,
      status: 'pending', // Require admin approval
    });

    res.status(201).json({ message: 'Review submitted for approval.', review });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({ message: 'Failed to submit review.' });
  }
};

exports.getProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { status = 'approved' } = req.query;

    const reviews = await Review.find({ 
      productId, 
      status 
    })
    .sort({ createdAt: -1 })
    .lean();

    res.json({ reviews });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({ message: 'Failed to fetch reviews.' });
  }
};

exports.getAdminReviews = async (req, res) => {
  try {
    const { status } = req.query;
    const query = status ? { status } : {};
    
    const reviews = await Review.find(query)
      .populate('productId', 'name slug')
      .sort({ createdAt: -1 })
      .lean();

    res.json({ reviews });
  } catch (error) {
    console.error('Error fetching admin reviews:', error);
    res.status(500).json({ message: 'Failed to fetch reviews.' });
  }
};

exports.updateReviewStatus = async (req, res) => {
  try {
    const { reviewId } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status.' });
    }

    const review = await Review.findByIdAndUpdate(
      reviewId,
      { status },
      { new: true }
    );

    if (!review) {
      return res.status(404).json({ message: 'Review not found.' });
    }

    // Update product rating when review is approved
    if (status === 'approved') {
      await updateProductRating(review.productId);
    }

    res.json({ message: 'Review status updated.', review });
  } catch (error) {
    console.error('Error updating review status:', error);
    res.status(500).json({ message: 'Failed to update review status.' });
  }
};

async function updateProductRating(productId) {
  try {
    const approvedReviews = await Review.find({ 
      productId, 
      status: 'approved' 
    });

    if (approvedReviews.length === 0) {
      await Product.findByIdAndUpdate(productId, { rating: null, reviewCount: 0 });
      return;
    }

    const totalRating = approvedReviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = totalRating / approvedReviews.length;

    await Product.findByIdAndUpdate(productId, {
      rating: Math.round(averageRating * 10) / 10, // Round to 1 decimal
      reviewCount: approvedReviews.length,
    });
  } catch (error) {
    console.error('Error updating product rating:', error);
  }
}

exports.deleteReview = async (req, res) => {
  try {
    const { reviewId } = req.params;
    
    const review = await Review.findByIdAndDelete(reviewId);
    if (!review) {
      return res.status(404).json({ message: 'Review not found.' });
    }

    // Update product rating
    await updateProductRating(review.productId);

    res.json({ message: 'Review deleted.' });
  } catch (error) {
    console.error('Error deleting review:', error);
    res.status(500).json({ message: 'Failed to delete review.' });
  }
};
