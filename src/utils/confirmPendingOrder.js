const Order = require('../models/Order');
const Product = require('../models/Product');

async function confirmPendingOrder(order) {
  const claimedOrder = await Order.findOneAndUpdate(
    { _id: order._id, status: 'Pending Confirmation' },
    { $set: { status: 'Confirming' } },
    { new: true }
  );
  if (!claimedOrder) {
    const error = new Error('Order confirmation is already being processed or the order is no longer pending.');
    error.code = 'ORDER_CONFIRMATION_CONFLICT';
    throw error;
  }

  const decremented = [];
  try {
    for (const item of claimedOrder.cartItems) {
      if (!item.productId) continue;

      const product = await Product.findById(item.productId).lean();
      if (!product || product.status !== 'published') {
        const error = new Error(`Product is no longer available: ${item.name}.`);
        error.code = 'ORDER_PRODUCT_UNAVAILABLE';
        throw error;
      }
      if (!product.trackInventory) continue;

      const variantExists = product.variants.some((variant) =>
        variant.size === item.selectedSize && variant.color === item.selectedColor
      );
      const filter = { _id: product._id, status: 'published' };
      const update = { $inc: {} };
      if (variantExists) {
        filter.variants = {
          $elemMatch: {
            size: item.selectedSize,
            color: item.selectedColor,
            stock: { $gte: item.qty },
          },
        };
        update.$inc['variants.$.stock'] = -item.qty;
      } else {
        filter.stock = { $gte: item.qty };
        update.$inc.stock = -item.qty;
      }

      const updatedProduct = await Product.findOneAndUpdate(filter, update, { new: true });
      if (!updatedProduct) {
        const error = new Error(`Insufficient stock to confirm ${item.name}.`);
        error.code = 'ORDER_INSUFFICIENT_STOCK';
        throw error;
      }
      decremented.push({
        productId: product._id,
        qty: item.qty,
        variantExists,
        size: item.selectedSize,
        color: item.selectedColor,
      });
    }

    claimedOrder.status = 'Confirmed';
    claimedOrder.confirmedAt = new Date();
    claimedOrder.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await claimedOrder.save();
    return claimedOrder;
  } catch (error) {
    const rollbackResults = await Promise.allSettled(decremented.map((item) => {
      const filter = item.variantExists
        ? { _id: item.productId, variants: { $elemMatch: { size: item.size, color: item.color } } }
        : { _id: item.productId };
      const update = item.variantExists
        ? { $inc: { 'variants.$.stock': item.qty } }
        : { $inc: { stock: item.qty } };
      return Product.updateOne(filter, update);
    }));
    rollbackResults.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Stock rollback failed during order confirmation:', result.reason?.message || 'Unknown database error.');
      }
    });

    try {
      await Order.updateOne(
        { _id: claimedOrder._id, status: 'Confirming' },
        { $set: { status: 'Pending Confirmation' } }
      );
    } catch (resetError) {
      console.error('Order confirmation state rollback failed:', resetError.message);
    }
    throw error;
  }
}

module.exports = { confirmPendingOrder };
